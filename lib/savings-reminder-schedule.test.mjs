import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  filterUnsentReminderSlots,
  resolveEligibleReminderSlots,
} from './savings-reminder-schedule.ts';

const reminderRouteSource = await readFile(
  new URL('../app/api/cron/savings-reminder/route.ts', import.meta.url),
  'utf8',
);

test('matches exact scheduled slot and preserves its identity', () => {
  assert.deepEqual(
    resolveEligibleReminderSlots(['08:30'], new Date('2026-09-03T01:30:00.000Z')),
    [{ slot: '08:30', date: '2026-09-03' }],
  );
});

test('matches execution delayed by one minute', () => {
  assert.deepEqual(
    resolveEligibleReminderSlots(['08:31'], new Date('2026-09-03T01:32:00.000Z')),
    [{ slot: '08:31', date: '2026-09-03' }],
  );
});

test('matches execution delayed by four minutes', () => {
  assert.deepEqual(
    resolveEligibleReminderSlots(['08:31'], new Date('2026-09-03T01:35:00.000Z')),
    [{ slot: '08:31', date: '2026-09-03' }],
  );
});

test('excludes the exact five-minute lower boundary', () => {
  assert.deepEqual(
    resolveEligibleReminderSlots(['08:30'], new Date('2026-09-03T01:35:00.000Z')),
    [],
  );
});

test('excludes reminders older than the scheduling window', () => {
  assert.deepEqual(
    resolveEligibleReminderSlots(['08:20'], new Date('2026-09-03T01:35:00.000Z')),
    [],
  );
});

test('supports arbitrary reminder minutes in WIB', () => {
  assert.deepEqual(
    resolveEligibleReminderSlots(['13:17'], new Date('2026-09-03T06:20:00.000Z')),
    [{ slot: '13:17', date: '2026-09-03' }],
  );
});

test('crosses midnight while preserving the scheduled date and slot', () => {
  assert.deepEqual(
    resolveEligibleReminderSlots(['23:59'], new Date('2026-09-03T17:00:00.000Z')),
    [{ slot: '23:59', date: '2026-09-03' }],
  );
});

test('derives WIB rather than server-local time from a known UTC timestamp', () => {
  assert.deepEqual(
    resolveEligibleReminderSlots(['13:17'], new Date('2026-09-03T06:17:00.000Z')),
    [{ slot: '13:17', date: '2026-09-03' }],
  );
});

test('returns every eligible slot in the same five-minute window', () => {
  assert.deepEqual(
    resolveEligibleReminderSlots(['08:31', '08:34'], new Date('2026-09-03T01:35:00.000Z')),
    [
      { slot: '08:31', date: '2026-09-03' },
      { slot: '08:34', date: '2026-09-03' },
    ],
  );
});

test('normalizes and deduplicates duplicate configured times', () => {
  assert.deepEqual(
    resolveEligibleReminderSlots(['8:31', '08:31', 'invalid'], new Date('2026-09-03T01:35:00.000Z')),
    [{ slot: '08:31', date: '2026-09-03' }],
  );
});

test('returns only eligible slots when another configured time is outside the window', () => {
  assert.deepEqual(
    resolveEligibleReminderSlots(['08:20', '08:34'], new Date('2026-09-03T01:35:00.000Z')),
    [{ slot: '08:34', date: '2026-09-03' }],
  );
});

test('preserves each scheduled identity when one window crosses midnight', () => {
  assert.deepEqual(
    resolveEligibleReminderSlots(['23:59', '00:01'], new Date('2026-09-03T17:02:00.000Z')),
    [
      { slot: '23:59', date: '2026-09-03' },
      { slot: '00:01', date: '2026-09-04' },
    ],
  );
});

test('keeps an unsent same-window slot when another slot was already sent', () => {
  const eligibleSlots = resolveEligibleReminderSlots(
    ['08:31', '08:34'],
    new Date('2026-09-03T01:35:00.000Z'),
  );

  assert.deepEqual(
    filterUnsentReminderSlots(eligibleSlots, [{ date: '2026-09-03', slot: '08:31' }]),
    [{ date: '2026-09-03', slot: '08:34' }],
  );
});

test('route deduplicates and records the resolved scheduled identity', () => {
  assert.match(reminderRouteSource, /resolveEligibleReminderSlots\(times, now\)/);
  assert.match(reminderRouteSource, /\[\{ date: notificationDateWIB, slot: notificationSlot \}\]/);
  assert.match(reminderRouteSource, /filterUnsentReminderSlots\(scheduledIdentities, sentScheduledIdentities\)/);
  assert.match(reminderRouteSource, /for \(const scheduledIdentity of scheduledIdentities\)/);
  assert.match(reminderRouteSource, /slot: scheduledIdentity\.slot,[\s\S]*?date: scheduledIdentity\.date/);
});

test('midnight reminder uses its scheduled date for suppression and expense context', () => {
  const resolvedSlotIndex = reminderRouteSource.indexOf(
    'scheduledIdentities = resolveEligibleReminderSlots(times, now);',
  );
  const depositSuppressionIndex = reminderRouteSource.indexOf(
    'goal.last_deposit_date !== scheduledIdentity.date',
  );

  assert.ok(resolvedSlotIndex >= 0);
  assert.ok(depositSuppressionIndex > resolvedSlotIndex);
  assert.match(reminderRouteSource, /notificationDateWIB !== scheduledIdentity\.date/);
  assert.match(reminderRouteSource, /const effectiveReminderDate = scheduledIdentity\.date/);
  assert.match(reminderRouteSource, /txDateWIB !== effectiveReminderDate/);
  assert.match(reminderRouteSource, /date: scheduledIdentity\.date/);
});
