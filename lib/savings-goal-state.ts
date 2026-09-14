export type SavingsGoalHistoryState = {
  out_goal_id: string;
  out_has_savings_logs: boolean;
  out_has_missed_day_resolutions: boolean;
};

export type SavingsGoalRemovalAction = 'DELETE' | 'ARCHIVE';

export type SavingsGoalDeleteResult = {
  out_goal_id: string;
  out_outcome: 'DELETED' | 'HAS_HISTORY' | 'NOT_ACTIVE';
};

export function resolveSavingsGoalRemovalAction({
  hasSavingsLogs,
  hasMissedDayResolutions,
}: {
  hasSavingsLogs: boolean;
  hasMissedDayResolutions: boolean;
}): SavingsGoalRemovalAction {
  return hasSavingsLogs || hasMissedDayResolutions ? 'ARCHIVE' : 'DELETE';
}
