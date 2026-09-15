import { getSingleRpcRow } from '@/lib/savings-contributions';
import { sendFonnteMessageWithFailover, type FonnteSendResult } from '@/lib/fonnte';

export const NOTIFICATION_DELIVERY_STATES = [
  'CLAIMED',
  'ACCEPTED',
  'FAILED',
  'AMBIGUOUS',
] as const;

export type NotificationDeliveryState = typeof NOTIFICATION_DELIVERY_STATES[number];

export type NotificationDeliveryClaimOutcome =
  | 'CLAIMED'
  | 'ALREADY_CLAIMED'
  | 'ALREADY_ACCEPTED'
  | 'ALREADY_FAILED'
  | 'ALREADY_AMBIGUOUS'
  | 'NOT_ELIGIBLE';

export interface NotificationDeliveryClaimResult {
  out_outcome: NotificationDeliveryClaimOutcome;
  out_delivery_id: string | null;
  out_state: NotificationDeliveryState | null;
  out_attempt_count: number | null;
  out_suppression_reason: string | null;
}

export interface NotificationDeliveryFinalizeResult {
  out_delivery_id: string;
  out_state: NotificationDeliveryState;
  out_updated: boolean;
}

const STABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

export function buildNotificationOperationKey(input: {
  actorUserId: string;
  notificationType:
    | 'SAVINGS_CONTRIBUTION_CONFIRMATION'
    | 'SAVINGS_SKIP_CONFIRMATION'
    | 'SAVINGS_EMAIL_CONFIRMATION'
    | 'WHATSAPP_OTP';
  source: 'FONNTE' | 'RESEND' | 'DOUIT';
  stableId: string | null | undefined;
}): string | null {
  const actorUserId = String(input.actorUserId || '').trim();
  const stableId = String(input.stableId || '').trim();
  if (!STABLE_ID_PATTERN.test(actorUserId) || !STABLE_ID_PATTERN.test(stableId)) return null;
  return `${input.notificationType.toLowerCase()}:${input.source.toLowerCase()}:${actorUserId}:${stableId}`;
}

export function buildGenericDeliveryClaimArgs(input: {
  actorUserId: string;
  operationKey: string;
  notificationType:
    | 'SAVINGS_CONTRIBUTION_CONFIRMATION'
    | 'SAVINGS_SKIP_CONFIRMATION'
    | 'SAVINGS_EMAIL_CONFIRMATION'
    | 'WHATSAPP_OTP';
  relatedGoalId?: string | null;
  effectiveDate?: string | null;
}) {
  return {
    p_actor_user_id: input.actorUserId,
    p_channel: 'WHATSAPP',
    p_operation_key: input.operationKey,
    p_notification_type: input.notificationType,
    p_related_goal_id: input.relatedGoalId || null,
    p_effective_date: input.effectiveDate || null,
  };
}

export function buildSavingsReminderClaimArgs(input: {
  actorUserId: string;
  goalId: string;
  effectiveDate: string;
  scheduleSlot: string;
}) {
  return {
    p_actor_user_id: input.actorUserId,
    p_goal_id: input.goalId,
    p_effective_date: input.effectiveDate,
    p_schedule_slot: input.scheduleSlot,
  };
}

export function buildBudgetAlertClaimArgs(input: {
  actorUserId: string;
  effectiveDate: string;
  notificationType: 'BUDGET_WARNING_75' | 'OVER_BUDGET_ALERT';
}) {
  return {
    p_actor_user_id: input.actorUserId,
    p_effective_date: input.effectiveDate,
    p_notification_type: input.notificationType,
  };
}

export async function claimNotificationDelivery(
  supabase: any,
  args: ReturnType<typeof buildGenericDeliveryClaimArgs>,
): Promise<{ claim: NotificationDeliveryClaimResult | null; error: any }> {
  const { data, error } = await supabase.rpc('claim_notification_delivery', args);
  return { claim: error ? null : getSingleRpcRow<NotificationDeliveryClaimResult>(data), error };
}

export async function claimSavingsReminderDelivery(
  supabase: any,
  args: ReturnType<typeof buildSavingsReminderClaimArgs>,
): Promise<{ claim: NotificationDeliveryClaimResult | null; error: any }> {
  const { data, error } = await supabase.rpc('claim_savings_reminder_delivery', args);
  return { claim: error ? null : getSingleRpcRow<NotificationDeliveryClaimResult>(data), error };
}

export async function claimBudgetAlertDelivery(
  supabase: any,
  args: ReturnType<typeof buildBudgetAlertClaimArgs>,
): Promise<{ claim: NotificationDeliveryClaimResult | null; error: any }> {
  const { data, error } = await supabase.rpc('claim_budget_alert_delivery', args);
  return { claim: error ? null : getSingleRpcRow<NotificationDeliveryClaimResult>(data), error };
}

export function getFonnteProviderMessageId(result: FonnteSendResult): string | null {
  if (result.providerMessageId) return result.providerMessageId;
  const rawId = Array.isArray(result.data?.id) ? result.data.id[0] : result.data?.id;
  if (typeof rawId === 'string' || typeof rawId === 'number') {
    const normalized = String(rawId).trim();
    return normalized || null;
  }
  return null;
}

export function resolveFonnteFinalState(result: FonnteSendResult): {
  state: Exclude<NotificationDeliveryState, 'CLAIMED'>;
  providerMessageId: string | null;
  errorCode: string | null;
} {
  if (result.deliveryOutcome === 'ACCEPTED' || result.success) {
    return { state: 'ACCEPTED', providerMessageId: getFonnteProviderMessageId(result), errorCode: null };
  }
  if (result.deliveryOutcome === 'AMBIGUOUS') {
    return {
      state: 'AMBIGUOUS',
      providerMessageId: null,
      errorCode: result.errorCode || 'FONNTE_AMBIGUOUS_OUTCOME',
    };
  }
  return {
    state: 'FAILED',
    providerMessageId: null,
    errorCode: result.errorCode || 'FONNTE_REJECTED',
  };
}

export async function sendClaimedFonnteDelivery(input: {
  supabase: any;
  actorUserId: string;
  claim: NotificationDeliveryClaimResult;
  target: string;
  message: string;
  imageUrl?: string | null;
}): Promise<{
  attempted: boolean;
  providerAccepted: boolean;
  finalState: NotificationDeliveryState | null;
  finalizeError: any;
}> {
  if (input.claim.out_outcome !== 'CLAIMED' || !input.claim.out_delivery_id) {
    return {
      attempted: false,
      providerAccepted: input.claim.out_state === 'ACCEPTED',
      finalState: input.claim.out_state,
      finalizeError: null,
    };
  }

  const sendResult = await sendFonnteMessageWithFailover({
    target: input.target,
    message: input.message,
    imageUrl: input.imageUrl,
  });
  const final = resolveFonnteFinalState(sendResult);
  const { data, error } = await input.supabase.rpc('finalize_notification_delivery', {
    p_actor_user_id: input.actorUserId,
    p_delivery_id: input.claim.out_delivery_id,
    p_final_state: final.state,
    p_provider_message_id: final.providerMessageId,
    p_error_code: final.errorCode,
  });
  const finalized = error ? null : getSingleRpcRow<NotificationDeliveryFinalizeResult>(data);

  return {
    attempted: true,
    providerAccepted: final.state === 'ACCEPTED',
    finalState: finalized?.out_state || (error ? 'CLAIMED' : final.state),
    finalizeError: error,
  };
}
