"use client";

import {
  ArrowRight,
  Bot,
  Check,
  CircleCheck,
  FileText,
  History,
  MoreVertical,
  Paperclip,
  PencilLine,
  Pin,
  PinOff,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
  X
} from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useDouit } from "../../providers/DouitProvider";
import { createClient } from "@/lib/supabase/client";
import { triggerBudgetAlertCheck } from "@/app/actions/savings-alert";

type Message = { id: string; role: "user" | "assistant"; content: string; message_kind: string; action_draft_id: string | null; created_at: string };
type ActionDraft = { id: string; action_type: string; status: "pending" | "approved" | "rejected" | "failed"; preview: Record<string, unknown>; executed_entity_id?: string | null };
type ChatSession = { id: string; title: string; created_at: string; is_pinned?: boolean };

const WELCOME_MESSAGE = "Halo! Saya asisten Douit AI yang siap mencatat keuangan Anda secara otomatis. Anda bisa menyebutkan tanggal, jam, nominal, hingga metode pembayaran/rekening. Contoh: 'Hari ini jam 7 malam beli bensin 30k pakai BRI'.";

const PROMPT_SUGGESTIONS = [
  "Hari ini jam 7 malam beli bensin 30k pakai BRI",
  "Tadi siang jam 12 makan siang 25k tunai",
  "Hari ini jam 4 sore ditransfer 500k dari klien ke BCA",
  "Kemarin jam 20.00 laundry 30k pakai GoPay",
];

const money = (value: unknown) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(value ?? 0));

