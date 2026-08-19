"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import {
  PiggyBank,
  Flame,
  Target,
  Plus,
  Sparkles,
  Calendar,
  TrendingUp,
  Wallet,
  Clock,
  Coins,
  CheckCircle2,
  Bell,
  Trash2,
  ShoppingBag,
  X,
  ShieldCheck,
  Smartphone,
  Building2,
  AlertCircle,
  ChevronRight,
  ArrowUpRight,
  RefreshCw,
  Info
} from "lucide-react";
import { useDouit } from "@/app/providers/DouitProvider";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { ConfirmDialog } from "@/app/components/ui/ConfirmDialog";
import { CustomDatePicker } from "@/app/components/ui/CustomDatePicker";
import { CustomTimePicker } from "@/app/components/ui/CustomTimePicker";
import { calculateGoalMetrics, calculateGlobalDisciplineStreak, SavingsGoal as SavingsGoalCalc } from "@/lib/savings-calc";

interface SavingsGoal {
  id: string;
  user_id: string;
  title: string;
  target_amount: number;
  current_amount: number;
  daily_target: number;
  max_daily_expense?: number | null;
  product_url?: string | null;
  start_date: string;
  target_date: string;
  image_url: string | null;
  storage_type: 'GOPAY_MERCHANT' | 'TUNAI' | 'BANK_TRANSFER';
  storage_detail: string | null;
  account_name?: string | null;
  reminder_times?: string[];
  reminder_time?: string;
  whatsapp_number: string | null;
  mode: 'RELAXED' | 'DISCIPLINED';
  accumulated_time_debt?: number;
  total_delay_days?: number;
  streak_count: number;
  streak_days?: number;
  last_deposit_date: string | null;
  status: 'ACTIVE' | 'COMPLETED' | 'PAUSED';
  created_at: string;
  updated_at: string;
  savings_logs?: { id: string; amount: number; created_at: string }[];
}

