export const SAVINGS_MISSED_DAY_SOURCES = [
  'USER_SKIP',
  'AUTO_RECONCILIATION',
] as const;

export type SavingsMissedDaySource = typeof SAVINGS_MISSED_DAY_SOURCES[number];

export type SavingsMissedDayOutcome =
  | 'APPLIED'
  | 'ALREADY_RESOLVED'
  | 'NOT_ACTIVE'
  | 'VALID_DEPOSIT'
  | 'INVALID';

export interface SavingsMissedDayResult {
  out_outcome: SavingsMissedDayOutcome;
  out_resolution_id: string | null;
  out_goal_id: string;
  out_effective_date: string;
  out_requested_source: SavingsMissedDaySource;
  out_resolved_source: SavingsMissedDaySource | null;
  out_mode: 'RELAXED' | 'DISCIPLINED' | string | null;
  out_target_date: string | null;
  out_daily_target: number | string | null;
  out_total_delay_days: number | null;
  out_accumulated_time_debt: number | string | null;
  out_streak_count: number | null;
}

export function getWibCalendarDate(value: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

export function buildSavingsMissedDayRpcArgs(input: {
  actorUserId: string;
  goalId: string;
  effectiveDate: string;
  resolutionSource: SavingsMissedDaySource;
}) {
  return {
    p_actor_user_id: input.actorUserId,
    p_goal_id: input.goalId,
    p_effective_date: input.effectiveDate,
    p_resolution_source: input.resolutionSource,
  };
}
