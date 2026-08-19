import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleGenAI } from "@google/genai";

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
    errorMsg.includes("limit") ||
    errorMsg.includes("rate") ||
    errorMsg.includes("too many requests")
  );
}

/**
 * Execute a Gemini AI operation with automatic multi-key failover using @google/generative-ai (GoogleGenerativeAI)
 */
export async function executeWithGeminiFailover<T>(
  operation: (ai: GoogleGenerativeAI, apiKey: string) => Promise<T>
): Promise<T> {
  const keys = getGeminiApiKeys();

  if (keys.length === 0) {
    throw new Error("Tidak ada Gemini API Key yang terkonfigurasi di file environment.");
  }

  let lastError: any = null;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    try {
      const genAI = new GoogleGenerativeAI(key);
      return await operation(genAI, key);
    } catch (error: any) {
      lastError = error;
      const isRateLimit = isRateLimitError(error);

      console.warn(
        `[Gemini AI Failover] Token ke-${i + 1} gagal (${isRateLimit ? "Rate Limit / Quota Exceeded" : "Error"}: ${error?.message || error}). Mencoba token berikutnya...`
      );

      // Continue to next key in loop
    }
  }

  console.error("[Gemini AI] Semua token API Gemini telah habis kuota atau gagal.");
  throw lastError || new Error("Semua Gemini API Token gagal merespons.");
}

/**
 * Execute a Gemini AI operation with automatic multi-key failover using @google/genai (GoogleGenAI)
 */
export async function executeWithGenAIFailover<T>(
  operation: (ai: GoogleGenAI, apiKey: string) => Promise<T>
): Promise<T> {
  const keys = getGeminiApiKeys();

  if (keys.length === 0) {
    throw new Error("Tidak ada Gemini API Key yang terkonfigurasi di file environment.");
  }

  let lastError: any = null;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    try {
      const genAI = new GoogleGenAI({ apiKey: key });
      return await operation(genAI, key);
    } catch (error: any) {
      lastError = error;
      const isRateLimit = isRateLimitError(error);

      console.warn(
        `[Gemini AI Failover] Token ke-${i + 1} gagal (${isRateLimit ? "Rate Limit / Quota Exceeded" : "Error"}: ${error?.message || error}). Mencoba token berikutnya...`
      );

      // Continue to next key in loop
    }
  }

  console.error("[Gemini AI] Semua token API Gemini telah habis kuota atau gagal.");
  throw lastError || new Error("Semua Gemini API Token gagal merespons.");
}