export default function NabungPage() {
  const { user } = useDouit();
  const [goals, setGoals] = useState<SavingsGoal[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals state
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [depositModalOpen, setDepositModalOpen] = useState(false);
  const [selectedGoal, setSelectedGoal] = useState<SavingsGoal | null>(null);

  // Create Form State
  const [title, setTitle] = useState("");
  const [targetAmount, setTargetAmount] = useState<string>("");
  const [maxDailyExpense, setMaxDailyExpense] = useState<string>("");
  const [durationMode, setDurationMode] = useState<'DAYS' | 'DATE'>('DAYS');
  const [daysCount, setDaysCount] = useState<string>("30");
  const [targetDate, setTargetDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().split('T')[0];
  });
  const [storageType, setStorageType] = useState<'GOPAY_MERCHANT' | 'TUNAI' | 'BANK_TRANSFER'>('GOPAY_MERCHANT');
  const [storageDetail, setStorageDetail] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [reminderCount, setReminderCount] = useState<number>(1);
  const [reminderTimes, setReminderTimes] = useState<string[]>(['08:00']);

  // WhatsApp OTP Verification State
  const phoneInputRef = useRef<HTMLInputElement>(null);
  const [userProfile, setUserProfile] = useState<{ whatsapp_number: string; is_whatsapp_verified: boolean } | null>(null);
  const [isVerified, setIsVerified] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [remainingAttempts, setRemainingAttempts] = useState(3);
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);

  // 60s Countdown Timer Effect
  useEffect(() => {
    if (cooldown > 0) {
      const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [cooldown]);

  const handleFrequencyChange = (count: number) => {
    setReminderCount(count);
    if (count === 1) setReminderTimes(['08:00']);
    else if (count === 2) setReminderTimes(['08:00', '19:00']);
    else if (count === 3) setReminderTimes(['08:00', '13:00', '20:00']);
  };

  const handleTimeChange = (index: number, val: string) => {
    const newTimes = [...reminderTimes];
    newTimes[index] = val;
    setReminderTimes(newTimes);
  };
  const [mode, setMode] = useState<'RELAXED' | 'DISCIPLINED'>('RELAXED');
  const [productUrl, setProductUrl] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [submittingText, setSubmittingText] = useState<string>("Mencari produk di Tokopedia & Shopee...");
  const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({});
  const [deleteGoalId, setDeleteGoalId] = useState<string | null>(null);
  const [isDeletingGoal, setIsDeletingGoal] = useState(false);
  const [createGoalError, setCreateGoalError] = useState<string | null>(null);

  useEffect(() => {
    if (!submitting) {
      setSubmittingText("Mencari produk di Tokopedia & Shopee...");
      return;
    }

    const startTime = Date.now();
    setSubmittingText("Mencari produk di Tokopedia & Shopee...");

    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      if (elapsed < 6) {
        setSubmittingText("Mencari produk di Tokopedia & Shopee...");
      } else if (elapsed < 13) {
        setSubmittingText("Memverifikasi toko dan ketersediaan...");
      } else {
        setSubmittingText("Mengunduh gambar produk...");
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [submitting]);


  // Deposit Form State
  const [depositAmount, setDepositAmount] = useState<string>("");
  const [depositNotes, setDepositNotes] = useState<string>("");
  const [submittingDeposit, setSubmittingDeposit] = useState(false);
  const [todayExpenseTotal, setTodayExpenseTotal] = useState<number>(0);
  const [globalDailyLimit, setGlobalDailyLimit] = useState<number | null>(null);


  const fetchGoals = async (isBackground = false) => {
    if (!user) return;
    if (!isBackground) setLoading(true);
    const supabase = createClient();
    
    // 1. Fetch Goals with savings_logs
    const { data: goalsData } = await supabase
      .from('savings_goals')
      .select('*, savings_logs(id, amount, created_at)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (goalsData) {
      setGoals(goalsData as SavingsGoal[]);
    }

    // 2. Fetch User Profile to get Global Daily Expense Limit & Verified WhatsApp Info
    try {
      const { data: profileData } = await supabase
        .from('profiles')
        .select('daily_expense_limit, whatsapp_number, is_whatsapp_verified')
        .eq('id', user.id)
        .maybeSingle();

      const pLimit = profileData?.daily_expense_limit ? Number(profileData.daily_expense_limit) : null;
      if (pLimit !== null && pLimit > 0) {
        setGlobalDailyLimit(pLimit);
        setMaxDailyExpense((prev) => prev || String(pLimit));
      } else {
        const goalFallback = goalsData?.find((g: any) => Number(g.max_daily_expense) > 0)?.max_daily_expense;
        if (goalFallback) {
          setGlobalDailyLimit(Number(goalFallback));
          setMaxDailyExpense((prev) => prev || String(goalFallback));
        }
      }

      const existingGoalPhone = goalsData?.find((g: any) => g.whatsapp_number)?.whatsapp_number || "";
      const verifiedPhone = profileData?.whatsapp_number || (user as any)?.user_metadata?.whatsapp_number || existingGoalPhone || (user as any)?.phone || "";
      const isPhoneVerified = Boolean(
        profileData?.is_whatsapp_verified ||
        (user as any)?.user_metadata?.is_whatsapp_verified ||
        (existingGoalPhone && existingGoalPhone.length >= 10)
      );

      setUserProfile({
        whatsapp_number: verifiedPhone,
        is_whatsapp_verified: isPhoneVerified,
      });

      if (verifiedPhone && isPhoneVerified) {
        setWhatsappNumber(verifiedPhone);
        setIsVerified(true);
      }
    } catch (err) {
      console.warn("Could not fetch profile data:", err);
    }

    // 3. Fetch today's approved non-savings expenses
    const todayWIB = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

    const { data: txsData } = await supabase
      .from('transactions')
      .select('amount, created_at, type, status, merchant, notes, category_id')
      .eq('user_id', user.id)
      .eq('type', 'EXPENSE')
      .eq('status', 'APPROVED');

    const { data: nabungCategory } = await supabase
      .from('categories')
      .select('id')
      .eq('name', 'Nabung')
      .maybeSingle();

    const nabungCategoryId = nabungCategory?.id;

    if (txsData) {
      const nonSavingsTotal = txsData
        .filter((tx: any) => {
          if (!tx.created_at) return false;
          const txDateWIB = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Jakarta',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(new Date(tx.created_at));
          if (txDateWIB !== todayWIB) return false;

          // Exclude Nabung category
          if (nabungCategoryId && tx.category_id === nabungCategoryId) return false;

          // Exclude merchant / notes mentioning savings
          const merchant = (tx.merchant || '').toLowerCase();
          const notes = (tx.notes || '').toLowerCase();
          if (merchant.startsWith('nabung') || notes.includes('setoran tabungan') || notes.includes('setoran via whatsapp')) {
            return false;
          }

          return true;
        })
        .reduce((sum: number, tx: any) => sum + (Number(tx.amount) || 0), 0);

      setTodayExpenseTotal(nonSavingsTotal);
    }

    if (!isBackground) setLoading(false);
  };


  useEffect(() => {
    if (user) {
      fetchGoals();
      if (user.email) {
        // Pre-fill phone if available in metadata
        const phone = (user as any)?.phone || (user as any)?.user_metadata?.phone || "";
        if (phone) setWhatsappNumber(phone);
      }

      // 1. Instant refresh on window focus / tab visibility change
      const handleFocus = () => fetchGoals(true);
      const handleVisibility = () => {
        if (document.visibilityState === 'visible') fetchGoals(true);
      };
      window.addEventListener('focus', handleFocus);
      document.addEventListener('visibilitychange', handleVisibility);

      // 2. Realtime subscription for instant dashboard updates on deposits/webhook changes/transactions
      const supabase = createClient();
      const channel = supabase
        .channel('savings-goals-realtime')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'savings_goals', filter: `user_id=eq.${user.id}` },
          () => {
            fetchGoals(true);
          }
        )
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'savings_logs', filter: `user_id=eq.${user.id}` },
          () => {
            fetchGoals(true);
          }
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'transactions', filter: `user_id=eq.${user.id}` },
          () => {
            fetchGoals(true);
          }
        )
        .subscribe();

      // 3. Background periodic sync fallback (every 5 seconds when tab is active)
      const interval = setInterval(() => {
        if (document.visibilityState === 'visible') {
          fetchGoals(true);
        }
      }, 5000);

      return () => {
        window.removeEventListener('focus', handleFocus);
        document.removeEventListener('visibilitychange', handleVisibility);
        clearInterval(interval);
        supabase.removeChannel(channel);
      };
    }
  }, [user]);



  // Real-time daily target calculation
  const calculatedDailyTarget = useMemo(() => {
    const numTarget = parseFloat(targetAmount) || 0;
    if (numTarget <= 0) return 0;

    let totalDays = 1;
    if (durationMode === 'DAYS') {
      totalDays = parseInt(daysCount) || 1;
    } else if (targetDate) {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date(targetDate);
      end.setHours(0, 0, 0, 0);
      const diffTime = end.getTime() - start.getTime();
      totalDays = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
    }

    return Math.ceil(numTarget / Math.max(1, totalDays));
  }, [targetAmount, durationMode, daysCount, targetDate]);

  // Overall Stats
  const totalSaved = useMemo(() => {
    return goals.reduce((acc, g) => acc + (g.current_amount || 0), 0);
  }, [goals]);

  const activeGoalsCount = useMemo(() => {
    return goals.filter(g => g.status === 'ACTIVE').length;
  }, [goals]);

  const isGoalLimitReached = activeGoalsCount >= 3;

  const activeGoalsCommitment = useMemo(() => {
    return goals
      .filter(g => g.status === 'ACTIVE')
      .reduce((sum, g) => sum + (Number(g.daily_target) || 0), 0);
  }, [goals]);

  const completedGoalsCount = useMemo(() => {
    return goals.filter(g => g.status === 'COMPLETED').length;
  }, [goals]);

  const toCalcGoal = (g: SavingsGoal): SavingsGoalCalc => ({
    id: g.id,
    name: g.title,
    targetAmount: Number(g.target_amount || 0),
    currentAmount: Number(g.current_amount || 0),
    dailyTarget: Number(g.daily_target || 0),
    startDate: g.start_date || g.created_at?.split('T')[0] || new Date().toISOString().split('T')[0],
    paymentAccount: g.storage_detail || g.account_name || undefined,
    productUrl: g.product_url || undefined,
    status: g.status === 'COMPLETED' ? 'completed' : 'active',
    deposits: (g.savings_logs || []).map((l: any) => ({
      date: l.created_at,
      amount: Number(l.amount || 0),
    })),
  });

  const activeCalcGoals = useMemo(() => {
    return goals.filter(g => g.status === 'ACTIVE').map(toCalcGoal);
  }, [goals]);

  const globalStreak = useMemo(() => {
    return calculateGlobalDisciplineStreak(activeCalcGoals);
  }, [activeCalcGoals]);



  // Create Goal Handler
  const handleCreateGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !title || !targetAmount) return;

    if (activeGoalsCount >= 3) {
      toast.error("Gagal membuat target: Batas maksimal 3 target aktif telah tercapai.");
      return;
    }

    if (whatsappNumber.trim().length > 0 && !isVerified) {
      toast.error("Mohon verifikasi nomor WhatsApp terlebih dahulu sebelum menyimpan target.");
      return;
    }

    setSubmitting(true);
    const supabase = createClient();

    let resolvedProductUrl: string | null = productUrl ? productUrl.trim() : null;
    let resolvedImageUrl: string | null = null;

    try {
      const lookupRes = await fetch('/api/savings/product-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          product_url: productUrl || undefined,
        }),
      });

      if (lookupRes.ok) {
        const lookupData = (await lookupRes.json()) as { product_url?: string; image_url?: string };
        if (lookupData.product_url) resolvedProductUrl = lookupData.product_url;
        if (lookupData.image_url) resolvedImageUrl = lookupData.image_url;
      }
    } catch (lookupErr) {
      console.warn("Product lookup failed, continuing without resolved image/url:", lookupErr);
    }

    let computedTargetDate = targetDate;
    if (durationMode === 'DAYS') {
      const d = new Date();
      d.setDate(d.getDate() + (parseInt(daysCount) || 30));
      computedTargetDate = d.toISOString().split('T')[0];
    }

    const limitNum = maxDailyExpense ? parseFloat(maxDailyExpense) : null;

    const newGoalPayload = {
      user_id: user.id,
      title,
      target_amount: parseFloat(targetAmount),
      current_amount: 0,
      daily_target: calculatedDailyTarget,
      max_daily_expense: limitNum,
      start_date: new Date().toISOString().split('T')[0],
      target_date: computedTargetDate,
      product_url: resolvedProductUrl,
      image_url: resolvedImageUrl,
      storage_type: storageType,
      storage_detail: storageDetail || null,
      reminder_times: reminderTimes.slice(0, reminderCount),
      whatsapp_number: isVerified ? whatsappNumber.trim() : null,
      mode,
      accumulated_time_debt: 0.0,
      total_delay_days: 0,
      streak_count: 0,
      status: 'ACTIVE'
    };

    const { data, error } = await supabase
      .from('savings_goals')
      .insert(newGoalPayload)
      .select()
      .single();

    if (data) {
      // Synchronize global base budget to profiles
      if (limitNum !== null && limitNum > 0) {
        setGlobalDailyLimit(limitNum);
        try {
          await supabase
            .from('profiles')
            .update({ daily_expense_limit: limitNum })
            .eq('id', user.id);
        } catch (syncErr) {
          console.warn("Could not sync daily_expense_limit to profile:", syncErr);
        }
      }

      if (whatsappNumber.trim().length > 0 && isVerified) {
        setUserProfile({
          whatsapp_number: whatsappNumber.trim(),
          is_whatsapp_verified: true,
        });
      }

      setGoals([data as SavingsGoal, ...goals]);
      setCreateModalOpen(false);
      resetCreateForm();
      toast.success("Target impian berhasil dibuat!");
    } else if (error) {
      toast.error(`Gagal membuat target: ${error.message}`);
    }
    setSubmitting(false);
  };

  // Send WhatsApp OTP Handler
  const handleSendOtp = async () => {
    if (!whatsappNumber.trim()) {
      toast.error("Masukkan nomor WhatsApp terlebih dahulu.");
      return;
    }
    setIsSendingOtp(true);
    try {
      const res = await fetch("/api/auth/whatsapp-otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: whatsappNumber }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        message?: string;
        cooldown?: number;
        remainingAttempts?: number;
        phoneNumber?: string;
        [key: string]: any;
      };
      if (data.success) {
        setOtpSent(true);
        setCooldown(data.cooldown || 60);
        if (typeof data.remainingAttempts === "number") {
          setRemainingAttempts(data.remainingAttempts);
        }
        if (data.phoneNumber) {
          setWhatsappNumber(data.phoneNumber);
        }
        toast.success(data.message || "Kode verifikasi berhasil dikirim!");
      } else {
        if (data.cooldown) setCooldown(data.cooldown);
        if (typeof data.remainingAttempts === "number") {
          setRemainingAttempts(data.remainingAttempts);
        }
        toast.error(data.message || "Gagal mengirim kode verifikasi.");
      }
    } catch (err) {
      console.error("Error sending OTP:", err);
      toast.error("Terjadi kesalahan jaringan saat mengirim kode OTP.");
    } finally {
      setIsSendingOtp(false);
    }
  };

  // Verify WhatsApp OTP Handler
  const handleVerifyOtp = async () => {
    if (otpCode.trim().length !== 4) {
      toast.error("Masukkan 4 digit kode verifikasi.");
      return;
    }
    setIsVerifying(true);
    try {
      const res = await fetch("/api/auth/whatsapp-otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: whatsappNumber, otpCode }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        message?: string;
        phoneNumber?: string;
        [key: string]: any;
      };
      if (data.success) {
        setIsVerified(true);
        setOtpSent(false);
        setOtpCode("");
        if (data.phoneNumber) {
          setWhatsappNumber(data.phoneNumber);
        }
        setUserProfile({
          whatsapp_number: data.phoneNumber || whatsappNumber,
          is_whatsapp_verified: true,
        });
        toast.success(data.message || "Nomor WhatsApp berhasil diverifikasi!");
      } else {
        toast.error(data.message || "Kode verifikasi salah atau kedaluwarsa.");
      }
    } catch (err) {
      console.error("Error verifying OTP:", err);
      toast.error("Terjadi kesalahan jaringan saat memverifikasi kode.");
    } finally {
      setIsVerifying(false);
    }
  };

  // Reset Phone Number Handler (Ganti Nomor)
  const handleResetPhoneNumber = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Reset verification states
    setIsVerified(false);
    setOtpSent(false);
    setOtpCode("");
    setCooldown(0); // Clear any lingering cooldown timer

    // Focus the input field immediately
    setTimeout(() => {
      phoneInputRef.current?.focus();
    }, 50);
  };

  const resetCreateForm = () => {
    setTitle("");
    setTargetAmount("");
    setMaxDailyExpense(globalDailyLimit ? String(globalDailyLimit) : "");
    setProductUrl("");
    setDaysCount("30");
    setStorageType("GOPAY_MERCHANT");
    setStorageDetail("");
    setReminderCount(1);
    setReminderTimes(['08:00']);
    setCreateGoalError(null);
    setStep(1);

    const savedPhone =
      userProfile?.whatsapp_number ||
      (user as any)?.user_metadata?.whatsapp_number ||
      goals?.find((g) => g.whatsapp_number)?.whatsapp_number ||
      "";

    const isAlreadyVerified = Boolean(
      userProfile?.is_whatsapp_verified ||
      (user as any)?.user_metadata?.is_whatsapp_verified ||
      (savedPhone && savedPhone.length >= 10)
    );

    if (savedPhone && isAlreadyVerified) {
      setWhatsappNumber(savedPhone);
      setIsVerified(true);
      setOtpSent(false);
      setOtpCode("");
      setCooldown(0);
    } else {
      setWhatsappNumber("");
      setIsVerified(false);
      setOtpSent(false);
      setOtpCode("");
      setCooldown(0);
    }
  };

  useEffect(() => {
    if (createModalOpen) {
      const savedPhone =
        userProfile?.whatsapp_number ||
        (user as any)?.user_metadata?.whatsapp_number ||
        goals?.find((g) => g.whatsapp_number)?.whatsapp_number ||
        "";

      const isAlreadyVerified = Boolean(
        userProfile?.is_whatsapp_verified ||
        (user as any)?.user_metadata?.is_whatsapp_verified ||
        (savedPhone && savedPhone.length >= 10)
      );

      if (savedPhone && isAlreadyVerified) {
        setWhatsappNumber(savedPhone);
        setIsVerified(true);
        setOtpSent(false);
        setOtpCode("");
        setCooldown(0);
      }
    }
  }, [createModalOpen, userProfile, goals]);

  const handleOpenCreateModal = () => {
    if (isGoalLimitReached) {
      toast.warning("Batas Maksimal Tercapai", {
        description: "Anda hanya dapat memiliki maksimal 3 target tabungan aktif secara bersamaan agar tetap fokus dan konsisten. Selesaikan atau hapus salah satu target untuk membuat yang baru.",
        duration: 5000,
      });
      return;
    }
    resetCreateForm();
    setCreateModalOpen(true);
  };

  // Quick Deposit Handler
  const handleOpenDepositModal = (goal: SavingsGoal) => {
    setSelectedGoal(goal);
    setDepositAmount(goal.daily_target ? goal.daily_target.toString() : "");
    setDepositNotes("Setoran Harian");
    setDepositModalOpen(true);
  };


  const handleQuickDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !selectedGoal || !depositAmount) return;

    const amountNum = parseFloat(depositAmount);
    if (amountNum <= 0) return;

    setSubmittingDeposit(true);
    const supabase = createClient();

    // 1. Insert into savings_logs
    const { error: logErr } = await supabase.from('savings_logs').insert({
      goal_id: selectedGoal.id,
      user_id: user.id,
      amount: amountNum,
      notes: depositNotes || 'Setoran manual',
      source_type: 'MANUAL'
    });

    if (logErr) {
      toast.error(`Gagal mencatat setoran: ${logErr.message}`);
      setSubmittingDeposit(false);
      return;
    }

    // 2. Update current_amount, streak & status
    const newCurrent = (selectedGoal.current_amount || 0) + amountNum;
    const isCompleted = newCurrent >= selectedGoal.target_amount;
    const todayStr = new Date().toISOString().split('T')[0];

    let newStreak = selectedGoal.streak_count || 0;
    if (selectedGoal.last_deposit_date !== todayStr) {
      newStreak += 1;
    }

    const { data: updatedGoal, error: updateErr } = await supabase
      .from('savings_goals')
      .update({
        current_amount: newCurrent,
        streak_count: newStreak,
        last_deposit_date: todayStr,
        status: isCompleted ? 'COMPLETED' : selectedGoal.status,
        updated_at: new Date().toISOString()
      })
      .eq('id', selectedGoal.id)
      .select()
      .single();

    if (updatedGoal) {
      setGoals(goals.map(g => g.id === updatedGoal.id ? (updatedGoal as SavingsGoal) : g));
      setDepositModalOpen(false);
      setSelectedGoal(null);
      toast.success("Setoran berhasil dicatat!");
      fetchGoals(true);
    }
    setSubmittingDeposit(false);
  };

  const handleDeleteGoal = (id: string) => {
    setDeleteGoalId(id);
  };

  const confirmDeleteGoal = async () => {
    if (!deleteGoalId) return;
    setIsDeletingGoal(true);
    const supabase = createClient();
    const { error } = await supabase.from('savings_goals').delete().eq('id', deleteGoalId);
    setIsDeletingGoal(false);
    if (error) {
      toast.error(`Gagal menghapus target: ${error.message}`);
      return;
    }
    setGoals(goals.filter(g => g.id !== deleteGoalId));
    setDeleteGoalId(null);
    toast.success("Target nabung berhasil dihapus.");
  };

  const formatRupiah = (val: number) => {
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val);
  };

  const getStorageBadge = (type: string, detail: string | null) => {
    switch (type) {
      case 'GOPAY_MERCHANT':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
            <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
            Rekening QRIS ({detail || 'QRIS Douit'})
          </span>
        );
      case 'BANK_TRANSFER':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-500/10 text-blue-300 border border-blue-500/20">
            <Building2 className="w-3.5 h-3.5 text-blue-400" />
            Rekening ({detail || 'Bank'})
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/10 text-amber-300 border border-amber-500/20">
            <Coins className="w-3.5 h-3.5 text-amber-400" />
            Celengan Fisik ({detail || 'Tunai'})
          </span>
        );
    }
  };

  return (
    <div className="min-h-screen bg-[#faf9f5] text-slate-900 p-4 sm:p-6 lg:p-8">
      {/* HEADER SECTION */}
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-6 border-b border-slate-200">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-100/80 text-emerald-800 text-xs font-semibold mb-2">
            <PiggyBank className="w-4 h-4 text-emerald-600" />
            <span>Smart Savings Assistant</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            Target & Tabungan Impian
          </h1>
          <p className="text-slate-600 text-sm mt-1 max-w-2xl">
            Rencanakan target belanja, pantau progres harian, dan terima motivasi harian via WhatsApp.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          {isGoalLimitReached && (
            <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-700 border border-amber-500/20">
              Batas Maksimal (3/3)
            </span>
          )}
          <button
            onClick={handleOpenCreateModal}
            className={`inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm transition-all shadow-sm cursor-pointer ${
              isGoalLimitReached
                ? "bg-slate-200 text-slate-500 hover:bg-slate-300 border border-slate-300"
                : "bg-gradient-to-r from-[#0F2A1D] to-[#163827] hover:from-[#133525] hover:to-[#1a4430] text-white border border-emerald-700/50 shadow-sm active:scale-[0.98]"
            }`}
          >
            <Plus className={`w-4 h-4 stroke-[2.5] ${isGoalLimitReached ? "text-slate-500" : "text-emerald-400"}`} />
            <span className={isGoalLimitReached ? "text-slate-600 font-semibold" : "text-white font-semibold"}>Tambah Target Baru</span>
          </button>
        </div>
      </div>

      {/* TOP STATS OVERVIEW BENTO GRID */}
      <div className="max-w-7xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-4 my-6">
        {/* Card 1: Total Dana Terkumpul */}
        <div className="relative overflow-hidden bg-[#132A1E] border border-[#1f4230] rounded-2xl p-5 shadow-sm text-white flex flex-col justify-between">
          <div className="absolute -bottom-8 -right-8 w-36 h-36 bg-radial from-amber-400/15 via-lime-400/10 to-transparent rounded-full blur-2xl pointer-events-none" />
          <div className="flex items-center justify-between text-[#A8C9B9] mb-3 relative z-10">
            <span className="text-xs font-semibold uppercase tracking-wider">Total Dana Terkumpul</span>
            <div className="w-9 h-9 rounded-xl bg-emerald-950/60 border border-emerald-800/60 text-[#A8C9B9] flex items-center justify-center">
              <Wallet className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-bold tracking-tight text-[#a3e635] relative z-10">
            {formatRupiah(totalSaved)}
          </div>
          <p className="text-xs text-[#A8C9B9]/70 mt-2 flex items-center gap-1 relative z-10 font-medium">
            <TrendingUp className="w-3.5 h-3.5 text-lime-400" />
            <span>Terkumpul dari {goals.length} target impian</span>
          </p>
        </div>

        {/* Card 2: Target Aktif */}
        <div className="relative overflow-hidden bg-[#132A1E] border border-[#1f4230] rounded-2xl p-5 shadow-sm text-white flex flex-col justify-between">
          <div className="absolute -bottom-8 -right-8 w-36 h-36 bg-radial from-amber-400/15 via-lime-400/10 to-transparent rounded-full blur-2xl pointer-events-none" />
          <div className="flex items-center justify-between text-[#A8C9B9] mb-3 relative z-10">
            <span className="text-xs font-semibold uppercase tracking-wider">Status Target</span>
            <div className="w-9 h-9 rounded-xl bg-emerald-950/60 border border-emerald-800/60 text-[#A8C9B9] flex items-center justify-center">
              <Target className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2 relative z-10">
            <span className="text-2xl sm:text-3xl font-bold text-lime-400">{activeGoalsCount}</span>
            <span className="text-xs text-[#A8C9B9] font-medium">Aktif</span>
            <span className="text-[#A8C9B9]/40 mx-1">/</span>
            <span className="text-xl font-bold text-emerald-200">{completedGoalsCount}</span>
            <span className="text-xs text-[#A8C9B9]/70 font-medium">Selesai</span>
          </div>
          <p className="text-xs text-[#A8C9B9]/70 mt-2 relative z-10 font-medium">
            Fokus capai impian Anda tepat waktu
          </p>
        </div>

        {/* Card 3: Streak Menabung */}
        <div className="relative overflow-hidden bg-[#132A1E] border border-[#1f4230] rounded-2xl p-5 shadow-sm text-white flex flex-col justify-between">
          <div className="absolute -bottom-8 -right-8 w-36 h-36 bg-radial from-amber-400/15 via-lime-400/10 to-transparent rounded-full blur-2xl pointer-events-none" />
          <div className="flex items-center justify-between text-[#A8C9B9] mb-3 relative z-10">
            <span className="text-xs font-semibold uppercase tracking-wider">Streak Menabung</span>
            <div className="w-9 h-9 rounded-xl bg-amber-950/60 border border-amber-800/60 text-amber-400 flex items-center justify-center">
              <Flame className="w-4 h-4 text-amber-400 fill-amber-400" />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-bold tracking-tight text-amber-300 flex items-center gap-2 relative z-10">
            <span>{globalStreak}</span>
            <span className="text-sm font-semibold text-amber-400/90">Hari Berturut-turut</span>
          </div>
          <p className="text-xs text-[#A8C9B9]/70 mt-2 relative z-10 font-medium">
            Disiplin setoran harian memicu kebiasaan positif
          </p>
        </div>
      </div>

      {/* ACTIVE GOALS GRID SECTION */}
      <div className="max-w-7xl mx-auto mt-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-emerald-600" />
            Daftar Target Tabungan
          </h2>
          <span className="text-xs text-slate-500">
            {goals.length} target terdaftar
          </span>
        </div>

        {loading ? (
          <div className="p-12 text-center text-slate-500 bg-white rounded-2xl border border-slate-200 shadow-sm">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto text-emerald-600 mb-2" />
            <p className="text-sm">Memuat data target tabungan...</p>
          </div>
        ) : goals.length === 0 ? (
          /* EMPTY STATE */
          <div className="bg-white border border-dashed border-slate-300 rounded-3xl p-12 text-center shadow-sm">
            <div className="w-16 h-16 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-4">
              <Target className="w-8 h-8 text-emerald-600/60" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 mb-1">Belum Ada Target Impian</h3>
            <p className="text-slate-500 text-sm max-w-md mx-auto mb-6">
              Mulai rencanakan pembelian barang impian atau dana darurat Anda. Douit AI akan memandu setoran harian Anda.
            </p>
            <button
              onClick={handleOpenCreateModal}
              className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-[#0e281e] hover:bg-[#13382b] text-white font-semibold text-sm border border-emerald-700/50 shadow-md transition-all hover:border-emerald-500/70 active:scale-95 cursor-pointer"
            >
              <Plus className="w-4 h-4 text-emerald-400 stroke-[2.5]" />
              <span className="text-white">Buat Target Pertama</span>
            </button>
          </div>
        ) : (
          /* GOALS CARDS GRID */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {goals.map((goal) => {
              const calcGoal = toCalcGoal(goal);
              const metrics = calculateGoalMetrics(calcGoal);
              const pct = Math.min(100, Math.round(((goal.current_amount || 0) / (goal.target_amount || 1)) * 100));
              const isCompleted = goal.status === 'COMPLETED' || pct >= 100;

              return (
                <div
                  key={goal.id}
                  className="bg-gradient-to-br from-[#122e23] to-[#0a1e16] text-white border border-emerald-800/40 shadow-lg rounded-2xl p-6 flex flex-col justify-between relative overflow-hidden group hover:border-emerald-700/60 transition-all"
                >
                  {/* Glowing background accent */}
                  <div className="absolute -top-12 -right-12 w-32 h-32 bg-emerald-500/10 rounded-full blur-2xl group-hover:bg-emerald-500/20 transition-all pointer-events-none" />

                  <div>
                    {/* CARD HEADER */}
                    <div className="flex items-start justify-between gap-3 mb-4">
                      <div className="flex items-center gap-3">
                        {goal.image_url && !imgErrors[goal.id] ? (
                          <img
                            src={goal.image_url}
                            alt={goal.title}
                            referrerPolicy="no-referrer"
                            className="w-12 h-12 rounded-lg object-cover border border-emerald-700/50 shadow-sm shrink-0"
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                              setImgErrors(prev => ({ ...prev, [goal.id]: true }));
                            }}
                          />
                        ) : (
                          <div className="w-12 h-12 rounded-lg bg-emerald-900/60 border border-emerald-700/50 flex items-center justify-center text-emerald-400 shrink-0">
                            <ShoppingBag className="w-6 h-6 text-emerald-400" />
                          </div>
                        )}
                        <div>
                          <h3 className="font-bold text-base text-white leading-tight line-clamp-1">
                            {goal.title}
                          </h3>
                          <p className="text-emerald-400/80 text-xs mt-0.5">
                            Target: {formatRupiah(goal.target_amount)}
                          </p>
                        </div>
                      </div>

                      {/* STATUS BADGE */}
                      <div>
                        {isCompleted ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-400 text-slate-950">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Selesai
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-900/80 text-emerald-300 border border-emerald-700/60">
                            <Clock className="w-3 h-3 text-emerald-400" /> Aktif
                          </span>
                        )}
                      </div>
                    </div>

                    {/* PROGRESS BAR */}
                    <div className="my-4">
                      <div className="flex justify-between items-center text-xs mb-1.5 font-medium">
                        <span className="text-emerald-300/90">Progres Terkumpul</span>
                        <span className="text-[#a3e635] font-bold">{pct}%</span>
                      </div>
                      <div className="w-full h-3 bg-emerald-950/80 rounded-full overflow-hidden p-0.5 border border-emerald-800/60">
                        <div
                          className="h-full bg-gradient-to-r from-emerald-500 to-[#a3e635] rounded-full transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="flex justify-between items-center text-xs mt-2 text-slate-300">
                        <span className="font-semibold text-white">{formatRupiah(goal.current_amount || 0)}</span>
                        <span className="text-emerald-400/70">{metrics.remainingDays} hari tersisa (Sisa {formatRupiah(metrics.remainingAmount)})</span>
                      </div>
                    </div>

                    {/* DAILY TARGET & REMINDER PILL */}
                    <div className="bg-emerald-950/60 border border-emerald-800/40 rounded-xl p-3 my-4 flex flex-col gap-2.5 text-xs">
                      {/* Target Harian Row */}
                      <div className="flex items-center justify-between">
                        <span className="text-emerald-300/80 flex items-center gap-1">
                          <Coins className="w-3.5 h-3.5 text-[#a3e635]" />
                          Target Harian:
                        </span>
                        <span className="font-bold text-[#a3e635]">
                          {formatRupiah(goal.daily_target)} / hari
                        </span>
                      </div>

                      {/* Status Jadwal Row */}
                      <div className="flex items-center justify-between text-slate-300 border-t border-emerald-900/60 pt-2">
                        <span className="text-emerald-400/70 flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-amber-400" />
                          Status Jadwal:
                        </span>
                        <span className="text-right text-xs font-semibold text-amber-300">
                          {metrics.scheduleStatusText}
                        </span>
                      </div>

                      {/* Estimasi Target Row */}
                      <div className="flex items-center justify-between text-slate-300 border-t border-emerald-900/60 pt-2">
                        <span className="text-emerald-400/70 flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5 text-emerald-400" />
                          Estimasi Target:
                        </span>
                        <span className="text-right text-xs text-slate-200">
                          {metrics.formattedEstimatedTarget}
                        </span>
                      </div>

                      {/* Pengingat WA Row */}
                      <div className="flex items-center justify-between text-slate-300 border-t border-emerald-900/60 pt-2">
                        <span className="text-emerald-400/70 flex items-center gap-1">
                          <Bell className="w-3.5 h-3.5 text-amber-400" />
                          Pengingat WA:
                        </span>
                        <span>
                          {goal.reminder_times && goal.reminder_times.length > 0
                            ? `${goal.reminder_times.join(', ')} WIB (${goal.reminder_times.length}x/hari)`
                            : `${goal.reminder_time ? goal.reminder_time.slice(0, 5) : '08:00'} WIB`} ({goal.mode === 'RELAXED' ? 'Santai' : 'Disiplin'})
                        </span>
                      </div>

                      {/* Pengeluaran Hari Ini & Adjusted Safe Limit Row with Mini Progress Bar */}
                      {(() => {
                        const baseBudget = globalDailyLimit || Number(goal.max_daily_expense) || 0;
                        const cardSafeLimit = Math.max(0, baseBudget - activeGoalsCommitment);
                        const expensePct = cardSafeLimit > 0 ? Math.round((todayExpenseTotal / cardSafeLimit) * 100) : (todayExpenseTotal > 0 ? 100 : 0);

                        // Color coding:
                        // < 75%: Emerald
                        // 75% - 100%: Amber
                        // > 100%: Rose
                        const barColorClass =
                          expensePct > 100
                            ? 'bg-rose-500'
                            : expensePct >= 75
                            ? 'bg-amber-400'
                            : 'bg-emerald-400';

                        const textColorClass =
                          expensePct > 100
                            ? 'text-rose-400 font-bold'
                            : expensePct >= 75
                            ? 'text-amber-300 font-semibold'
                            : 'text-emerald-300';

                        return (
                          <div className="border-t border-emerald-900/60 pt-2 flex flex-col gap-1.5">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-emerald-400/70 flex items-center gap-1">
                                <Wallet className="w-3.5 h-3.5 text-emerald-400" />
                                Pengeluaran Hari Ini:
                              </span>
                              <span className={textColorClass}>
                                {formatRupiah(todayExpenseTotal)}
                                {cardSafeLimit > 0 ? ` / ${formatRupiah(cardSafeLimit)}` : ''}
                                {cardSafeLimit > 0 ? ` (${expensePct}%)` : ''}
                              </span>
                            </div>

                            {cardSafeLimit > 0 && (
                              <div className="w-full h-1.5 bg-emerald-950/80 rounded-full overflow-hidden border border-emerald-800/50">
                                <div
                                  className={`h-full ${barColorClass} transition-all duration-300 rounded-full`}
                                  style={{ width: `${Math.min(100, expensePct)}%` }}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>



                    {/* Footer Info Row */}
                    <div className="flex flex-wrap items-center justify-between gap-2 w-full mt-3 mb-4">
                      {/* Account Badge with Truncation */}
                      <div className="flex-1 min-w-0 max-w-[70%]">
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-emerald-950/60 text-emerald-400 border border-emerald-800/50 truncate w-full">
                          {goal.storage_type === 'BANK_TRANSFER' ? (
                            <Building2 className="w-3.5 h-3.5 flex-shrink-0" />
                          ) : goal.storage_type === 'TUNAI' ? (
                            <Coins className="w-3.5 h-3.5 flex-shrink-0" />
                          ) : (
                            <Smartphone className="w-3.5 h-3.5 flex-shrink-0" />
                          )}
                          <span className="truncate">
                            {goal.account_name || goal.storage_detail || (goal.storage_type === 'BANK_TRANSFER' ? 'Rekening Bank' : goal.storage_type === 'TUNAI' ? 'Celengan Fisik' : 'Rekening QRIS')}
                          </span>
                        </span>
                      </div>

                      {/* Streak Badge (Guaranteed Space with Original Lucide Flame SVG) */}
                      <div className="flex-shrink-0 flex items-center gap-1.5 text-xs font-semibold text-amber-400 bg-amber-950/40 border border-amber-800/40 px-3 py-1.5 rounded-full">
                        <Flame className="w-4 h-4 text-amber-400 fill-amber-400 flex-shrink-0"/>
                        <span className="whitespace-nowrap">{metrics.currentStreak} Hari Aktif</span>
                      </div>
                    </div>
                  </div>

                  {/* ACTION BUTTONS */}
                  <div className="flex items-center gap-2 pt-2 border-t border-emerald-900/60">
                    <button
                      onClick={() => handleOpenDepositModal(goal)}
                      disabled={isCompleted}
                      className={`flex-1 py-2.5 px-4 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer ${isCompleted
                          ? 'bg-emerald-900/40 text-emerald-500 cursor-not-allowed'
                          : 'bg-[#a3e635] text-[#051910] hover:bg-[#8fd428] shadow-sm active:scale-95'
                        }`}
                    >
                      <Coins className="w-4 h-4 text-[#051910] stroke-[2.5]" />
                      <span className="text-[#051910] font-extrabold">Catat Setoran</span>
                    </button>
                    <button
                      onClick={() => handleDeleteGoal(goal.id)}
                      className="p-2.5 rounded-xl bg-emerald-950/80 text-emerald-400 hover:text-rose-400 hover:bg-rose-950/40 border border-emerald-800/60 transition-colors cursor-pointer"
                      title="Hapus Target"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* CREATE TARGET MODAL */}
      {createModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
          <div className="relative w-full max-w-3xl rounded-2xl bg-white shadow-2xl border border-slate-100 p-5 sm:p-6 text-slate-900 overflow-hidden">
            <button
              onClick={() => setCreateModalOpen(false)}
              className="absolute top-4 right-4 p-2 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            {/* MODAL HEADER WITH STEP INDICATOR */}
            <div className="flex items-center justify-between gap-3 mb-4 pb-3 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                  <PiggyBank className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900 leading-tight">Tambah Target Impian</h3>
                  <p className="text-xs text-slate-500 font-medium mt-0.5">
                    {step === 1 ? 'Langkah 1 dari 2: Detail Target' : 'Langkah 2 dari 2: Metode & Pengaturan'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 pr-8">
                <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${step === 1 ? 'bg-[#0e281e] text-emerald-300 border border-emerald-700/50' : 'bg-slate-100 text-slate-400'}`}>
                  1. Detail
                </span>
                <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${step === 2 ? 'bg-[#0e281e] text-emerald-300 border border-emerald-700/50' : 'bg-slate-100 text-slate-400'}`}>
                  2. Metode
                </span>
              </div>
            </div>

            <form onSubmit={handleCreateGoal} className="space-y-4">
              {/* STEP 1: DETAIL TARGET IMPIAN (2-COLUMN HORIZONTAL GRID) */}
              {step === 1 && (
                <div className="space-y-4">
                  <h4 className="text-xs font-bold text-emerald-800 uppercase tracking-wider flex items-center gap-1.5">
                    <Target className="w-3.5 h-3.5 text-emerald-600" />
                    Detail Target Impian
                  </h4>

                  {isGoalLimitReached && (
                    <div className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-50 border border-amber-200/80 text-amber-800 text-xs animate-in fade-in duration-150">
                      <AlertCircle className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
                      <div>
                        <span className="font-bold">Batas Maksimal 3 Target Aktif Tercapai.</span> Selesaikan atau hapus salah satu target aktif Anda sebelum membuat target baru.
                      </div>
                    </div>
                  )}

                  {createGoalError && (
                    <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-50 border border-rose-200/70 text-rose-700 text-xs animate-in fade-in duration-150">
                      <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                      <span className="font-medium">{createGoalError}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    {/* LEFT COLUMN */}
                    <div className="space-y-4">
                      {/* Nama Target */}
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                          Nama Barang / Tujuan Impian
                        </label>
                        <input
                          type="text"
                          required
                          placeholder="Contoh: Sepatu Salomon XT-6, Laptop Kerja"
                          value={title}
                          onChange={(e) => {
                            setCreateGoalError(null);
                            setTitle(e.target.value);
                          }}
                          className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                        />
                      </div>

                      {/* Target Nominal */}
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                          Target Nominal (Rp)
                        </label>
                        <input
                          type="number"
                          required
                          min="1000"
                          placeholder="Contoh: 3000000"
                          value={targetAmount}
                          onChange={(e) => {
                            setCreateGoalError(null);
                            setTargetAmount(e.target.value);
                          }}
                          className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                        />
                      </div>

                      {/* Komitmen Pengeluaran Harian */}
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                          Komitmen Pengeluaran Harian <span className="text-slate-400 font-normal text-xs">(Opsional)</span>
                        </label>
                        <input
                          type="number"
                          min="0"
                          placeholder="Contoh: 100000"
                          value={maxDailyExpense}
                          onChange={(e) => setMaxDailyExpense(e.target.value)}
                          className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                        />
                        <div className="flex items-start gap-1.5 mt-1.5 text-xs text-slate-500">
                          <Info className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                          <span>
                            Nilai ini berlaku global. Mengubah komitmen di sini akan otomatis memperbarui batas belanja harian di seluruh target tabungan Anda.
                          </span>
                        </div>

                        {/* Interactive Real-time Calculation Breakdown Banner */}
                        {(() => {
                          const baseBudgetNum = parseFloat(maxDailyExpense) || 0;
                          if (baseBudgetNum <= 0) return null;

                          const netSafeDailyLimit = Math.max(
                            0,
                            baseBudgetNum - activeGoalsCommitment - calculatedDailyTarget
                          );

                          return (
                            <div className="mt-2.5 p-3.5 bg-gradient-to-br from-[#0c241b] via-[#123124] to-[#183d2e] border border-emerald-700/60 rounded-xl text-xs text-white shadow-md space-y-2">
                              <div className="flex items-center justify-between text-emerald-300 font-semibold border-b border-emerald-800/60 pb-1.5">
                                <span className="flex items-center gap-1.5">
                                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                                  Kalkulasi Batas Belanja Aman Harian
                                </span>
                              </div>
                              <div className="space-y-1 text-slate-200">
                                <div className="flex items-center justify-between">
                                  <span className="text-emerald-400/80">Anggaran Harian Dasar:</span>
                                  <span className="font-semibold text-white">{formatRupiah(baseBudgetNum)}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-emerald-400/80">Target Tabungan Aktif ({activeGoalsCount}):</span>
                                  <span className="font-semibold text-amber-300">-{formatRupiah(activeGoalsCommitment)}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-emerald-400/80">Target Harian Target Ini:</span>
                                  <span className="font-semibold text-lime-300">-{formatRupiah(calculatedDailyTarget)}</span>
                                </div>
                              </div>
                              <div className="flex items-center justify-between pt-1.5 border-t border-emerald-800/60 font-bold">
                                <span className="text-emerald-200 flex items-center gap-1">
                                  <Sparkles className="w-3.5 h-3.5 text-lime-400" />
                                  Net Safe Daily Limit:
                                </span>
                                <span className="text-sm font-extrabold text-[#a3e635]">
                                  {formatRupiah(netSafeDailyLimit)} / hari
                                </span>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    </div>


                    {/* RIGHT COLUMN */}
                    <div className="space-y-4">
                      {/* Jangka Waktu / Target Selesai */}
                      <div className="space-y-2">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <label className="text-sm font-semibold text-slate-700">Jangka Waktu Target</label>
                          <div className="inline-flex p-0.5 bg-slate-100 rounded-md border border-slate-200/80 h-[28px]">
                            <button
                              type="button"
                              onClick={() => setDurationMode('DAYS')}
                              className={`px-2.5 py-1 text-[11px] whitespace-nowrap rounded-sm transition-all cursor-pointer flex items-center ${durationMode === 'DAYS'
                                  ? 'bg-[#0e281e] text-white shadow-xs border border-emerald-600/40'
                                  : 'text-slate-600 hover:text-slate-900 bg-transparent'
                                }`}
                            >
                              <span className={durationMode === 'DAYS' ? '!text-white font-medium' : 'text-slate-600 font-medium'}>
                                Durasi Hari
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setDurationMode('DATE')}
                              className={`px-2.5 py-1 text-[11px] whitespace-nowrap rounded-sm transition-all cursor-pointer flex items-center ${durationMode === 'DATE'
                                  ? 'bg-[#0e281e] text-white shadow-xs border border-emerald-600/40'
                                  : 'text-slate-600 hover:text-slate-900 bg-transparent'
                                }`}
                            >
                              <span className={durationMode === 'DATE' ? '!text-white font-medium' : 'text-slate-600 font-medium'}>
                                Tanggal Target
                              </span>
                            </button>
                          </div>
                        </div>

                        {durationMode === 'DAYS' ? (
                          <input
                            type="number"
                            min="1"
                            placeholder="Jumlah hari (contoh: 30)"
                            value={daysCount}
                            onChange={(e) => setDaysCount(e.target.value)}
                            className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                          />
                        ) : (
                          <CustomDatePicker
                            value={targetDate}
                            onChange={setTargetDate}
                            placeholder="Pilih Tanggal Target"
                          />
                        )}

                        {/* DYNAMIC REAL-TIME CALCULATION BANNER */}
                        {calculatedDailyTarget > 0 && (
                          <div className="mt-1.5 p-2.5 bg-gradient-to-r from-[#0d261d] via-[#143527] to-[#1c3e2e] border border-emerald-700/50 rounded-xl text-xs text-white flex items-center justify-between shadow-sm">
                            <span className="flex items-center gap-1.5 text-emerald-200">
                              <Sparkles className="w-4 h-4 text-emerald-400 stroke-[2.5]" />
                              Estimasi setoran harian:
                            </span>
                            <span className="font-bold text-[#a3e635] text-sm">
                              {formatRupiah(calculatedDailyTarget)} / hari
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Link Produk / E-commerce (Opsional) */}
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                          Link Produk / E-commerce (Opsional)
                        </label>
                        <input
                          type="text"
                          placeholder="Contoh: https://www.tokopedia.com/... (atau kosongkan untuk cari otomatis)"
                          value={productUrl}
                          onChange={(e) => setProductUrl(e.target.value)}
                          className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                        />
                        <p className="text-xs text-slate-500 mt-1">
                          Kosongkan untuk pencarian produk dan thumbnail gambar secara otomatis oleh Douit AI.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* STEP 1 FOOTER ACTIONS */}
                  <div className="pt-3 mt-4 border-t border-slate-100 flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => setCreateModalOpen(false)}
                      className="px-5 py-2.5 rounded-xl border border-slate-300 text-slate-700 text-sm font-semibold hover:bg-slate-100 transition-colors cursor-pointer"
                    >
                      Batal
                    </button>
                    <button
                      type="button"
                      disabled={isGoalLimitReached}
                      onClick={() => {
                        if (isGoalLimitReached) {
                          setCreateGoalError("Batas maksimal 3 target tabungan aktif telah tercapai.");
                          return;
                        }
                        if (!title.trim() || !targetAmount || parseFloat(targetAmount) <= 0) {
                          setCreateGoalError("Mohon isi Nama Target dan Target Nominal terlebih dahulu.");
                          return;
                        }
                        setCreateGoalError(null);
                        setStep(2);
                      }}
                      className={`inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl font-semibold text-sm border shadow-md transition-all active:scale-[0.98] ${
                        isGoalLimitReached
                          ? "bg-slate-200 text-slate-400 border-slate-200 cursor-not-allowed"
                          : "bg-gradient-to-r from-[#0d261d] via-[#143527] to-[#1c3e2e] hover:from-[#113227] hover:to-[#224b38] text-white border-emerald-600/50 cursor-pointer"
                      }`}
                    >
                      <span className={isGoalLimitReached ? "text-slate-400 font-semibold tracking-wide" : "text-white font-semibold tracking-wide"}>Lanjutkan →</span>
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 2: METODE & PENGATURAN SETORAN */}
              {step === 2 && (
                <div className="space-y-4">
                  <h4 className="text-xs font-bold text-emerald-800 uppercase tracking-wider flex items-center gap-1.5">
                    <Wallet className="w-3.5 h-3.5 text-emerald-600" />
                    Metode & Pengaturan Setoran
                  </h4>

                  {/* Tempat Menyimpan Dana */}
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                      Tempat Menyimpan Dana
                    </label>
                    <div className="grid grid-cols-3 gap-2 mb-2">
                      <button
                        type="button"
                        onClick={() => setStorageType('GOPAY_MERCHANT')}
                        className={`p-3 rounded-xl text-xs font-medium border flex flex-col items-center justify-center gap-1.5 transition-all cursor-pointer ${storageType === 'GOPAY_MERCHANT'
                            ? 'bg-gradient-to-r from-[#0d261d] via-[#143527] to-[#1c3e2e] border-2 border-emerald-500/70 text-white font-semibold shadow-sm'
                            : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-700'
                          }`}
                      >
                        <Smartphone className={`w-5 h-5 ${storageType === 'GOPAY_MERCHANT' ? 'text-emerald-400' : 'text-slate-400'}`} />
                        <span className={storageType === 'GOPAY_MERCHANT' ? 'text-white font-semibold text-xs' : 'text-slate-700 font-medium text-xs'}>Rekening QRIS</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setStorageType('BANK_TRANSFER')}
                        className={`p-3 rounded-xl text-xs font-medium border flex flex-col items-center justify-center gap-1.5 transition-all cursor-pointer ${storageType === 'BANK_TRANSFER'
                            ? 'bg-gradient-to-r from-[#0d261d] via-[#143527] to-[#1c3e2e] border-2 border-emerald-500/70 text-white font-semibold shadow-sm'
                            : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-700'
                          }`}
                      >
                        <Building2 className={`w-5 h-5 ${storageType === 'BANK_TRANSFER' ? 'text-emerald-400' : 'text-slate-400'}`} />
                        <span className={storageType === 'BANK_TRANSFER' ? 'text-white font-semibold text-xs' : 'text-slate-700 font-medium text-xs'}>Rekening Bank</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setStorageType('TUNAI')}
                        className={`p-3 rounded-xl text-xs font-medium border flex flex-col items-center justify-center gap-1.5 transition-all cursor-pointer ${storageType === 'TUNAI'
                            ? 'bg-gradient-to-r from-[#0d261d] via-[#143527] to-[#1c3e2e] border-2 border-emerald-500/70 text-white font-semibold shadow-sm'
                            : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-700'
                          }`}
                      >
                        <Coins className={`w-5 h-5 ${storageType === 'TUNAI' ? 'text-emerald-400' : 'text-slate-400'}`} />
                        <span className={storageType === 'TUNAI' ? 'text-white font-semibold text-xs' : 'text-slate-700 font-medium text-xs'}>Celengan Fisik</span>
                      </button>
                    </div>
                    <input
                      type="text"
                      placeholder={
                        storageType === 'GOPAY_MERCHANT'
                          ? 'Nama Merchant QRIS / Catatan'
                          : storageType === 'BANK_TRANSFER'
                            ? 'Nama Bank & No Rekening'
                            : 'Lokasi Celengan Fisik'
                      }
                      value={storageDetail}
                      onChange={(e) => setStorageDetail(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                    />
                  </div>

                  {/* Frekuensi & Jam Pengingat WhatsApp */}
                  <div className="space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <label className="text-sm font-semibold text-slate-700">
                          Pengingat WhatsApp Harian
                        </label>
                        {isVerified && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
                            ✓ Terverifikasi
                          </span>
                        )}
                      </div>
                      <div className="inline-flex p-0.5 bg-slate-100 rounded-md border border-slate-200/80 h-[28px]">
                        {[1, 2, 3].map((num) => (
                          <button
                            key={num}
                            type="button"
                            onClick={() => handleFrequencyChange(num)}
                            className={`px-2.5 py-1 text-[11px] whitespace-nowrap rounded-sm transition-all cursor-pointer flex items-center ${
                              reminderCount === num
                                ? 'bg-[#0e281e] text-white shadow-xs border border-emerald-600/40'
                                : 'text-slate-600 hover:text-slate-900 bg-transparent'
                            }`}
                          >
                            <span className={reminderCount === num ? '!text-white font-medium' : 'text-slate-600 font-medium'}>
                              {num}x / hari
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Phone Input Bar */}
                    <div className="relative flex items-center">
                      <input
                        ref={phoneInputRef}
                        type="tel"
                        value={whatsappNumber}
                        onChange={(e) => {
                          const val = e.target.value;
                          setWhatsappNumber(val);
                          if (isVerified) {
                            setIsVerified(false);
                          }
                        }}
                        disabled={isVerified}
                        placeholder="No. WhatsApp (contoh: 081234567890)"
                        className={`w-full px-4 py-2.5 rounded-xl border text-sm transition-all outline-none ${
                          isVerified
                            ? "bg-emerald-50/40 border-emerald-300 text-slate-700 font-medium cursor-not-allowed pr-28"
                            : "bg-white border-slate-200 focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 pr-28"
                        }`}
                      />

                      {/* Tombol Aksi di dalam Input */}
                      <div className="absolute right-1.5 flex items-center">
                        {isVerified ? (
                          <button
                            type="button"
                            onClick={handleResetPhoneNumber}
                            className="text-xs font-semibold text-emerald-800 hover:text-emerald-950 px-3 py-1.5 rounded-lg hover:bg-emerald-100/70 transition-colors cursor-pointer"
                          >
                            Ganti Nomor
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={!whatsappNumber || isSendingOtp || cooldown > 0}
                            onClick={handleSendOtp}
                            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 cursor-pointer shadow-sm ${
                              !whatsappNumber || isSendingOtp || cooldown > 0
                                ? "bg-slate-400 !text-white text-white cursor-not-allowed opacity-90"
                                : "bg-gradient-to-r from-[#0F2A1D] to-[#163827] hover:from-[#143827] hover:to-[#1c4732] !text-white text-white active:scale-[0.97]"
                            }`}
                          >
                            <span className="!text-white text-white font-semibold">
                              {isSendingOtp ? "Mengirim..." : cooldown > 0 ? `${cooldown}s` : "Kirim Kode"}
                            </span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Inline OTP Input Box (Shown after OTP is sent and not yet verified) */}
                    {!isVerified && otpSent && (
                      <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5 animate-in fade-in duration-150">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-slate-600 font-medium">
                            Masukkan 4 digit kode yang dikirim ke WhatsApp Anda:
                          </span>
                          <span className="text-[11px] text-slate-400">
                            Sisa jatah hari ini: {remainingAttempts}/3
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            maxLength={4}
                            value={otpCode}
                            onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                            placeholder="1234"
                            className="w-32 px-3 py-2 text-center tracking-widest text-base font-bold bg-white border border-slate-300 rounded-lg focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 outline-none"
                          />
                          <button
                            type="button"
                            disabled={otpCode.length < 4 || isVerifying}
                            onClick={handleVerifyOtp}
                            className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all duration-150 cursor-pointer shadow-sm border border-emerald-900/30 flex items-center justify-center min-w-[90px] ${
                              otpCode.length < 4 || isVerifying
                                ? "bg-slate-400 !text-white text-white cursor-not-allowed opacity-90"
                                : "bg-gradient-to-r from-[#0F2A1D] to-[#163827] hover:from-[#143827] hover:to-[#1c4732] !text-white text-white active:scale-[0.97]"
                            }`}
                          >
                            <span className="!text-white text-white font-semibold">
                              {isVerifying ? "Memverifikasi..." : "Verifikasi"}
                            </span>
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Dynamic Time Slots */}
                    <div className={`grid gap-2 ${
                      reminderCount === 1 ? 'grid-cols-1' : reminderCount === 2 ? 'grid-cols-2' : 'grid-cols-3'
                    }`}>
                      {reminderTimes.slice(0, reminderCount).map((time, idx) => (
                        <CustomTimePicker
                          key={idx}
                          value={time}
                          onChange={(newTime) => handleTimeChange(idx, newTime)}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Mode Menabung */}
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                      Mode Disiplin Menabung
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setMode('RELAXED')}
                        className={`p-3 rounded-xl text-left border text-sm transition-all cursor-pointer ${mode === 'RELAXED'
                            ? 'bg-gradient-to-r from-[#0d261d] via-[#143527] to-[#1c3e2e] border-2 border-emerald-500/70 shadow-xs text-white'
                            : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-700'
                          }`}
                      >
                        <div className={`font-semibold mb-0.5 text-xs ${mode === 'RELAXED' ? 'text-white' : 'text-slate-700'}`}>Mode Santai (Rekomendasi)</div>
                        <div className={`text-[11px] ${mode === 'RELAXED' ? 'text-emerald-200/80' : 'text-slate-500'}`}>Tenggat otomatis diperpanjang</div>
                      </button>
                      <button
                        type="button"
                        onClick={() => setMode('DISCIPLINED')}
                        className={`p-3 rounded-xl text-left border text-sm transition-all cursor-pointer ${mode === 'DISCIPLINED'
                            ? 'bg-gradient-to-r from-[#0d261d] via-[#143527] to-[#1c3e2e] border-2 border-emerald-500/70 shadow-xs text-white'
                            : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-700'
                          }`}
                      >
                        <div className={`font-semibold mb-0.5 text-xs ${mode === 'DISCIPLINED' ? 'text-white' : 'text-slate-700'}`}>Mode Disiplin Strictly</div>
                        <div className={`text-[11px] ${mode === 'DISCIPLINED' ? 'text-emerald-200/80' : 'text-slate-500'}`}>Nominal harian naik jika skip</div>
                      </button>
                    </div>
                  </div>

                  {/* STEP 2 FOOTER ACTIONS */}
                  <div className="pt-3 mt-4 border-t border-slate-100 flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => setStep(1)}
                      className="px-5 py-2.5 rounded-xl border border-slate-300 text-slate-700 text-sm font-semibold hover:bg-slate-100 transition-colors cursor-pointer"
                    >
                      ← Kembali
                    </button>
                    {(() => {
                      const isPhoneUnverified = Boolean(whatsappNumber.trim().length > 0 && !isVerified);
                      const isSubmitDisabled = submitting || isGoalLimitReached || isPhoneUnverified;

                      return (
                        <button
                          type="submit"
                          disabled={isSubmitDisabled}
                          className={`inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl font-semibold text-sm border shadow-md transition-all active:scale-[0.98] ${
                            isSubmitDisabled
                              ? "bg-slate-200 text-slate-400 border-slate-200 cursor-not-allowed"
                              : "bg-gradient-to-r from-[#0d261d] via-[#143527] to-[#1c3e2e] hover:from-[#113227] hover:to-[#224b38] text-white border-emerald-600/50 cursor-pointer"
                          }`}
                        >
                          {submitting ? (
                            <>
                              <RefreshCw className="w-4 h-4 text-emerald-400 animate-spin" />
                              <span className="text-white text-xs sm:text-sm font-medium">{submittingText}</span>
                            </>
                          ) : (
                            <>
                              <Sparkles className={`w-4 h-4 stroke-[2.5] ${isSubmitDisabled ? "text-slate-400" : "text-emerald-400"}`} />
                              <span className={isSubmitDisabled ? "text-slate-400" : "text-white"}>Simpan Target Impian</span>
                            </>
                          )}
                        </button>
                      );
                    })()}

                  </div>
                </div>
              )}
            </form>
          </div>
        </div>
      )}

      {/* QUICK DEPOSIT MODAL */}
      {depositModalOpen && selectedGoal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-md w-full p-6 text-slate-900 relative">
            <button
              onClick={() => setDepositModalOpen(false)}
              className="absolute top-4 right-4 p-2 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                <Coins className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">Catat Setoran Nabung</h3>
                <p className="text-xs text-slate-500 line-clamp-1">Target: {selectedGoal.title}</p>
              </div>
            </div>

            <form onSubmit={handleQuickDeposit} className="space-y-4">
              {/* Presets */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Pilih Preset Nominal Setoran
                </label>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => setDepositAmount(selectedGoal.daily_target.toString())}
                    className="py-2 px-3 rounded-xl border border-emerald-300 bg-emerald-50 text-emerald-800 text-xs font-semibold hover:bg-emerald-100"
                  >
                    Target Harian ({formatRupiah(selectedGoal.daily_target)})
                  </button>
                  <button
                    type="button"
                    onClick={() => setDepositAmount("10000")}
                    className="py-2 px-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 text-xs font-medium hover:bg-slate-100"
                  >
                    + Rp 10.000
                  </button>
                  <button
                    type="button"
                    onClick={() => setDepositAmount("25000")}
                    className="py-2 px-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 text-xs font-medium hover:bg-slate-100"
                  >
                    + Rp 25.000
                  </button>
                  <button
                    type="button"
                    onClick={() => setDepositAmount("50000")}
                    className="py-2 px-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 text-xs font-medium hover:bg-slate-100"
                  >
                    + Rp 50.000
                  </button>
                </div>
              </div>

              {/* Nominal Custom Input */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Nominal Setoran (Rp)
                </label>
                <input
                  type="number"
                  required
                  min="500"
                  placeholder="Masukkan nominal setoran"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              {/* Catatan Setoran */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Catatan / Keterangan
                </label>
                <input
                  type="text"
                  placeholder="Contoh: Tabungan harian, bonus kerja"
                  value={depositNotes}
                  onChange={(e) => setDepositNotes(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div className="pt-3 mt-2 border-t border-slate-100 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setDepositModalOpen(false)}
                  className="border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl px-5 py-2.5 text-sm font-medium transition-colors cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submittingDeposit}
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#0F2A1D] to-[#163827] hover:from-[#133525] hover:to-[#1a4430] border border-emerald-500/20 text-white font-semibold text-sm shadow-sm transition-all duration-200 active:scale-[0.98] disabled:opacity-60 cursor-pointer"
                >
                  {submittingDeposit ? (
                    <>
                      <RefreshCw className="w-4 h-4 text-emerald-400 animate-spin" />
                      <span className="text-white">Menyimpan...</span>
                    </>
                  ) : (
                    <>
                      <Coins className="w-4 h-4 text-emerald-400 stroke-[2.5]" />
                      <span className="text-white">Simpan Setoran</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={!!deleteGoalId}
        onClose={() => setDeleteGoalId(null)}
        onConfirm={confirmDeleteGoal}
        title="Hapus Target Nabung"
        description="Apakah Anda yakin ingin menghapus target nabung ini? Seluruh riwayat setoran untuk target ini akan ikut terhapus."
        confirmLabel="Hapus Target"
        variant="danger"
        isLoading={isDeletingGoal}
      />
    </div>
  );
}