export default function ChatPage() {
  const router = useRouter();
  const { business } = useDouit();
  const [messages, setMessages] = useState<Message[]>([]);
  const [drafts, setDrafts] = useState<Record<string, ActionDraft>>({});
  const [input, setInput] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // Chat history action state
  const [menuSessionId, setMenuSessionId] = useState<string | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editTitleInput, setEditTitleInput] = useState("");

  const composerInput = useRef<HTMLInputElement>(null);

  const fetchSessions = async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    try {
      const { data, error } = await supabase.from('chat_sessions')
        .select('id, title, created_at, is_pinned')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (data && !error) {
        setSessions(data);
      } else {
        // Fallback if is_pinned column is not yet present
        const { data: fallbackData } = await supabase.from('chat_sessions')
          .select('id, title, created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });
        if (fallbackData) setSessions(fallbackData.map(d => ({ ...d, is_pinned: false })));
      }
    } catch {
      const { data } = await supabase.from('chat_sessions')
        .select('id, title, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (data) setSessions(data.map(d => ({ ...d, is_pinned: false })));
    }
  };

  useEffect(() => {
    fetchSessions();
  }, []);

  useEffect(() => {
    if (!activeSessionId) {
      setMessages([
        { id: "msg-0", role: "assistant", content: WELCOME_MESSAGE, message_kind: "text", action_draft_id: null, created_at: new Date().toISOString() }
      ]);
      setDrafts({});
    }
  }, [activeSessionId]);

  // Click-outside listener for action dropdown
  useEffect(() => {
    if (!menuSessionId) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest("[data-chat-menu]")) {
        setMenuSessionId(null);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuSessionId(null);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuSessionId]);

  const loadSession = async (sessionId: string) => {
    setActiveSessionId(sessionId);
    setHistoryOpen(false);
    setMenuSessionId(null);
    setEditingSessionId(null);
    const supabase = createClient();
    const { data } = await supabase.from('chat_messages').select('*').eq('session_id', sessionId).order('created_at', { ascending: true });
    if (data) {
      const loadedDrafts: Record<string, ActionDraft> = {};
      const newMessages = data.map(m => {
        if (m.action_draft_id && m.draft_data) {
          const draftStatus = (m.draft_data as any)?.status || "pending";
          loadedDrafts[m.action_draft_id] = {
            id: m.action_draft_id,
            action_type: "create_transaction",
            status: draftStatus,
            preview: m.draft_data
          };
        }
        return {
          id: m.id,
          role: m.role as any,
          content: m.content,
          message_kind: 'text',
          action_draft_id: m.action_draft_id,
          created_at: m.created_at
        };
      });
      setDrafts(prev => ({ ...prev, ...loadedDrafts }));
      setMessages(newMessages);
    }
  };

  const newSession = () => {
    setActiveSessionId(null);
    setHistoryOpen(false);
    setMenuSessionId(null);
    setEditingSessionId(null);
    setMessages([
      { id: "msg-0", role: "assistant", content: WELCOME_MESSAGE, message_kind: "text", action_draft_id: null, created_at: new Date().toISOString() }
    ]);
    setDrafts({});
  };

  const handleTogglePin = async (sessionId: string) => {
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return;
    const newPinned = !session.is_pinned;

    // Optimistic UI update
    setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, is_pinned: newPinned } : s));

    const supabase = createClient();
    try {
      await supabase.from('chat_sessions').update({ is_pinned: newPinned }).eq('id', sessionId);
    } catch (err) {
      console.error("Failed to update pin state:", err);
    }
  };

  const handleStartRename = (sessionId: string) => {
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return;
    setEditingSessionId(sessionId);
    setEditTitleInput(session.title);
  };

  const handleSaveRename = async (sessionId: string) => {
    const prevSession = sessions.find(s => s.id === sessionId);
    const cleanTitle = editTitleInput.trim() || prevSession?.title || "Percakapan Baru";

    // Optimistic UI update
    setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, title: cleanTitle } : s));
    setEditingSessionId(null);

    const supabase = createClient();
    try {
      await supabase.from('chat_sessions').update({ title: cleanTitle }).eq('id', sessionId);
    } catch (err) {
      console.error("Failed to rename chat session:", err);
    }
  };

  const handleCancelRename = () => {
    setEditingSessionId(null);
  };

  const handleDeleteSession = async (sessionId: string) => {
    // Optimistic UI update
    setSessions(prev => prev.filter(s => s.id !== sessionId));
    if (activeSessionId === sessionId) {
      newSession();
    }

    const supabase = createClient();
    try {
      await supabase.from('chat_sessions').delete().eq('id', sessionId);
    } catch (err) {
      console.error("Failed to delete chat session:", err);
    }
  };

  async function submitMessage(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || !business || sending) return;

    setSending(true); setInput("");

    const userMsg: Message = { id: `local-${Date.now()}`, role: "user", content: text, message_kind: "text", action_draft_id: null, created_at: new Date().toISOString() };
    setMessages(current => [...current, userMsg]);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, sessionId: activeSessionId })
      });
      const data = (await res.json()) as { sessionId?: string; draftId?: string; preview?: Record<string, unknown>; reply?: string; error?: string };

      if (data.sessionId && !activeSessionId) {
        setActiveSessionId(data.sessionId);
        await fetchSessions();
      }

      let newMsg: Message;
      if (data.draftId && data.preview) {
        setDrafts(prev => ({
          ...prev,
          [data.draftId as string]: {
            id: data.draftId as string,
            action_type: "create_transaction",
            status: "pending",
            preview: data.preview!
          }
        }));
        newMsg = { id: `ai-${Date.now()}`, role: "assistant", content: data.reply || "Saya siapkan draft transaksinya.", message_kind: "text", action_draft_id: data.draftId, created_at: new Date().toISOString() };
      } else {
        newMsg = { id: `ai-${Date.now()}`, role: "assistant", content: data.reply || "Maaf, saya tidak mengerti.", message_kind: "text", action_draft_id: null, created_at: new Date().toISOString() };
      }
      setMessages(current => [...current, newMsg]);
    } catch (err) {
      console.error(err);
      setMessages(current => [...current, { id: `err-${Date.now()}`, role: "assistant", content: "Terjadi kesalahan jaringan atau sistem.", message_kind: "text", action_draft_id: null, created_at: new Date().toISOString() }]);
    } finally {
      setSending(false);
    }
  }

  async function reviewAction(actionId: string, decision: "approve" | "reject") {
    const supabase = createClient();
    const draft = drafts[actionId];

    // Optimistic Update
    setDrafts(prev => ({
      ...prev,
      [actionId]: { ...prev[actionId], status: decision === 'approve' ? 'approved' : 'rejected' }
    }));

    if (decision === 'approve') {
      const txPayload: any = {
        amount: Number(draft.preview.amount),
        type: String(draft.preview.type),
        merchant: String(draft.preview.merchant || draft.preview.name || ""),
        category_id: draft.preview.category_id ? String(draft.preview.category_id) : null,
        sumber_dana: draft.preview.sumber_dana ? String(draft.preview.sumber_dana) : 'Tunai',
        status: 'APPROVED',
        source: 'MANUAL_CHAT',
        confidence_score: 1.0,
        notes: draft.preview.notes ? String(draft.preview.notes) : null,
      };
      if (draft.preview.transaction_date) {
        txPayload.transaction_date = String(draft.preview.transaction_date);
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        txPayload.user_id = user.id;
        const payloads = [txPayload];

        if (draft.preview.admin_fee) {
          const { data: categories } = await supabase.from('categories').select('id').eq('name', 'Biaya Admin').single();
          payloads.push({
            ...txPayload,
            amount: Number(draft.preview.admin_fee),
            merchant: `Biaya Admin ${txPayload.sumber_dana}`,
            category_id: categories?.id || null,
          });
        }

        const { error: insertError } = await supabase.from('transactions').insert(payloads);

        if (insertError) {
          console.error("Supabase Insert Error:", insertError);
          // Rollback optimistic update on failure
          setDrafts(prev => ({
            ...prev,
            [actionId]: { ...prev[actionId], status: 'pending' }
          }));
        } else {
          if (txPayload.type === 'EXPENSE') {
            triggerBudgetAlertCheck(user.id).catch(console.error);
          }
          if (txPayload.merchant && txPayload.category_id) {
            await supabase.from('user_merchant_rules').upsert({
              user_id: user.id,
              merchant_pattern: txPayload.merchant,
              category_id: txPayload.category_id
            }, { onConflict: 'user_id, merchant_pattern' });
          }
          // Persist approved status to chat_messages
          try {
            await supabase
              .from('chat_messages')
              .update({
                draft_data: { ...draft.preview, status: 'approved' }
              })
              .eq('action_draft_id', actionId);
          } catch (err) {
            console.warn("Could not update chat message draft status:", err);
          }
        }
      }
    } else if (decision === 'reject') {
      // Persist rejected status to chat_messages
      try {
        await supabase
          .from('chat_messages')
          .update({
            draft_data: { ...draft.preview, status: 'rejected' }
          })
          .eq('action_draft_id', actionId);
      } catch (err) {
        console.warn("Could not update chat message draft status:", err);
      }
    }
  }

  function editAction(draft: ActionDraft) {
    const prompt = `Ubah jumlah pengeluaran ini menjadi: `;
    setInput(prompt);
    window.requestAnimationFrame(() => {
      composerInput.current?.focus();
    });
  }

  function openSavedData() {
    router.push("/transactions");
  }

  const pinnedSessions = sessions.filter(s => !!s.is_pinned);
  const recentSessions = sessions.filter(s => !s.is_pinned);

  const renderSessionItem = (s: ChatSession) => {
    if (editingSessionId === s.id) {
      return (
        <form
          key={s.id}
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleSaveRename(s.id);
          }}
          className="flex items-center gap-1.5 p-1.5 bg-white border border-emerald-500 rounded-xl w-full shadow-xs"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <input
            type="text"
            value={editTitleInput}
            onChange={(e) => setEditTitleInput(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") {
                e.preventDefault();
                handleCancelRename();
              } else if (e.key === "Enter") {
                e.preventDefault();
                handleSaveRename(s.id);
              }
            }}
            onBlur={() => handleSaveRename(s.id)}
            autoFocus
            className="min-w-0 flex-1 px-1.5 py-0.5 text-xs text-slate-800 bg-transparent border-0 outline-none font-medium"
          />
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleSaveRename(s.id);
            }}
            className="p-1 text-emerald-600 hover:bg-emerald-50 rounded-lg cursor-pointer transition-colors"
            title="Simpan"
          >
            <Check size={14} />
          </button>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleCancelRename();
            }}
            className="p-1 text-slate-400 hover:bg-slate-100 rounded-lg cursor-pointer transition-colors"
            title="Batal"
          >
            <X size={14} />
          </button>
        </form>
      );
    }

    return (
      <div
        key={s.id}
        className={`group relative flex items-center justify-between w-full min-h-[38px] px-2.5 py-1.5 rounded-xl cursor-pointer transition-all duration-150 ${s.id === activeSessionId
            ? "bg-white text-slate-900 shadow-xs border border-slate-200/80 font-semibold"
            : "text-slate-600 hover:bg-slate-200/60 hover:text-slate-900 border border-transparent"
          }`}
        onClick={() => loadSession(s.id)}
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1 pr-1">
          {s.is_pinned && (
            <Pin size={12} className="text-emerald-600 shrink-0 fill-emerald-600/30" />
          )}
          <span className="truncate text-xs font-medium text-left block w-full">
            {s.title}
          </span>
        </div>

        {/* 3-Dots Action Container */}
        <div
          data-chat-menu
          className="relative shrink-0"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            aria-label="Menu percakapan"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setMenuSessionId(prev => (prev === s.id ? null : s.id));
            }}
            className={`p-1 rounded-md cursor-pointer transition-all active:scale-95 ${menuSessionId === s.id
                ? "opacity-100 bg-slate-200 text-slate-700"
                : "opacity-0 group-hover:opacity-100 text-slate-400 hover:text-slate-700 hover:bg-slate-200/70"
              }`}
          >
            <MoreVertical size={14} />
          </button>

          {/* Action Menu Dropdown */}
          {menuSessionId === s.id && (
            <div
              className="absolute right-0 top-full mt-1 w-44 rounded-xl bg-white p-1.5 shadow-xl border border-slate-100 z-50 animate-in fade-in zoom-in-95 duration-100"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Pin Option */}
              <button
                type="button"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  handleTogglePin(s.id);
                  setMenuSessionId(null);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer transition-colors"
              >
                {s.is_pinned ? (
                  <>
                    <PinOff className="w-4 h-4 text-slate-500 shrink-0" />
                    <span>Lepas Sematan</span>
                  </>
                ) : (
                  <>
                    <Pin className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>Sematkan</span>
                  </>
                )}
              </button>

              {/* Rename Option */}
              <button
                type="button"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  handleStartRename(s.id);
                  setMenuSessionId(null);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer transition-colors"
              >
                <PencilLine className="w-4 h-4 text-slate-500 shrink-0" />
                <span>Ganti nama</span>
              </button>

              <div className="my-1 border-t border-slate-100" />

              {/* Delete Option */}
              <button
                type="button"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteSession(s.id);
                  setMenuSessionId(null);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer transition-colors"
              >
                <Trash2 className="w-4 h-4 text-rose-500 shrink-0" />
                <span>Hapus</span>
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="chat-layout">
      <aside className={`chat-history ${historyOpen ? "open" : ""}`}>
        <div className="history-heading">
          <span><History size={16} /> Riwayat percakapan</span>
          <button aria-label="Tutup riwayat" onClick={() => setHistoryOpen(false)}><X size={17} /></button>
        </div>
        <button className="new-chat-button" onClick={newSession}>
          <Sparkles size={16} /> Percakapan baru
        </button>

        <div className="history-list flex-1 overflow-y-auto pr-1 space-y-4">
          {/* Pinned Group */}
          {pinnedSessions.length > 0 && (
            <div className="space-y-1">
              <span className="history-label text-[11px] font-bold text-slate-400 uppercase tracking-wider px-2 block mb-1">
                DISEMATKAN
              </span>
              {pinnedSessions.map(s => renderSessionItem(s))}
            </div>
          )}

          {/* Recent Group */}
          <div className="space-y-1">
            <span className="history-label text-[11px] font-bold text-slate-400 uppercase tracking-wider px-2 block mb-1">
              TERBARU
            </span>
            {recentSessions.length === 0 && pinnedSessions.length === 0 && (
              <span className="text-xs text-slate-400 px-3 py-2 block">Belum ada riwayat</span>
            )}
            {recentSessions.map(s => renderSessionItem(s))}
          </div>
        </div>

        <div className="history-note">
          <ShieldCheck size={16} />
          <p><b>Ruang kerja aman</b><br />AI hanya menggunakan data {business?.name}.</p>
        </div>
      </aside>

      {historyOpen && <button className="history-scrim" aria-label="Tutup riwayat" onClick={() => setHistoryOpen(false)} />}

      <section className="chat-workspace">
        <header className="chat-header">
          <button className="history-toggle" onClick={() => setHistoryOpen(true)} aria-label="Buka riwayat"><History size={18} /></button>
          <div className="ai-avatar"><Sparkles size={19} /></div>
          <div><h1>Douit AI</h1><p><i /> Douit Financial Co-Pilot</p></div>
          <div className="safe-mode"><ShieldCheck size={15} /> Semua aksi butuh persetujuan</div>
        </header>

        <div className="messages" aria-live="polite">
          {messages.map(message => {
            const draft = message.action_draft_id ? drafts[message.action_draft_id] : null;
            return (
              <div className={`message-row ${message.role === "user" ? "user-message" : "assistant-message"}`} key={message.id}>
                {message.role === "assistant" && <div className="small-avatar ai"><Bot size={16} /></div>}
                <div className={`assistant-stack ${draft ? "wide" : ""}`}>
                  <div className={`message-bubble ${message.role === "assistant" ? "rich" : ""}`}><p>{message.content}</p></div>
                  {draft && <DraftCard draft={draft} onDecision={reviewAction} onEdit={editAction} onOpenSaved={openSavedData} />}
                </div>
                {message.role === "user" && <div className="small-avatar"><UserRound size={15} /></div>}
              </div>
            );
          })}
          {sending && <div className="message-row assistant-message"><div className="small-avatar ai"><Bot size={16} /></div><div className="message-bubble">Menganalisis...</div></div>}
        </div>

        <footer className="composer-area">
          <div className="prompt-chips flex gap-2 mb-2 overflow-x-auto scrollbar-none py-1">
            {PROMPT_SUGGESTIONS.map((suggestion, index) => (
              <button
                key={index}
                type="button"
                onClick={() => {
                  setInput(suggestion);
                  composerInput.current?.focus();
                }}
                className="shrink-0 px-3 py-1.5 rounded-full text-xs bg-[#f4f7f4] hover:bg-[#e9efe8] text-slate-700 border border-slate-200/80 transition-all hover:border-emerald-300 active:scale-95 cursor-pointer whitespace-nowrap"
              >
                {suggestion}
              </button>
            ))}
          </div>
          <form className="composer" onSubmit={submitMessage}>
            <button type="button" aria-label="Lampirkan file"><Paperclip size={18} /></button>
            <input
              ref={composerInput}
              value={input}
              onChange={event => setInput(event.target.value)}
              placeholder="Catat pengeluaran atau tanya keuangan..."
              aria-label="Pesan untuk Douit AI"
            />
            <span className="composer-hint">Enter untuk kirim</span>
            <button className="send-button" type="submit" aria-label="Kirim pesan" disabled={sending}><Send size={17} /></button>
          </form>
          <p>Douit dapat membuat kesalahan. Selalu periksa detail keuangan sebelum menyetujui.</p>
        </footer>
      </section>
    </div>
  );
}

