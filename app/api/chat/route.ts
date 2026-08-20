import { NextRequest, NextResponse } from "next/server";
import { Type, Schema } from "@google/genai";
import { createClient } from "@/lib/supabase/server";
import { normalizeSumberDana } from "@/utils/bankAliases";
import { executeWithGenAIFailover } from "@/lib/gemini";

const OFF_TOPIC_REPLY = "Maaf, Douit AI saat ini hanya dapat membantu mencatat dan mengelola keuangan Anda (pemasukan, pengeluaran, dan sumber rekening). Silakan masukkan catatan transaksi Anda, contoh: 'Hari ini jam 7 malam beli bensin 30k pakai BRI'.";

export function formatTransactionReplyMessage(tx: {
  amount: number;
  merchant: string;
  type: string;
  sumber_dana?: string | null;
  admin_fee?: number | null;
}): string {
  const typeLabel = tx.type === 'INCOME' ? 'pemasukan' : 'pengeluaran';
  const formattedAmount = new Intl.NumberFormat('id-ID').format(tx.amount);
  const paymentMethod = tx.sumber_dana ? tx.sumber_dana.trim() : 'Tunai';

  let paymentPhrase = 'secara tunai';
  const lowerMethod = paymentMethod.toLowerCase();

  if (lowerMethod === 'tunai' || lowerMethod === 'cash') {
    paymentPhrase = 'secara tunai';
  } else if (
    lowerMethod.startsWith('bank') ||
    lowerMethod.startsWith('bca') ||
    lowerMethod.startsWith('bri') ||
    lowerMethod.startsWith('bni') ||
    lowerMethod.startsWith('mandiri') ||
    lowerMethod.startsWith('bsi') ||
    lowerMethod.startsWith('cimb') ||
    lowerMethod.startsWith('permata')
  ) {
    paymentPhrase = `via ${paymentMethod}`;
  } else if (['gopay', 'ovo', 'dana', 'shopeepay'].includes(lowerMethod)) {
    paymentPhrase = `pakai ${paymentMethod}`;
  } else {
    paymentPhrase = `lewat ${paymentMethod}`;
  }

  let reply = `Oke, ${typeLabel} ${tx.merchant} ${formattedAmount} ${paymentPhrase} sudah dicatat.`;
  if (tx.admin_fee && tx.admin_fee > 0) {
    const formattedFee = new Intl.NumberFormat('id-ID').format(tx.admin_fee);
    reply += ` (Biaya admin: ${formattedFee})`;
  }
  return reply;
}

const responseSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    is_transaction: {
      type: Type.BOOLEAN,
      description: "True jika pesan berniat untuk mencatat atau membuat transaksi keuangan (pemasukan/pengeluaran/transfer). False jika hanya bertanya atau bercakap seputar keuangan atau jika pesan di luar topik keuangan."
    },
    reply_message: {
      type: Type.STRING,
      description: "Balasan percakapan untuk user dalam bahasa Indonesia. Untuk transaksi keuangan, WAJIB gunakan gaya percakapan natural dan angka bertitik pemisah ribuan (contoh: 'Oke, pengeluaran makan siang 10.000 secara tunai sudah dicatat.'). Jika pesan pengguna DI LUAR topik pencatatan/pengelolaan keuangan, isi persis dengan teks penolakan standar."
    },
    transaction_details: {
      type: Type.OBJECT,
      nullable: true,
      description: "Detail transaksi jika is_transaction = true",
      properties: {
        amount: { type: Type.NUMBER, description: "Nominal uang (angka positif tanpa titik/koma)" },
        merchant: { type: Type.STRING, description: "Nama entitas, toko, atau deskripsi transaksi" },
        type: { type: Type.STRING, enum: ["INCOME", "EXPENSE"] },
        category: { type: Type.STRING, description: "Kategori transaksi" },
        sumber_dana: { type: Type.STRING, description: "Akun/metode pembayaran yang digunakan (misal: 'Bank BCA', 'GoPay', 'Tunai'). Jika tidak spesifik, gunakan 'Tunai'." },
        admin_fee: { type: Type.NUMBER, nullable: true, description: "Biaya admin, fee, atau biaya transfer jika disebutkan (misal: 2500 atau 6500). Ekstrak berupa angka. Jika tidak ada, isi null." },
        notes: { type: Type.STRING, nullable: true, description: "Catatan khusus, remark, atau berita dari transaksi" },
        transaction_date: { type: Type.STRING, nullable: true, description: "Tanggal transaksi absolut dalam format YYYY-MM-DD hasil ekstraksi jika user menyebutkan waktu." },
        transaction_time: { type: Type.STRING, nullable: true, description: "Waktu transaksi dalam format 24 jam HH:mm jika user menyebutkan waktu spesifik (misal: '14:00' untuk jam 2 siang, '20:00' untuk jam 8 malam). Jika TIDAK menyebutkan waktu secara spesifik, HARUS null." }
      },
      required: ["amount", "merchant", "type", "category", "sumber_dana"]
    }
  },
  required: ["is_transaction", "reply_message"]
};

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json() as { message: string; sessionId?: string; [key: string]: any };
    const message = body.message;
    const sessionId = body.sessionId;
    let currentSessionId = sessionId;

    if (!currentSessionId) {
      const { data: newSession, error: sessionErr } = await supabase.from('chat_sessions').insert({
        user_id: user.id,
        title: message.substring(0, 30) + (message.length > 30 ? '...' : '')
      }).select('id').single();
      if (!sessionErr && newSession) {
        currentSessionId = newSession.id;
      }
    }

    // Parallelize pre-AI queries: user message insert, categories fetch, merchant rules fetch, chat history fetch
    const [, { data: categories }, { data: rules }, msgsResult] = await Promise.all([
      currentSessionId ? supabase.from('chat_messages').insert({
        session_id: currentSessionId,
        role: 'user',
        content: message
      }) : Promise.resolve(null),
      supabase.from('categories').select('id, name').or(`user_id.eq.${user.id},is_system.eq.true`),
      supabase.from('merchant_rules').select('merchant_name, keyword, category_id, sumber_dana').eq('user_id', user.id),
      currentSessionId ? supabase.from('chat_messages')
        .select('role, content')
        .eq('session_id', currentSessionId)
        .order('created_at', { ascending: false })
        .limit(10) : Promise.resolve({ data: null })
    ]);

    const categoryNames = categories ? categories.map(c => c.name).join(", ") : "Lain-lain";

    // Adaptive Match on Raw Input
    let matchedRule: any = null;
    if (rules && rules.length > 0) {
      matchedRule = rules.find(rule => {
        const matchMerchant = message.toLowerCase().includes(rule.merchant_name.toLowerCase());
        const matchKeyword = rule.keyword ? message.toLowerCase().includes(rule.keyword.toLowerCase()) : true;
        return matchMerchant && matchKeyword;
      });
    }

    let chatContents: any = message;
    if (currentSessionId && msgsResult?.data && msgsResult.data.length > 0) {
      const chronologicalMsgs = [...msgsResult.data].reverse();
      chatContents = chronologicalMsgs.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }));
    }

    const now = new Date();
    const currentDateContext = `Current Date Context: ${now.toLocaleDateString("id-ID", { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}, ${now.toLocaleTimeString("id-ID", { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).replace('.', ':')} WIB`;

    const systemInstruction = `Anda adalah asisten manajemen keuangan cerdas (Douit AI). 
TUGAS UTAMA ANDA: HANYA membantu mencatat, mengelola, meringkas, dan melacak transaksi keuangan pengguna (pemasukan, pengeluaran, transfer, dan sumber rekening/dompet/saldo).

ATURAN KETAT GUARDRAILS (PENOLAKAN DI LUAR KEUANGAN):
Jika pengguna bertanya, meminta saran, atau membahas topik apapun DI LUAR pencatatan dan pengelolaan keuangan pribadi/bisnis (contoh: resep masakan, pengetahuan umum, ramalan cuaca, curhat, lelucon, puisi, coding, matematika umum, artikel, rekomendasi non-keuangan, dll), Anda WAJIB MENOLAK secara sopan dan HANYA membalas persis dengan kalimat berikut:
"${OFF_TOPIC_REPLY}"
Pada kondisi di luar topik keuangan ini, Anda WAJIB mengatur 'is_transaction' = false dan 'transaction_details' = null.

ATURAN FORMAT BALASAN TRANSAKSI (reply_message):
Jika is_transaction = true, 'reply_message' WAJIB menggunakan bahasa Indonesia yang natural, ramah, dan angka nominal berformat pemisah ribuan titik (contoh: 10.000, 50.000, 1.500.000) serta menyebutkan jenis transaksi (pengeluaran/pemasukan), merchant/keperluan, dan metode pembayaran.
Contoh baku:
- User: "makan siang 10k" -> reply_message: "Oke, pengeluaran makan siang 10.000 secara tunai sudah dicatat."
- User: "beli bensin 30k pakai BRI" -> reply_message: "Oke, pengeluaran beli bensin 30.000 via Bank BRI sudah dicatat."
- User: "terima transfer gaji 5jt ke BCA" -> reply_message: "Oke, pemasukan transfer gaji 5.000.000 via Bank BCA sudah dicatat."
JANGAN PERNAH gunakan format template kaku tanpa titik seperti "Transaksi 'x' sejumlah 10000 telah dicatat."

Kategori HARUS dipilih dari daftar berikut: [${categoryNames}]. Jika user menyebutkan catatan/keterangan, masukkan ke 'notes'.

${currentDateContext}.
PENTING TENTANG WAKTU TRANSAKSI:
1. Jika user MENYEBUTKAN jam spesifik (contoh: "jam 2 siang", "14:30", "jam 8 malam", "jam 19.00", "jam 7 malam"), konversi dengan akurat ke format 24-jam (misal "14:00", "20:00", "19:00") dan isi ke 'transaction_time'.
2. Jika user TIDAK menyebutkan jam spesifik (contoh: "kemarin beli pulsa 10k", "15 juli laundry", "beli bakso", "tanggal 18 agustus bayar parkir 2k"), set 'transaction_time' menjadi null. JANGAN MENGISI "00:00", "07:00", "12:00", atau waktu saat ini.
3. Ekstrak keterangan tanggal (misal "kemarin", "hari ini", "tadi siang", "18 agustus") dan hitung tanggalnya relatif terhadap Current Date Context lalu isi ke 'transaction_date' dalam format YYYY-MM-DD. Jika tidak disebutkan tanggal, kembalikan null atau biarkan kosong.
4. Ekstrak metode pembayaran (contoh "pake BCA", "via gopay", "mandiri", "cash", "tunai", "BRI") ke 'sumber_dana'. Jika tidak disebutkan, default ke "Tunai".
5. Jika ada keterangan biaya admin atau fee, ekstrak angkanya ke dalam 'admin_fee' dan keluarkan dari 'amount'. 'amount' hanya berisi nominal transfer/transaksi utama.

Kembalikan data dalam format JSON sesuai skema.`;

    const response = await executeWithGenAIFailover(async (aiInstance) => {
      return await aiInstance.models.generateContent({
        model: "gemini-3.5-flash",
        contents: chatContents,
        config: {
          responseMimeType: "application/json",
          responseSchema: responseSchema,
          systemInstruction: systemInstruction,
          temperature: 0.2
        }
      });
    });

    let textResponse = response.text || "";
    textResponse = textResponse.replace(/^```json\s*/, "").replace(/\s*```$/, "").trim();
    if (!textResponse) throw new Error("No response from AI");
    
    const parsed = JSON.parse(textResponse);
    
    let draftId: string | null = null;
    let preview: any = null;

    if (parsed.is_transaction && parsed.transaction_details) {
      const tx = parsed.transaction_details;
      
      let categoryId: string | null = null;
      let status = 'PENDING_APPROVAL';
      
      if (!matchedRule) {
        // Fuzzy search using parsed merchant name
        const { data: dbRule } = await supabase
          .from('merchant_rules')
          .select('merchant_name, keyword, category_id, sumber_dana')
          .eq('user_id', user.id)
          .ilike('merchant_name', `%${tx.merchant}%`)
          .maybeSingle();

        if (dbRule) {
          matchedRule = dbRule;
        } else if (rules && rules.length > 0) {
          // Fallback: check if parsed merchant contains the rule merchant (e.g. parsed "Laundry Budi", rule "Laundry")
          matchedRule = rules.find(r => tx.merchant.toLowerCase().includes(r.merchant_name.toLowerCase()));
        }
      }

      if (matchedRule) {
        categoryId = matchedRule.category_id;
        status = 'APPROVED';
        if (matchedRule.keyword) tx.notes = matchedRule.keyword;
        if (matchedRule.sumber_dana) tx.sumber_dana = matchedRule.sumber_dana;
        const ruleCategory = categories?.find(c => c.id === categoryId);
        if (ruleCategory) tx.category = ruleCategory.name;
      }

      if (!categoryId) {
        const matchedCategory = categories?.find(c => c.name.toLowerCase() === tx.category.toLowerCase());
        categoryId = matchedCategory ? matchedCategory.id : (categories?.find(c => c.name === 'Lain-lain')?.id || null);
      }
      
      const nowForDate = new Date();
      const todayWIB = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(nowForDate);
      const targetDate = tx.transaction_date || todayWIB;
      let finalNotes = tx.notes || null;
      let transactionDateString = '';

      if (tx.transaction_time) {
        // Explicit time was provided: construct local ISO string with offset (+07:00 WIB)
        transactionDateString = `${targetDate}T${tx.transaction_time}:00+07:00`;
      } else {
        // No specific time provided: construct UTC midnight and tag notes with [NO_TIME]
        transactionDateString = `${targetDate}T00:00:00.000Z`;
        finalNotes = finalNotes ? `${finalNotes} [NO_TIME]` : '[NO_TIME]';
      }

      const transactionPayload: any = {
        amount: tx.amount,
        type: tx.type,
        merchant: tx.merchant,
        category_id: categoryId,
        category: tx.category,
        sumber_dana: normalizeSumberDana(tx.sumber_dana || 'Tunai'),
        status: 'APPROVED',
        source: 'MANUAL_CHAT',
        confidence_score: status === 'APPROVED' ? 1.0 : 0.95,
        notes: finalNotes,
        admin_fee: tx.admin_fee && tx.admin_fee > 0 ? tx.admin_fee : null,
        transaction_date: transactionDateString
      };

      draftId = `draft-${Date.now()}`;
      preview = transactionPayload;

      // Standardize and guarantee 100% consistent natural phrasing across all accounts & sessions
      parsed.reply_message = formatTransactionReplyMessage({
        amount: transactionPayload.amount,
        merchant: transactionPayload.merchant,
        type: transactionPayload.type,
        sumber_dana: transactionPayload.sumber_dana,
        admin_fee: transactionPayload.admin_fee
      });
    }

    if (currentSessionId) {
      const msgPayload: any = {
        session_id: currentSessionId,
        role: 'assistant',
        content: parsed.reply_message
      };

      if (draftId && preview) {
        msgPayload.action_draft_id = draftId;
        msgPayload.draft_data = preview;
      }

      const { error: assistantMsgErr } = await supabase.from('chat_messages').insert(msgPayload);
      if (assistantMsgErr) {
        console.error("[Chat API] Error inserting assistant message:", assistantMsgErr);
        
        // Fallback: If payload with draft_data / action_draft_id fails (e.g. column not yet migrated in Supabase),
        // gracefully retry inserting basic role & content so assistant message text is never lost from history
        if (msgPayload.action_draft_id || msgPayload.draft_data) {
          console.warn("[Chat API] Retrying assistant message insertion with plain text content...");
          const { error: fallbackErr } = await supabase.from('chat_messages').insert({
            session_id: currentSessionId,
            role: 'assistant',
            content: parsed.reply_message
          });
          if (fallbackErr) {
            console.error("[Chat API] Fallback assistant message insert also failed:", fallbackErr);
          }
        }
      }

      // Update session timestamp for active ordering
      await supabase
        .from('chat_sessions')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', currentSessionId);
    }

    return NextResponse.json({
      reply: parsed.reply_message,
      draftId,
      preview,
      sessionId: currentSessionId
    });

  } catch (error) {
    console.error("Chat API Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
