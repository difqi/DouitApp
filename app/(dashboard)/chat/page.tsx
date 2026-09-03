"use client";

import {
  ArrowRight,
  Bot,
  CalendarDays,
  Check,
  CircleAlert,
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
  X
} from "lucide-react";
import { useRouter } from "next/navigation";
import * as Popover from "@radix-ui/react-popover";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useDouit } from "../../providers/DouitProvider";
import { createClient } from "@/lib/supabase/client";
import { triggerBudgetAlertCheck } from "@/app/actions/savings-alert";
import { SYSTEM_CATEGORY_NAMES } from "@/lib/categories";
import { resolveNormalTransactionKind } from "@/lib/transaction-semantics";
import { BankLogo } from "@/app/components/BankLogo";
import { CategoryIcon } from "@/app/components/CategoryIcon";
import type { TransactionDraftPreview } from "@/types";

type Message = { id: string; role: "user" | "assistant"; content: string; message_kind: string; action_draft_id: string | null; created_at: string };
type ActionDraft = { id: string; action_type: string; status: "pending" | "approved" | "rejected" | "failed"; preview: TransactionDraftPreview; executed_entity_id?: string | null };
type ChatSession = { id: string; title: string; created_at: string; is_pinned?: boolean };
type ChatApiResponse = {
  sessionId?: string;
  draftId?: string | null;
  preview?: Record<string, unknown> | null;
  draftUpdated?: boolean;
  reply?: string;
  needsClarification?: boolean;
  missingFields?: string[];
  requestId?: string;
  error?: string;
  errorKind?: "unauthorized" | "invalid_request" | "session" | "database" | "provider" | "internal";
};

const WELCOME_MESSAGE = "Halo! Aku Douit, asisten keuanganmu. Kamu bisa langsung ceritakan transaksi atau tanya soal keuangan.";

const PROMPT_SUGGESTIONS = [
  "Hari ini jam 7 malam beli bensin 30k pakai BRI",
  "Tadi siang jam 12 makan siang 25k tunai",
  "Hari ini jam 4 sore terima bayaran freelance 500k ke BCA",
  "Kemarin jam 20.00 laundry 30k pakai GoPay",
];

