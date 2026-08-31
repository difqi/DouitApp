import assert from "node:assert/strict";
import test from "node:test";
import {
  extractGeminiRetryAfterMs,
  GeminiProviderHealthRegistry,
  isRetryableGeminiFailure,
} from "./gemini-health.ts";

const KEYS = ["test-key-a", "test-key-b"];

test("rate-limited candidate is skipped on the next immediate selection", () => {
  const health = new GeminiProviderHealthRegistry(45_000);
  const first = health.select(KEYS, 1_000);
  assert.deepEqual(first.candidates.map((candidate) => candidate.candidateIndex), [1, 2]);

  const update = health.recordFailure(KEYS[0], "rate_limit", null, 1_000);
  assert.equal(update.rateLimitCooldownApplied, true);
  assert.equal(update.cooldownMs, 45_000);

  const next = health.select(KEYS, 1_001);
  assert.deepEqual(next.candidates.map((candidate) => candidate.candidateIndex), [2]);
  assert.equal(next.cooldownSkips, 1);
  assert.equal(next.skippedCandidateCount, 1);
});

test("candidate becomes eligible after cooldown expires", () => {
  const health = new GeminiProviderHealthRegistry(45_000);
  health.recordFailure(KEYS[0], "rate_limit", null, 1_000);
  assert.deepEqual(
    health.select(KEYS, 46_000).candidates.map((candidate) => candidate.candidateIndex),
    [1, 2],
  );
});

test("permanent 400 is non-retryable and does not apply cooldown", () => {
  const health = new GeminiProviderHealthRegistry();
  const update = health.recordFailure(KEYS[0], "invalid_request", null, 1_000);
  assert.equal(isRetryableGeminiFailure("invalid_request"), false);
  assert.equal(update.rateLimitCooldownApplied, false);
  assert.deepEqual(health.select(KEYS, 1_001).candidates.map((candidate) => candidate.candidateIndex), [1, 2]);
});

test("5xx and timeout remain transient failover classes without cooldown", () => {
  const health = new GeminiProviderHealthRegistry();
  assert.equal(isRetryableGeminiFailure("provider"), true);
  assert.equal(isRetryableGeminiFailure("timeout"), true);
  assert.equal(isRetryableGeminiFailure("network"), true);
  assert.equal(isRetryableGeminiFailure("authentication"), false);

  assert.equal(
    health.recordFailure(KEYS[0], "provider", null, 1_000).rateLimitCooldownApplied,
    false,
  );
  assert.deepEqual(
    health.select(KEYS, 1_001).candidates.map((candidate) => candidate.candidateIndex),
    [1, 2],
  );

  assert.equal(
    health.recordFailure(KEYS[0], "timeout", null, 2_000).rateLimitCooldownApplied,
    false,
  );
  assert.deepEqual(
    health.select(KEYS, 2_001).candidates.map((candidate) => candidate.candidateIndex),
    [1, 2],
  );
});

test("all-cooling selection tries only the earliest-expiring candidate", () => {
  const health = new GeminiProviderHealthRegistry();
  health.recordFailure(KEYS[0], "rate_limit", 60_000, 1_000);
  health.recordFailure(KEYS[1], "rate_limit", 30_000, 1_000);

  const selection = health.select(KEYS, 2_000);
  assert.equal(selection.allCandidatesCooling, true);
  assert.deepEqual(selection.candidates.map((candidate) => candidate.candidateIndex), [2]);
  assert.equal(selection.skippedCandidateCount, 1);
});

test("Retry-After headers and provider RetryInfo are parsed", () => {
  assert.equal(
    extractGeminiRetryAfterMs({ response: { headers: { "retry-after": "12" } } }, 1_000),
    12_000,
  );
  assert.equal(
    extractGeminiRetryAfterMs({ message: '{"details":[{"retryDelay":"3.5s"}]}' }, 1_000),
    3_500,
  );
});