function DraftCard({ draft, onDecision, onEdit, onOpenSaved }: { draft: ActionDraft; onDecision: (id: string, decision: "approve" | "reject") => Promise<void>; onEdit: (draft: ActionDraft) => void; onOpenSaved: () => void }) {
  const [loading, setLoading] = useState(false);

  const handleDecision = async (id: string, decision: "approve" | "reject") => {
    setLoading(true);
    await onDecision(id, decision);
    setLoading(false);
  };

  if (draft.status === "approved") return <div className="success-card"><span className="success-icon"><CircleCheck size={23} /></span><div><h3>Transaksi berhasil disimpan!</h3><p>Persetujuan tercatat di database.</p></div><button type="button" onClick={onOpenSaved}>Lihat Transaksi <ArrowRight size={14} /></button></div>;
  if (draft.status === "rejected") return <div className="rejected-card"><Trash2 size={20} /><div><h3>Draft ditolak</h3><p>Tidak ada data yang dibuat atau diubah.</p></div></div>;

  const preview = draft.preview ?? {};

  return (
    <article className="draft-card">
      <div className="draft-card-header">
        <div>
          <span className="draft-icon"><FileText size={19} /></span>
          <span><small>PRATINJAU TINDAKAN</small><h2>Transaksi baru</h2></span>
        </div>
        <span className="draft-badge">DRAFT · BELUM DISIMPAN</span>
      </div>

      <div className="draft-party-row">
        <div><small>TRANSAKSI</small><b>{String(preview.merchant ?? preview.name ?? "")}</b><span>Kategori: {String(preview.category ?? "")}</span></div>
        <div>
          <small>JUMLAH</small>
          <b style={{ fontSize: '18px', color: 'var(--slate-900)' }}>{money(preview.amount)}</b>
          {Boolean(preview.admin_fee) && Number(preview.admin_fee) > 0 && (
            <span style={{ display: 'block', fontSize: '12px', color: 'var(--slate-500)', marginTop: '4px' }}>
              + {money(preview.admin_fee)} (Biaya Admin)
            </span>
          )}
        </div>
      </div>

      <div className="draft-safety"><ShieldCheck size={15} /><span><b>Menunggu persetujuan Anda</b> — Douit belum menyimpan data.</span></div>

      <div className="draft-actions">
        <button className="button primary" disabled={loading} onClick={() => void handleDecision(draft.id, "approve")}>
          {loading ? "Menyimpan..." : <><Check size={16} /> Setujui &amp; simpan</>}
        </button>
        <button className="button secondary" type="button" disabled={loading} onClick={() => onEdit(draft)}><PencilLine size={15} /> Edit lewat chat</button>
        <button className="button quiet-danger" disabled={loading} onClick={() => void handleDecision(draft.id, "reject")}><Trash2 size={15} /> Tolak</button>
      </div>
    </article>
  );
}