const money = (value: unknown) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(value ?? 0));
const messageTime = (value: string) => new Date(value).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }).replace(".", ":");
const sessionTime = (value: string) => new Date(value).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: new Date(value).getFullYear() === new Date().getFullYear() ? undefined : "numeric", timeZone: "Asia/Jakarta" });
const elapsedMs = (startedAt: number) => Math.round(performance.now() - startedAt);
const normalizeDraftStatus = (value: unknown): ActionDraft["status"] => {
  if (value === "approved" || value === "rejected" || value === "failed") return value;
  // Legacy previews used uppercase APPROVED for the future transaction status,
  // while the draft itself was still waiting for user confirmation.
  return "pending";
};
const logChatClient = (requestId: string, phase: string, metadata: Record<string, unknown> = {}, level: "info" | "warn" | "error" = "info") => {
  console[level]({ scope: "douit_ai_chat_client", requestId, phase, ...metadata });
};
const chatErrorCopy = (errorKind: ChatApiResponse["errorKind"], status: number): string => {
  if (errorKind === "provider" || status === 503) return "Douit lagi agak lama merespons. Coba kirim lagi sebentar ya.";
  if (errorKind === "unauthorized" || status === 401) return "Sesi kamu sudah berakhir. Masuk lagi, lalu coba kirim pesannya ya.";
  if (errorKind === "session" || status === 404) return "Percakapan ini sudah tidak tersedia. Mulai chat baru, ya.";
  if (errorKind === "invalid_request" || status === 400) return "Pesannya belum bisa aku proses. Coba periksa lalu kirim lagi ya.";
  if (errorKind === "database") return "Aku belum bisa menyimpan percakapan ini. Coba kirim lagi ya.";
  return "Ada kendala sebentar. Coba kirim lagi ya.";
};

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
  const [editingDraft, setEditingDraft] = useState<ActionDraft | null>(null);

  // Chat history action state
  const [menuSessionId, setMenuSessionId] = useState<string | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editTitleInput, setEditTitleInput] = useState("");

  const composerInput = useRef<HTMLTextAreaElement>(null);
  const messagesEnd = useRef<HTMLDivElement>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const viewRevisionRef = useRef(0);
  const chatRequestControllerRef = useRef<AbortController | null>(null);

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
    return () => {
      chatRequestControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!activeSessionId) {
      setMessages([
        { id: "msg-0", role: "assistant", content: WELCOME_MESSAGE, message_kind: "text", action_draft_id: null, created_at: new Date().toISOString() }
      ]);
      setDrafts({});
    }
  }, [activeSessionId]);

  useEffect(() => {
    const textarea = composerInput.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 112)}px`;
  }, [input]);

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ block: "end", behavior: sending ? "smooth" : "auto" });
  }, [drafts, messages, sending]);

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
    chatRequestControllerRef.current?.abort();
    const viewRevision = ++viewRevisionRef.current;
    activeSessionIdRef.current = sessionId;
    setActiveSessionId(sessionId);
    setHistoryOpen(false);
    setMenuSessionId(null);
    setEditingSessionId(null);
    setEditingDraft(null);
    const supabase = createClient();
    const { data, error } = await supabase.from('chat_messages').select('*').eq('session_id', sessionId).order('created_at', { ascending: true });
    if (error) {
      logChatClient(crypto.randomUUID(), "session_load_failed", { errorCode: error.code }, "error");
      return;
    }
    // Ignore a slower response from a session that is no longer the active view.
    if (viewRevision !== viewRevisionRef.current) return;
    if (data) {
      const loadedDrafts: Record<string, ActionDraft> = {};
      const newMessages = data.map(m => {
        if (m.action_draft_id && m.draft_data) {
          const draftStatus = normalizeDraftStatus((m.draft_data as Record<string, unknown>)?.status);
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
      setDrafts(loadedDrafts);
      setMessages(newMessages);
    }
  };

  const newSession = () => {
    chatRequestControllerRef.current?.abort();
    viewRevisionRef.current += 1;
    activeSessionIdRef.current = null;
    setActiveSessionId(null);
    setHistoryOpen(false);
    setMenuSessionId(null);
    setEditingSessionId(null);
    setEditingDraft(null);
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

    const requestId = crypto.randomUUID();
    const submitStartedAt = performance.now();
    const originSessionId = activeSessionIdRef.current;
    const originViewRevision = viewRevisionRef.current;
    const targetDraftId = editingDraft?.id || null;
    const requestController = new AbortController();
    chatRequestControllerRef.current = requestController;
    setSending(true); setInput(""); setEditingDraft(null);

    const userMsg: Message = { id: `local-${Date.now()}`, role: "user", content: text, message_kind: "text", action_draft_id: null, created_at: new Date().toISOString() };
    setMessages(current => [...current, userMsg]);
    window.requestAnimationFrame(() => {
      const renderMs = elapsedMs(submitStartedAt);
      logChatClient(requestId, "optimistic_ui_rendered", {
        optimisticBubbleMs: renderMs,
        typingIndicatorMs: renderMs,
      });
    });

    const requestStartedAt = performance.now();
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-request-id': requestId },
        body: JSON.stringify({ message: text, sessionId: originSessionId, targetDraftId }),
        signal: requestController.signal,
      });
      const responseHeadersAt = performance.now();
      const data = (await res.json()) as ChatApiResponse;
      const responseReceivedAt = performance.now();
      const correlatedRequestId = data.requestId || res.headers.get('x-request-id') || requestId;
      logChatClient(correlatedRequestId, "response_received", {
        requestMs: Math.round(responseReceivedAt - requestStartedAt),
        responseBodyMs: Math.round(responseReceivedAt - responseHeadersAt),
        status: res.status,
        needsClarification: Boolean(data.needsClarification),
      }, res.ok ? "info" : "warn");

      const stillOnOriginatingView = viewRevisionRef.current === originViewRevision;
      if (!stillOnOriginatingView) {
        logChatClient(correlatedRequestId, "response_not_rendered", { reason: "active_session_changed" }, "warn");
        void fetchSessions();
        return;
      }

      if (data.sessionId && !originSessionId) {
        activeSessionIdRef.current = data.sessionId;
        setActiveSessionId(data.sessionId);
        void fetchSessions();
      } else if (originSessionId && data.sessionId && data.sessionId !== originSessionId) {
        logChatClient(correlatedRequestId, "response_not_rendered", { reason: "session_mismatch" }, "error");
        return;
      }

      let newMsg: Message;
      if (!data.needsClarification && data.draftId && data.preview) {
        setDrafts(prev => ({
          ...prev,
          [data.draftId as string]: {
            id: data.draftId as string,
            action_type: "create_transaction",
            status: "pending",
            preview: data.preview!
          }
        }));
        newMsg = {
          id: `ai-${Date.now()}`,
          role: "assistant",
          content: data.reply || "Siap, cek detailnya ya.",
          message_kind: "text",
          // The original message keeps the only card attachment. A patch only refreshes
          // its shared draft state, so the follow-up reply cannot render a duplicate card.
          action_draft_id: data.draftUpdated ? null : data.draftId,
          created_at: new Date().toISOString(),
        };
      } else {
        const requestFailed = !res.ok || Boolean(data.error);
        newMsg = { id: `${requestFailed ? "err" : "ai"}-${Date.now()}`, role: "assistant", content: requestFailed ? chatErrorCopy(data.errorKind, res.status) : data.reply || "Aku belum menangkap maksudnya. Bisa ceritakan sedikit lagi?", message_kind: requestFailed ? "error" : "text", action_draft_id: null, created_at: new Date().toISOString() };
      }
      setMessages(current => [...current, newMsg]);
      window.requestAnimationFrame(() => {
        logChatClient(correlatedRequestId, "assistant_rendered", {
          responseToRenderMs: elapsedMs(responseReceivedAt),
        });
      });
    } catch (error) {
      if (requestController.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        logChatClient(requestId, "request_aborted", {
          requestMs: elapsedMs(requestStartedAt),
          reason: "view_changed_or_unmounted",
        }, "warn");
        return;
      }
      logChatClient(requestId, "request_failed", {
        requestMs: elapsedMs(requestStartedAt),
        errorType: error instanceof Error ? error.name : "Error",
      }, "error");
      if (viewRevisionRef.current === originViewRevision) {
        setMessages(current => [...current, { id: `err-${Date.now()}`, role: "assistant", content: "Koneksinya terputus. Coba kirim lagi ya.", message_kind: "error", action_draft_id: null, created_at: new Date().toISOString() }]);
      }
    } finally {
      if (chatRequestControllerRef.current === requestController) {
        chatRequestControllerRef.current = null;
        setSending(false);
      }
    }
  }

  async function reviewAction(actionId: string, decision: "approve" | "reject") {
    const supabase = createClient();
    const draft = drafts[actionId];
    const actionSessionId = activeSessionIdRef.current;
    const approvalRequestId = crypto.randomUUID();
    const approvalStartedAt = performance.now();

    if (!draft || !actionSessionId) {
      logChatClient(approvalRequestId, "approval_failed", {
        reason: !draft ? "draft_not_found" : "session_not_found",
      }, "error");
      return;
    }
    if (draft.status !== "pending" && draft.status !== "failed") {
      logChatClient(approvalRequestId, "approval_failed", { reason: "draft_not_pending" }, "warn");
      return;
    }

    if (decision === "reject") {
      const draftStatusStartedAt = performance.now();
      const { error: rejectError } = await supabase
        .from('chat_messages')
        .update({ draft_data: { ...draft.preview, status: 'rejected' } })
        .eq('action_draft_id', actionId)
        .eq('session_id', actionSessionId);
      const draftStatusUpdateMs = elapsedMs(draftStatusStartedAt);

      if (rejectError) {
        logChatClient(approvalRequestId, "rejection_failed", {
          totalMs: elapsedMs(approvalStartedAt),
          draftStatusUpdateMs,
          errorCode: rejectError.code,
        }, "error");
        return;
      }

      setDrafts(prev => ({
        ...prev,
        [actionId]: { ...prev[actionId], status: "rejected" }
      }));
      logChatClient(approvalRequestId, "rejection_complete", {
        totalMs: elapsedMs(approvalStartedAt),
        draftStatusUpdateMs,
      });
      return;
    }

    logChatClient(approvalRequestId, "approval_start");
    let authMs = 0;
    let transactionInsertMs = 0;
    let draftStatusUpdateMs = 0;
    let merchantRuleMs = 0;

    try {
      const txPayload: any = {
        amount: Number(draft.preview.amount),
        type: String(draft.preview.type),
        merchant: String(draft.preview.merchant || draft.preview.name || ""),
        category_id: draft.preview.category_id ? String(draft.preview.category_id) : null,
        subcategory_id: null,
        sumber_dana: draft.preview.sumber_dana ? String(draft.preview.sumber_dana) : 'Tunai',
        status: 'APPROVED',
        source: 'MANUAL_CHAT',
        confidence_score: 1.0,
        notes: draft.preview.notes ? String(draft.preview.notes) : null,
        idempotency_key: `chat:${actionId}`,
      };
      if (draft.preview.transaction_date) {
        txPayload.transaction_date = String(draft.preview.transaction_date);
      }

      const authStartedAt = performance.now();
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      authMs = elapsedMs(authStartedAt);
      if (authError || !user) {
        setDrafts(prev => ({ ...prev, [actionId]: { ...prev[actionId], status: "failed" } }));
        logChatClient(approvalRequestId, "approval_failed", {
          reason: "unauthorized",
          authMs,
          totalMs: elapsedMs(approvalStartedAt),
          errorCode: authError?.code || null,
        }, "error");
        return;
      }

      txPayload.user_id = user.id;
      if (!txPayload.category_id) {
        setDrafts(prev => ({ ...prev, [actionId]: { ...prev[actionId], status: "failed" } }));
        logChatClient(approvalRequestId, "approval_failed", {
          reason: "category_validation",
          authMs,
          totalMs: elapsedMs(approvalStartedAt),
          errorCode: null,
        }, "error");
        return;
      }
      {
        const { data: safeCategory, error: categoryError } = await supabase
          .from('categories')
          .select('id, user_id, name, type, is_system')
          .eq('id', txPayload.category_id)
          .eq('type', txPayload.type)
          .or(`user_id.eq.${user.id},and(is_system.eq.true,user_id.is.null)`)
          .maybeSingle();
        if (categoryError || !safeCategory) {
          setDrafts(prev => ({ ...prev, [actionId]: { ...prev[actionId], status: "failed" } }));
          logChatClient(approvalRequestId, "approval_failed", {
            reason: "category_validation",
            authMs,
            totalMs: elapsedMs(approvalStartedAt),
            errorCode: categoryError?.code || null,
          }, "error");
          return;
        }
        txPayload.transaction_kind = resolveNormalTransactionKind(safeCategory);
      }
      const payloads = [txPayload];

      if (Number(draft.preview.admin_fee) > 0) {
        const { data: feeCategory, error: feeCategoryError } = await supabase
          .from('categories')
          .select('id')
          .eq('name', SYSTEM_CATEGORY_NAMES.ADMIN_FEE)
          .eq('is_system', true)
          .is('user_id', null)
          .maybeSingle();
        if (feeCategoryError) {
          logChatClient(approvalRequestId, "admin_fee_category_lookup_failed", {
            errorCode: feeCategoryError.code,
          }, "warn");
        }
        payloads.push({
          ...txPayload,
          amount: Number(draft.preview.admin_fee),
          type: 'EXPENSE',
          merchant: `Biaya Admin ${txPayload.sumber_dana}`,
          category_id: feeCategory?.id || null,
          transaction_kind: 'FEE',
          status: feeCategory ? 'APPROVED' : 'PENDING_APPROVAL',
          idempotency_key: `chat:${actionId}:admin-fee`,
        });
      }

      const transactionInsertStartedAt = performance.now();
      const { error: insertError } = await supabase.from('transactions').insert(payloads);
      transactionInsertMs = elapsedMs(transactionInsertStartedAt);
      const idempotentReplay = insertError?.code === '23505';

      if (insertError && !idempotentReplay) {
        setDrafts(prev => ({ ...prev, [actionId]: { ...prev[actionId], status: "failed" } }));
        logChatClient(approvalRequestId, "approval_failed", {
          reason: "transaction_insert",
          authMs,
          transactionInsertMs,
          totalMs: elapsedMs(approvalStartedAt),
          errorCode: insertError.code,
        }, "error");
        return;
      }

      if (txPayload.type === 'EXPENSE') {
        triggerBudgetAlertCheck()
          .then((result) => {
            if (!result.success) {
              logChatClient(approvalRequestId, "budget_alert_failed", { errorType: "ActionFailed" }, "warn");
            }
          })
          .catch((error) => {
            logChatClient(approvalRequestId, "budget_alert_failed", {
              errorType: error instanceof Error ? error.name : "Error",
            }, "warn");
          });
      }

      // Learning and draft metadata are independent after the durable financial insert.
      const merchantRulePromise = (async () => {
        if (!txPayload.merchant || !txPayload.category_id) return null;
        const startedAt = performance.now();
        const { error } = await supabase.from('merchant_rules').upsert({
          user_id: user.id,
          merchant_name: txPayload.merchant,
          category_id: txPayload.category_id,
          sumber_dana: txPayload.sumber_dana,
        }, { onConflict: 'user_id, merchant_name' });
        merchantRuleMs = elapsedMs(startedAt);
        return error;
      })();
      const draftStatusPromise = (async () => {
        const startedAt = performance.now();
        const { error } = await supabase
          .from('chat_messages')
          .update({ draft_data: { ...draft.preview, status: 'approved' } })
          .eq('action_draft_id', actionId)
          .eq('session_id', actionSessionId);
        draftStatusUpdateMs = elapsedMs(startedAt);
        return error;
      })();
      const [merchantRuleError, draftStatusError] = await Promise.all([
        merchantRulePromise,
        draftStatusPromise,
      ]);

      if (merchantRuleError) {
        logChatClient(approvalRequestId, "merchant_rule_learning_failed", {
          errorCode: merchantRuleError.code,
          merchantRuleMs,
        }, "warn");
      }

      // The financial insert already succeeded; keep the local card approved even if chat metadata sync fails.
      setDrafts(prev => ({ ...prev, [actionId]: { ...prev[actionId], status: "approved" } }));
      if (draftStatusError) {
        logChatClient(approvalRequestId, "draft_status_update_failed", {
          errorCode: draftStatusError.code,
          draftStatusUpdateMs,
        }, "error");
      }

      logChatClient(approvalRequestId, "approval_complete", {
        totalMs: elapsedMs(approvalStartedAt),
        authMs,
        transactionInsertMs,
        draftStatusUpdateMs,
        merchantRuleMs,
        idempotentReplay,
        draftStatusPersisted: !draftStatusError,
      });
    } catch (error) {
      setDrafts(prev => ({ ...prev, [actionId]: { ...prev[actionId], status: "failed" } }));
      logChatClient(approvalRequestId, "approval_failed", {
        reason: "unexpected",
        totalMs: elapsedMs(approvalStartedAt),
        authMs,
        transactionInsertMs,
        draftStatusUpdateMs,
        merchantRuleMs,
        errorType: error instanceof Error ? error.name : "Error",
      }, "error");
    }
  }

  function editAction(draft: ActionDraft) {
    setEditingDraft(draft);
    setInput("");
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
        className={`history-session-item group relative flex items-center justify-between w-full min-h-[38px] px-2.5 py-1.5 rounded-xl cursor-pointer transition-all duration-150 ${s.id === activeSessionId
            ? "active bg-white text-slate-900 shadow-xs border border-slate-200/80 font-semibold"
            : "text-slate-600 hover:bg-slate-200/60 hover:text-slate-900 border border-transparent"
        }`}
      >
        <button
          type="button"
          className="history-session-button"
          aria-current={s.id === activeSessionId ? "true" : undefined}
          onClick={() => void loadSession(s.id)}
        >
          {s.is_pinned && (
            <Pin size={12} className="text-emerald-600 shrink-0 fill-emerald-600/30" />
          )}
          <span className="history-session-copy">
            <b>{s.title}</b>
            <small>{sessionTime(s.created_at)}</small>
          </span>
        </button>

        <Popover.Root
          open={menuSessionId === s.id}
          onOpenChange={(open) => setMenuSessionId(open ? s.id : null)}
        >
          <Popover.Trigger asChild>
            <button
              type="button"
              data-chat-menu
              aria-label="Menu percakapan"
              aria-haspopup="menu"
              onMouseDown={(event) => event.stopPropagation()}
              className={`history-item-menu-button p-1 rounded-md cursor-pointer transition-all active:scale-95 ${menuSessionId === s.id
                  ? "opacity-100 bg-slate-200 text-slate-700"
                  : "opacity-0 group-hover:opacity-100 text-slate-400 hover:text-slate-700 hover:bg-slate-200/70"
                }`}
            >
              <MoreVertical size={14} />
            </button>
          </Popover.Trigger>

          <Popover.Portal>
            <Popover.Content
              data-chat-menu
              className="history-item-menu rounded-xl bg-white p-1.5 shadow-xl border border-slate-100 z-[60]"
              role="menu"
              side="bottom"
              align="end"
              sideOffset={6}
              collisionPadding={12}
              avoidCollisions
              sticky="always"
              updatePositionStrategy="always"
            >
              {/* Pin Option */}
              <button
                type="button"
                role="menuitem"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  handleTogglePin(s.id);
                  setMenuSessionId(null);
                }}
                className="history-menu-action w-full flex items-center gap-2.5 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer transition-colors"
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
                role="menuitem"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  handleStartRename(s.id);
                  setMenuSessionId(null);
                }}
                className="history-menu-action w-full flex items-center gap-2.5 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer transition-colors"
              >
                <PencilLine className="w-4 h-4 text-slate-500 shrink-0" />
                <span>Ganti nama</span>
              </button>

              <div className="my-1 border-t border-slate-100" />

              {/* Delete Option */}
              <button
                type="button"
                role="menuitem"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteSession(s.id);
                  setMenuSessionId(null);
                }}
                className="history-menu-action danger w-full flex items-center gap-2.5 px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer transition-colors"
              >
                <Trash2 className="w-4 h-4 text-rose-500 shrink-0" />
                <span>Hapus</span>
              </button>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
    );
  };

  return (
    <div className="chat-layout">
      <aside className={`chat-history ${historyOpen ? "open" : ""}`} role="dialog" aria-modal="true" aria-label="Riwayat percakapan" aria-hidden={!historyOpen}>
        <div className="history-heading">
          <span><History size={16} /> Riwayat percakapan</span>
          <button aria-label="Tutup riwayat" onClick={() => setHistoryOpen(false)}><X size={18} /></button>
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
          <p><b>Data keuanganmu aman</b><br />AI hanya menggunakan data akun {business?.name}.</p>
        </div>
      </aside>

      {historyOpen && <button className="history-scrim" aria-label="Tutup riwayat" onClick={() => setHistoryOpen(false)} />}

      <section className="chat-workspace">
        <header className="chat-header">
          <button className="history-toggle" onClick={() => setHistoryOpen(true)} aria-label="Buka riwayat"><History size={18} /></button>
          <div className="ai-avatar"><Sparkles size={17} /></div>
          <div><h1>Douit AI</h1><p><i /> Asisten keuangan pribadimu</p></div>
          <div className="safe-mode"><ShieldCheck size={15} /> Setiap transaksi butuh persetujuan</div>
        </header>

        <div className="messages" aria-live="polite" aria-busy={sending}>
          {messages.map(message => {
            const draft = message.action_draft_id ? drafts[message.action_draft_id] : null;
            const showDraftPrompt = draft && (draft.status === "pending" || draft.status === "failed");
            return (
              <div className={`message-row ${message.role === "user" ? "user-message" : "assistant-message"} ${message.message_kind === "error" || message.id.startsWith("err-") ? "error-message" : ""}`} key={message.id}>
                {message.role === "assistant" && <div className="small-avatar ai"><Bot size={16} /></div>}
                <div className={`assistant-stack ${draft ? "wide" : ""}`}>
                  {(!draft || showDraftPrompt) && <div className={`message-bubble ${message.role === "assistant" ? "rich" : ""}`}><p>{message.content}</p></div>}
                  {draft && <DraftCard draft={draft} disabled={sending} onDecision={reviewAction} onEdit={editAction} onOpenSaved={openSavedData} />}
                  <span className="message-meta">{message.role === "assistant" ? "Douit AI" : "Kamu"} · {messageTime(message.created_at)}</span>
                </div>
              </div>
            );
          })}
          {sending && (
            <div className="message-row assistant-message activity-message" role="status">
              <div className="small-avatar ai"><Bot size={16} /></div>
              <div className="activity-bubble"><span className="activity-dots" aria-hidden="true"><i /><i /><i /></span><span>Douit sedang memahami transaksi...</span></div>
            </div>
          )}
          <div ref={messagesEnd} className="messages-end" aria-hidden="true" />
        </div>

        <footer className="composer-area">
          {editingDraft && (
            <div className="edit-context" role="status">
              <PencilLine size={14} />
              <span>Mengedit transaksi: <b>{String(editingDraft.preview.merchant ?? editingDraft.preview.name ?? "Transaksi")} · {money(editingDraft.preview.amount)}</b></span>
              <button type="button" aria-label="Tutup konteks edit" onClick={() => setEditingDraft(null)}><X size={15} /></button>
            </div>
          )}
          <div className="prompt-chips">
            {PROMPT_SUGGESTIONS.map((suggestion, index) => (
              <button
                key={index}
                type="button"
                onClick={() => {
                  setEditingDraft(null);
                  setInput(suggestion);
                  composerInput.current?.focus();
                }}
                title={suggestion}
                aria-pressed={input === suggestion}
                className="prompt-chip"
              >
                {suggestion}
              </button>
            ))}
          </div>
          <form className="composer" onSubmit={submitMessage}>
            <button type="button" aria-label="Lampirkan file"><Paperclip size={18} /></button>
            <textarea
              ref={composerInput}
              value={input}
              onChange={event => setInput(event.target.value)}
              onKeyDown={event => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              rows={1}
              placeholder={editingDraft ? "Tulis bagian yang mau diubah..." : "Catat pengeluaran atau tanya keuangan..."}
              aria-label="Pesan untuk Douit AI"
              disabled={sending}
              onFocus={() => window.requestAnimationFrame(() => messagesEnd.current?.scrollIntoView({ block: "end" }))}
            />
            <span className="composer-hint">Enter untuk kirim</span>
            <button className="send-button" type="submit" aria-label={sending ? "Sedang mengirim pesan" : "Kirim pesan"} disabled={sending || !input.trim()}><Send size={17} /></button>
          </form>
          <p>Douit dapat membuat kesalahan. Selalu periksa detail keuangan sebelum menyetujui.</p>
        </footer>
      </section>
    </div>
  );
}

function DraftCard({ draft, disabled, onDecision, onEdit, onOpenSaved }: { draft: ActionDraft; disabled: boolean; onDecision: (id: string, decision: "approve" | "reject") => Promise<void>; onEdit: (draft: ActionDraft) => void; onOpenSaved: () => void }) {
  const [loading, setLoading] = useState(false);

  const handleDecision = async (id: string, decision: "approve" | "reject") => {
    setLoading(true);
    try {
      await onDecision(id, decision);
    } finally {
      setLoading(false);
    }
  };

  const preview = draft.preview ?? {};
  const merchant = String(preview.merchant ?? preview.name ?? "Transaksi");
  const category = String(preview.category ?? "Lain-lain");
  const account = String(preview.sumber_dana ?? "Tunai");
  const transactionType = String(preview.type).toUpperCase() === "INCOME" ? "Pemasukan" : "Pengeluaran";
  const transactionDate = preview.transaction_date
    ? new Date(String(preview.transaction_date)).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" })
    : null;
  const transactionTime = typeof preview.transaction_time === "string"
    && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(preview.transaction_time)
    ? preview.transaction_time
    : null;

  if (draft.status === "approved") return (
    <div className="success-card">
      <span className="success-icon"><CircleCheck size={18} /></span>
      <div><h3>Transaksi berhasil dicatat</h3><p>{merchant} · {money(preview.amount)}</p></div>
      <button type="button" onClick={onOpenSaved}>Lihat transaksi <ArrowRight size={14} /></button>
    </div>
  );
  if (draft.status === "rejected") return (
    <div className="rejected-card">
      <span><X size={17} /></span>
      <div><h3>Transaksi tidak disimpan</h3><p>Draft {merchant} sudah dibatalkan.</p></div>
    </div>
  );

  return (
    <article className={`draft-card ${draft.status === "failed" ? "failed" : ""}`}>
      <div className="draft-card-header">
        <div>
          <span className="draft-icon"><FileText size={19} /></span>
          <span><small>TRANSAKSI BARU</small><h2>{draft.status === "failed" ? "Perlu dicoba lagi" : "Menunggu persetujuan"}</h2></span>
        </div>
        <span className="draft-badge">Belum disimpan</span>
      </div>

      <div className="draft-summary">
        <div className="draft-merchant"><small>{transactionType}</small><b>{merchant}</b></div>
        <div className="draft-amount">
          <b>{money(preview.amount)}</b>
          {Boolean(preview.admin_fee) && Number(preview.admin_fee) > 0 && (
            <span>+ {money(preview.admin_fee)} biaya admin</span>
          )}
        </div>
      </div>

      <div className="draft-details">
        <div><span className="draft-detail-icon"><CategoryIcon category={category} /></span><span><small>Kategori</small><b>{category}</b></span></div>
        <div><span className="draft-account-logo"><BankLogo bankName={account} className="draft-bank-logo" /></span><span><small>Rekening / sumber dana</small><b>{account}</b></span></div>
      </div>

      <div className="draft-meta">
        <span><Bot size={13} /> Dibuat dari percakapan AI</span>
        {transactionDate && (
          <span><CalendarDays size={13} /> {transactionDate}{transactionTime ? ` · ${transactionTime} WIB` : ""}</span>
        )}
        {!transactionTime && <span>Jam opsional · tambahkan lewat chat jika perlu</span>}
      </div>

      {draft.status === "failed" && (
        <div className="draft-safety warning">
          <CircleAlert size={15} />
          <span><b>Transaksi gagal disimpan.</b> Periksa koneksi lalu coba lagi.</span>
        </div>
      )}

      <div className="draft-actions">
        <button className="button primary" disabled={loading || disabled} onClick={() => void handleDecision(draft.id, "approve")}>
          {loading ? <><span className="button-spinner" aria-hidden="true" /> Menyimpan...</> : <><Check size={16} /> {draft.status === "failed" ? "Coba simpan lagi" : "Setujui & simpan"}</>}
        </button>
        <button className="button secondary" type="button" disabled={loading || disabled} onClick={() => onEdit(draft)}><PencilLine size={15} /><span className="desktop-action-copy">Edit lewat chat</span><span className="mobile-action-copy">Edit</span></button>
        <button className="button quiet-danger" type="button" disabled={loading || disabled} onClick={() => void handleDecision(draft.id, "reject")}><Trash2 size={15} /> Tolak</button>
      </div>
    </article>
  );
}
