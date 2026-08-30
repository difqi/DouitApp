import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleGenAI } from "@google/genai";

export type GeminiAttemptTelemetry = {
  attempt: number;
  durationMs: number;
  success: boolean;
  failureClass: "rate_limit" | "authentication" | "invalid_request" | "timeout" | "provider" | "network" | "unknown" | null;
  errorType: string | null;
  retryable: boolean | null;
};

type GeminiFailoverOptions = {
  onAttempt?: (telemetry: GeminiAttemptTelemetry) => void;
  attemptTimeoutMs?: number;
  totalTimeoutMs?: number;
};

export type GeminiAttemptContext = {
  abortSignal?: AbortSignal;
  timeoutMs?: number;
};

class GeminiDeadlineError extends Error {
  code: string;

  constructor(code: "GEMINI_ATTEMPT_TIMEOUT" | "GEMINI_TOTAL_TIMEOUT") {
    super(code === "GEMINI_TOTAL_TIMEOUT" ? "Gemini total deadline exceeded" : "Gemini attempt timed out");
    this.name = "GeminiTimeoutError";
    this.code = code;
  }
}

/**
 * Gather all available Gemini API keys in priority order with deduplication
 */
export function getGeminiApiKeys(): string[] {
  const keys: string[] = [];
  if (process.env.GEMINI_API_KEY_1) keys.push(process.env.GEMINI_API_KEY_1.trim());
  if (process.env.GEMINI_API_KEY_2) keys.push(process.env.GEMINI_API_KEY_2.trim());
  if (process.env.GEMINI_API_KEY_3) keys.push(process.env.GEMINI_API_KEY_3.trim());
  
  if (process.env.GEMINI_API_KEY && !keys.includes(process.env.GEMINI_API_KEY.trim())) {
    keys.push(process.env.GEMINI_API_KEY.trim());
  }

  if (process.env.NEXT_PUBLIC_GEMINI_API_KEY && !keys.includes(process.env.NEXT_PUBLIC_GEMINI_API_KEY.trim())) {
    keys.push(process.env.NEXT_PUBLIC_GEMINI_API_KEY.trim());
  }

  return keys.filter(Boolean);
}

/**
 * Helper to check if an error is a rate limit or quota exceeded error
 */
function isRateLimitError(error: any): boolean {
  const errorMsg = (error?.message || String(error || "")).toLowerCase();
  const status = error?.status || error?.statusCode || error?.response?.status;
  return (
    status === 429 ||
    errorMsg.includes("429") ||
    errorMsg.includes("resource_exhausted") ||
    errorMsg.includes("quota") ||
    errorMsg.includes("rate limit") ||
    errorMsg.includes("rate_limit") ||
    errorMsg.includes("too many requests")
  );
}

function getErrorStatus(error: any): number | null {
  const value = error?.status || error?.statusCode || error?.response?.status;
  return typeof value === "number" ? value : null;
}

function classifyGeminiError(error: any): GeminiAttemptTelemetry["failureClass"] {
  if (isRateLimitError(error)) return "rate_limit";

  const status = getErrorStatus(error);
  const errorName = typeof error?.name === "string" ? error.name.toLowerCase() : "";
  const errorCode = typeof error?.code === "string" ? error.code.toLowerCase() : "";
  const errorMessage = typeof error?.message === "string" ? error.message.toLowerCase() : "";

  if (status === 401 || status === 403) return "authentication";
  if (status === 408 || errorName.includes("timeout") || errorName === "aborterror" || errorCode.includes("timeout")) return "timeout";
  if (typeof status === "number" && status >= 400 && status < 500) return "invalid_request";
  if (typeof status === "number" && status >= 500) return "provider";
  if (
    errorName.includes("fetch")
    || (errorName === "typeerror" && (errorMessage.includes("fetch") || errorMessage.includes("network")))
    || errorCode.includes("network")
    || errorCode.includes("conn")
    || errorCode.includes("eai_again")
  ) return "network";
  return "unknown";
}

function isRetryableFailure(failureClass: GeminiAttemptTelemetry["failureClass"]): boolean {
  return failureClass === "rate_limit"
    || failureClass === "timeout"
    || failureClass === "provider"
    || failureClass === "network";
}

function getSafeErrorType(error: any): string {
  if (typeof error?.name === "string" && error.name.trim()) return error.name.trim().slice(0, 80);
  return "Error";
}

function reportAttempt(
  options: GeminiFailoverOptions,
  startedAt: number,
  attempt: number,
  error?: unknown,
) {
  const failureClass = error === undefined ? null : classifyGeminiError(error);
  options.onAttempt?.({
    attempt,
    durationMs: Math.round(performance.now() - startedAt),
    success: error === undefined,
    failureClass,
    errorType: error === undefined ? null : getSafeErrorType(error),
    retryable: error === undefined ? null : isRetryableFailure(failureClass),
  });
}

