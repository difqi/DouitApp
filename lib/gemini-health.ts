export type GeminiFailureClass =
  | "rate_limit"
  | "authentication"
  | "invalid_request"
  | "timeout"
  | "provider"
  | "network"
  | "unknown"
  | null;

export const DEFAULT_GEMINI_RATE_LIMIT_COOLDOWN_MS = 45_000;

type CandidateHealth = {
  cooldownUntil: number;
  lastFailureClass: GeminiFailureClass;
  consecutiveRateLimits: number;
  lastSuccessAt: number | null;
};

export type GeminiCandidate = {
  apiKey: string;
  candidateIndex: number;
};

export type GeminiCandidateSelection = {
  candidates: GeminiCandidate[];
  skippedCandidateCount: number;
  cooldownSkips: number;
  allCandidatesCooling: boolean;
};

export type GeminiHealthUpdate = {
  rateLimitCooldownApplied: boolean;
  retryAfterMs: number | null;
  cooldownMs: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

function headerValue(headers: unknown, name: string): string | null {
  if (!headers) return null;
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    return headers.get(name);
  }
  if (isRecord(headers)) {
    const direct = headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
    return typeof direct === "string" ? direct : null;
  }
  return null;
}

function parseRetryAfterHeader(value: string | null, now: number): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  const date = Date.parse(value);
  return Number.isFinite(date) && date > now ? Math.ceil(date - now) : null;
}

function parseRetryDelayText(value: string): number | null {
  const retryDelay = /(?:"retryDelay"\s*:\s*"|retry\s+in\s+)(\d+(?:\.\d+)?)\s*(ms|s)/i.exec(value);
  if (!retryDelay) return null;
  const amount = Number(retryDelay[1]);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.ceil(amount * (retryDelay[2].toLowerCase() === "s" ? 1_000 : 1));
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) || "";
  } catch {
    return "";
  }
}

export function extractGeminiRetryAfterMs(error: unknown, now = Date.now()): number | null {
  if (!isRecord(error)) return null;
  const response = isRecord(error.response) ? error.response : null;
  const responseInternal = isRecord(error.responseInternal) ? error.responseInternal : null;
  const sdkHttpResponse = isRecord(error.sdkHttpResponse) ? error.sdkHttpResponse : null;
  const headerContainers = [
    error.headers,
    response?.headers,
    responseInternal?.headers,
    sdkHttpResponse?.headers,
  ];

  for (const headers of headerContainers) {
    const retryAfterMs = headerValue(headers, "retry-after-ms");
    if (retryAfterMs !== null) {
      const parsed = Number(retryAfterMs);
      if (Number.isFinite(parsed) && parsed >= 0) return Math.ceil(parsed);
    }
    const parsedRetryAfter = parseRetryAfterHeader(headerValue(headers, "retry-after"), now);
    if (parsedRetryAfter !== null) return parsedRetryAfter;
  }

  const textSources = [
    typeof error.message === "string" ? error.message : "",
    error.errorDetails === undefined ? "" : safeStringify(error.errorDetails),
    error.details === undefined ? "" : safeStringify(error.details),
  ];
  for (const source of textSources) {
    const parsed = parseRetryDelayText(source);
    if (parsed !== null) return parsed;
  }
  return null;
}

export class GeminiProviderHealthRegistry {
  private readonly healthByKey = new Map<string, CandidateHealth>();
  private readonly defaultCooldownMs: number;

  constructor(defaultCooldownMs = DEFAULT_GEMINI_RATE_LIMIT_COOLDOWN_MS) {
    this.defaultCooldownMs = defaultCooldownMs;
  }

  select(keys: string[], now = Date.now()): GeminiCandidateSelection {
    const configured = keys.map((apiKey, index) => ({ apiKey, candidateIndex: index + 1 }));
    const eligible = configured.filter(({ apiKey }) =>
      (this.healthByKey.get(apiKey)?.cooldownUntil || 0) <= now,
    );
    if (eligible.length > 0) {
      const cooldownSkips = configured.length - eligible.length;
      return {
        candidates: eligible,
        skippedCandidateCount: cooldownSkips,
        cooldownSkips,
        allCandidatesCooling: false,
      };
    }

    const earliest = configured.reduce<GeminiCandidate | null>((selected, candidate) => {
      if (!selected) return candidate;
      const selectedUntil = this.healthByKey.get(selected.apiKey)?.cooldownUntil || 0;
      const candidateUntil = this.healthByKey.get(candidate.apiKey)?.cooldownUntil || 0;
      return candidateUntil < selectedUntil ? candidate : selected;
    }, null);
    return {
      candidates: earliest ? [earliest] : [],
      skippedCandidateCount: Math.max(0, configured.length - (earliest ? 1 : 0)),
      cooldownSkips: Math.max(0, configured.length - (earliest ? 1 : 0)),
      allCandidatesCooling: configured.length > 0,
    };
  }

  recordSuccess(apiKey: string, now = Date.now()): void {
    this.healthByKey.set(apiKey, {
      cooldownUntil: 0,
      lastFailureClass: null,
      consecutiveRateLimits: 0,
      lastSuccessAt: now,
    });
  }

  recordFailure(
    apiKey: string,
    failureClass: GeminiFailureClass,
    retryAfterMs: number | null,
    now = Date.now(),
  ): GeminiHealthUpdate {
    const current = this.healthByKey.get(apiKey);
    if (failureClass !== "rate_limit") {
      this.healthByKey.set(apiKey, {
        cooldownUntil: current?.cooldownUntil || 0,
        lastFailureClass: failureClass,
        consecutiveRateLimits: current?.consecutiveRateLimits || 0,
        lastSuccessAt: current?.lastSuccessAt || null,
      });
      return { rateLimitCooldownApplied: false, retryAfterMs: null, cooldownMs: 0 };
    }

    const cooldownMs = retryAfterMs ?? this.defaultCooldownMs;
    this.healthByKey.set(apiKey, {
      cooldownUntil: now + cooldownMs,
      lastFailureClass: failureClass,
      consecutiveRateLimits: (current?.consecutiveRateLimits || 0) + 1,
      lastSuccessAt: current?.lastSuccessAt || null,
    });
    return {
      rateLimitCooldownApplied: true,
      retryAfterMs,
      cooldownMs,
    };
  }
}

export function isRetryableGeminiFailure(failureClass: GeminiFailureClass): boolean {
  return failureClass === "rate_limit"
    || failureClass === "timeout"
    || failureClass === "provider"
    || failureClass === "network";
}
