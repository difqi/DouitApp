export interface SavingsGoal {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  dailyTarget: number;
  startDate: string; // YYYY-MM-DD
  paymentAccount?: string;
  productUrl?: string;
  isCompleted?: boolean;
  status?: "active" | "completed";
  deposits: { date: string; amount: number }[]; // Sorted or unsorted
}

export interface GoalMetrics {
  currentStreak: number;
  remainingAmount: number;
  remainingDays: number;
  estimatedDate: Date;
  driftDays: number; // Positive = delayed/mundur, Negative = accelerated/lebih cepat, 0 = on track
  fractionalDrift: number; // Decimal fraction (0.0 - 0.9)
  scheduleStatusText: string;
  formattedEstimatedTarget: string;
}

function parseToMidnightLocalDate(dateInput: string | Date): Date {
  if (dateInput instanceof Date) {
    const d = new Date(dateInput);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (!dateInput) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
    const [y, m, d] = dateInput.split('-').map(Number);
    return new Date(y, m - 1, d, 0, 0, 0, 0);
  }
  const dt = new Date(dateInput);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

export function calculateGoalMetrics(goal: SavingsGoal): GoalMetrics {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const dailyTarget = Math.max(1, goal.dailyTarget);
  const remainingAmount = Math.max(0, goal.targetAmount - goal.currentAmount);
  const remainingDays = Math.ceil(remainingAmount / dailyTarget);

  // 1. Dynamic Estimated Completion Date
  const estimatedDate = new Date(today);
  estimatedDate.setDate(today.getDate() + remainingDays);

  // 2. Strict Consecutive Streak Calculation
  const depositDates = Array.from(
    new Set(
      (goal.deposits || []).map((d) => {
        const dt = parseToMidnightLocalDate(d.date);
        return dt.getTime();
      })
    )
  ).sort((a, b) => b - a);

  let currentStreak = 0;
  if (depositDates.length > 0) {
    const oneDayMs = 24 * 60 * 60 * 1000;
    const latestDeposit = depositDates[0];
    const diffDays = Math.floor((today.getTime() - latestDeposit) / oneDayMs);

    if (diffDays <= 1) {
      currentStreak = 1;
      let checkTime = latestDeposit;
      for (let i = 1; i < depositDates.length; i++) {
        const diffStep = Math.round((checkTime - depositDates[i]) / oneDayMs);
        if (diffStep === 1) {
          currentStreak++;
          checkTime = depositDates[i];
        } else {
          break;
        }
      }
    }
  }

  // 3. "Days Funded vs Timeline Index" Schedule Drift Algorithm
  const startDate = parseToMidnightLocalDate(goal.startDate || today);
  const oneDayMs = 24 * 60 * 60 * 1000;
  const dayIndex = Math.max(1, Math.floor((today.getTime() - startDate.getTime()) / oneDayMs) + 1);

  // Check if a deposit occurred today
  const todayTimestamp = today.getTime();
  const hasDepositedToday = (goal.deposits || []).some((d) => {
    const dt = parseToMidnightLocalDate(d.date);
    return dt.getTime() === todayTimestamp;
  });

  const daysFunded = goal.currentAmount / dailyTarget;
  
  // Benchmark Timeline: Evaluate dayIndex if deposited today; evaluate (dayIndex - 1) if not deposited yet today.
  const benchmarkIndex = hasDepositedToday ? dayIndex : Math.max(0, dayIndex - 1);
  const netDifferenceDays = benchmarkIndex - daysFunded; // Positive = Lag/Mundur, Negative = Ahead/Cepat

  let driftDays = 0;
  let fractionalDrift = 0;
  let scheduleStatusText = "Tepat Waktu (On Track)";

  if (netDifferenceDays >= 1.0) {
    // 1 or more full calendar days delayed
    driftDays = Math.floor(netDifferenceDays);
    fractionalDrift = Number((netDifferenceDays - driftDays).toFixed(1));
    scheduleStatusText = `+${driftDays} hari mundur${fractionalDrift > 0 ? ` (Beban pecahan: ${fractionalDrift} hari)` : ""}`;
  } else if (netDifferenceDays > 0.05) {
    // Only partial day deficit
    driftDays = 0;
    fractionalDrift = Number(netDifferenceDays.toFixed(1));
    scheduleStatusText = `On Track (Beban pecahan: ${fractionalDrift} hari)`;
  } else if (netDifferenceDays <= -1.0) {
    // 1 or more full calendar days ahead
    const absDiff = Math.abs(netDifferenceDays);
    driftDays = -Math.floor(absDiff);
    fractionalDrift = Number((absDiff - Math.floor(absDiff)).toFixed(1));
    const posDrift = Math.abs(driftDays);
    scheduleStatusText = `${posDrift} hari lebih cepat${fractionalDrift > 0 ? ` (Surplus pecahan: ${fractionalDrift} hari)` : ""}`;
  } else if (netDifferenceDays < -0.05) {
    // Only partial day surplus
    driftDays = 0;
    fractionalDrift = Number(Math.abs(netDifferenceDays).toFixed(1));
    scheduleStatusText = `On Track (Surplus pecahan: ${fractionalDrift} hari)`;
  }

  const dateIndo = estimatedDate.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  const formattedEstimatedTarget = `${dateIndo} (Sisa ${remainingDays} hari)`;

  return {
    currentStreak,
    remainingAmount,
    remainingDays,
    estimatedDate,
    driftDays,
    fractionalDrift,
    scheduleStatusText,
    formattedEstimatedTarget,
  };
}

// 5. Global Account Discipline Streak (At least 1 deposit per day across any active target)
export function calculateGlobalDisciplineStreak(goals: SavingsGoal[]): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const allTimestamps: number[] = [];
  goals.forEach((g) => {
    (g.deposits || []).forEach((d) => {
      const dt = parseToMidnightLocalDate(d.date);
      allTimestamps.push(dt.getTime());
    });
  });

  const uniqueDates = Array.from(new Set(allTimestamps)).sort((a, b) => b - a);
  if (uniqueDates.length === 0) return 0;

  const oneDayMs = 24 * 60 * 60 * 1000;
  const diffFromToday = Math.round((today.getTime() - uniqueDates[0]) / oneDayMs);

  if (diffFromToday > 1) return 0;

  let globalStreak = 1;
  let checkTime = uniqueDates[0];
  for (let i = 1; i < uniqueDates.length; i++) {
    const diffDays = Math.round((checkTime - uniqueDates[i]) / oneDayMs);
    if (diffDays === 1) {
      globalStreak++;
      checkTime = uniqueDates[i];
    } else {
      break;
    }
  }

  return globalStreak;
}
