const WIB_TIME_ZONE = 'Asia/Jakarta';
const REMINDER_WINDOW_MINUTES = 5;

export type EligibleReminderSlot = {
  slot: string;
  date: string;
};

function reminderIdentityKey(identity: EligibleReminderSlot): string {
  return `${identity.date}:${identity.slot}`;
}

export function filterUnsentReminderSlots(
  eligibleSlots: readonly EligibleReminderSlot[],
  sentSlots: readonly EligibleReminderSlot[],
): EligibleReminderSlot[] {
  const sentIdentities = new Set(sentSlots.map(reminderIdentityKey));
  return eligibleSlots.filter((identity) => !sentIdentities.has(reminderIdentityKey(identity)));
}

function getWibExecutionMinute(executionTime: Date): number | null {
  if (Number.isNaN(executionTime.getTime())) return null;

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: WIB_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(executionTime);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return Math.floor(Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
  ) / 60_000);
}

function normalizeReminderTime(value: string): { slot: string; hour: number; minute: number } | null {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;

  return {
    slot: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    hour,
    minute,
  };
}

/**
 * Resolves all unique scheduled WIB slots in the non-overlapping window
 * (execution minute - 5 minutes, execution minute]. The lower boundary is
 * excluded so a slot cannot be eligible in two consecutive five-minute runs.
 */
export function resolveEligibleReminderSlots(
  scheduledTimes: readonly string[],
  executionTime: Date,
): EligibleReminderSlot[] {
  const executionMinute = getWibExecutionMinute(executionTime);
  if (executionMinute === null) return [];

  const eligibleSlots: EligibleReminderSlot[] = [];
  const seenIdentities = new Set<string>();

  for (const scheduledTime of scheduledTimes) {
    const normalized = normalizeReminderTime(scheduledTime);
    if (!normalized) continue;

    const executionDate = new Date(executionMinute * 60_000);
    let scheduledMinute = Math.floor(Date.UTC(
      executionDate.getUTCFullYear(),
      executionDate.getUTCMonth(),
      executionDate.getUTCDate(),
      normalized.hour,
      normalized.minute,
    ) / 60_000);

    if (scheduledMinute > executionMinute) {
      scheduledMinute -= 24 * 60;
    }

    const ageMinutes = executionMinute - scheduledMinute;
    if (ageMinutes >= 0 && ageMinutes < REMINDER_WINDOW_MINUTES) {
      const identity = {
        slot: normalized.slot,
        date: new Date(scheduledMinute * 60_000).toISOString().slice(0, 10),
      };
      const identityKey = reminderIdentityKey(identity);
      if (!seenIdentities.has(identityKey)) {
        seenIdentities.add(identityKey);
        eligibleSlots.push(identity);
      }
    }
  }

  return eligibleSlots;
}