function positiveDuration(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

async function runWithDeadline<T>(
  operation: (context: GeminiAttemptContext) => Promise<T>,
  timeoutMs: number | undefined,
  timeoutCode: "GEMINI_ATTEMPT_TIMEOUT" | "GEMINI_TOTAL_TIMEOUT",
): Promise<T> {
  if (!timeoutMs) return operation({});

  const controller = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      const error = new GeminiDeadlineError(timeoutCode);
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      operation({ abortSignal: controller.signal, timeoutMs }),
      timeout,
    ]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

function attemptDeadline(
  attemptTimeoutMs: number | undefined,
  totalTimeoutMs: number | undefined,
  totalStartedAt: number,
): { timeoutMs: number | undefined; timeoutCode: "GEMINI_ATTEMPT_TIMEOUT" | "GEMINI_TOTAL_TIMEOUT" } {
  if (!totalTimeoutMs) {
    return { timeoutMs: attemptTimeoutMs, timeoutCode: "GEMINI_ATTEMPT_TIMEOUT" };
  }

  const remainingTotalMs = Math.max(1, totalTimeoutMs - Math.round(performance.now() - totalStartedAt));
  if (!attemptTimeoutMs || remainingTotalMs <= attemptTimeoutMs) {
    return { timeoutMs: remainingTotalMs, timeoutCode: "GEMINI_TOTAL_TIMEOUT" };
  }
  return { timeoutMs: attemptTimeoutMs, timeoutCode: "GEMINI_ATTEMPT_TIMEOUT" };
}

/**
 * Execute a Gemini AI operation with automatic multi-key failover using @google/generative-ai (GoogleGenerativeAI)
 */
export async function executeWithGeminiFailover<T>(
  operation: (ai: GoogleGenerativeAI, apiKey: string, context: GeminiAttemptContext) => Promise<T>,
  options: GeminiFailoverOptions = {},
): Promise<T> {
  const keys = getGeminiApiKeys();

  if (keys.length === 0) {
    throw new Error("Tidak ada Gemini API Key yang terkonfigurasi di file environment.");
  }

  let lastError: any = null;
  const totalStartedAt = performance.now();
  const attemptTimeoutMs = positiveDuration(options.attemptTimeoutMs);
  const totalTimeoutMs = positiveDuration(options.totalTimeoutMs);

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const attemptStartedAt = performance.now();
    try {
      const genAI = new GoogleGenerativeAI(key);
      const deadline = attemptDeadline(attemptTimeoutMs, totalTimeoutMs, totalStartedAt);
      const result = await runWithDeadline(
        (context) => operation(genAI, key, context),
        deadline.timeoutMs,
        deadline.timeoutCode,
      );
      reportAttempt(options, attemptStartedAt, i + 1);
      return result;
    } catch (error: any) {
      lastError = error;
      reportAttempt(options, attemptStartedAt, i + 1, error);
      if (!isRetryableFailure(classifyGeminiError(error))) break;
      if (totalTimeoutMs && performance.now() - totalStartedAt >= totalTimeoutMs) break;
    }
  }

  throw lastError || new Error("Semua Gemini API Token gagal merespons.");
}

/**
 * Execute a Gemini AI operation with automatic multi-key failover using @google/genai (GoogleGenAI)
 */
export async function executeWithGenAIFailover<T>(
  operation: (ai: GoogleGenAI, apiKey: string, context: GeminiAttemptContext) => Promise<T>,
  options: GeminiFailoverOptions = {},
): Promise<T> {
  const keys = getGeminiApiKeys();

  if (keys.length === 0) {
    throw new Error("Tidak ada Gemini API Key yang terkonfigurasi di file environment.");
  }

  let lastError: any = null;
  const totalStartedAt = performance.now();
  const attemptTimeoutMs = positiveDuration(options.attemptTimeoutMs);
  const totalTimeoutMs = positiveDuration(options.totalTimeoutMs);

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const attemptStartedAt = performance.now();
    try {
      const genAI = new GoogleGenAI({ apiKey: key });
      const deadline = attemptDeadline(attemptTimeoutMs, totalTimeoutMs, totalStartedAt);
      const result = await runWithDeadline(
        (context) => operation(genAI, key, context),
        deadline.timeoutMs,
        deadline.timeoutCode,
      );
      reportAttempt(options, attemptStartedAt, i + 1);
      return result;
    } catch (error: any) {
      lastError = error;
      reportAttempt(options, attemptStartedAt, i + 1, error);
      if (!isRetryableFailure(classifyGeminiError(error))) break;
      if (totalTimeoutMs && performance.now() - totalStartedAt >= totalTimeoutMs) break;
    }
  }

  throw lastError || new Error("Semua Gemini API Token gagal merespons.");
}
