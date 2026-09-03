import { Type, type Schema } from "@google/genai";

export const emailParseSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    is_transaction_notification: {
      type: Type.BOOLEAN,
      description: "True jika email ini adalah notifikasi transaksi bank.",
    },
    transaction_details: {
      type: Type.OBJECT,
      nullable: true,
      description: "Detail transaksi jika is_transaction_notification = true",
      properties: {
        amount: { type: Type.NUMBER, description: "Nominal uang" },
        merchant: { type: Type.STRING, description: "Nama entitas, toko, atau sumber transaksi" },
        type: { type: Type.STRING, enum: ["INCOME", "EXPENSE"] },
        category: { type: Type.STRING, description: "Kategori transaksi" },
        subcategory: {
          type: Type.STRING,
          nullable: true,
          description: "Subkategori transaksi yang berada di bawah category, atau null jika tidak cukup jelas",
        },
        sumber_dana: {
          type: Type.STRING,
          description: "Bank atau e-wallet asal (misal: 'Bank BCA', 'Bank Mandiri', 'GoPay', 'ShopeePay'). Ekstrak dari teks email atau pengirim.",
        },
        admin_fee: {
          type: Type.NUMBER,
          nullable: true,
          description: "Biaya admin, biaya transfer, atau fee yang dikenakan. Ekstrak angkanya saja. Jika tidak ada, isi null.",
        },
        notes: {
          type: Type.STRING,
          nullable: true,
          description: "Catatan, remark, keterangan, atau berita transfer yang menyertai transaksi",
        },
        confidence_score: {
          type: Type.NUMBER,
          description: "Nilai keyakinan antara 0.0 sampai 1.0. Berikan nilai di bawah 0.85 jika ada bagian teks yang buram/meragukan.",
        },
      },
      required: ["amount", "merchant", "type", "category", "sumber_dana", "confidence_score"],
    },
  },
  required: ["is_transaction_notification"],
};

export function buildEmailClassificationInstruction(taxonomyContext: string): string {
  return `Anda bertugas membaca notifikasi email dari bank/e-wallet dan mengekstrak rincian transaksi. Perhatikan secara spesifik label "Berita:", "Catatan:", "Remark:", "Keterangan:", atau "Description:" untuk diekstrak ke dalam 'notes'. Prioritaskan isi 'notes' untuk menentukan klasifikasi. Taksonomi valid berbentuk JSON ringkas dengan t=type, p=parent, c=children, dan s=system/custom: ${taxonomyContext}. 'category' wajib sama persis dengan satu parent p yang kompatibel dengan 'type'. 'subcategory' harus sama persis dengan child n di dalam parent tersebut, atau null jika tidak ada child yang cukup jelas. Jangan mengarang parent atau child. Pilih Lain-lain hanya jika model secara eksplisit menilai tidak ada parent yang lebih tepat. Ekstrak nama bank/e-wallet ke 'sumber_dana'. Jika terdapat biaya admin atau transfer fee terpisah dari jumlah pokok, pisahkan angkanya ke dalam 'admin_fee' dan keluarkan dari 'amount'. 'amount' hanya untuk jumlah utama transaksi.`;
}
