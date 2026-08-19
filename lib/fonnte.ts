/**
 * Fonnte WhatsApp Gateway Helper with Multi-Token Failover
 */

// Gather all available Fonnte tokens in priority order
export function getFonnteTokens(): string[] {
  const tokens: string[] = [];
  if (process.env.FONNTE_API_TOKEN_1) tokens.push(process.env.FONNTE_API_TOKEN_1.trim());
  if (process.env.FONNTE_API_TOKEN_2) tokens.push(process.env.FONNTE_API_TOKEN_2.trim());
  
  if (process.env.FONNTE_API_TOKEN && !tokens.includes(process.env.FONNTE_API_TOKEN.trim())) {
    tokens.push(process.env.FONNTE_API_TOKEN.trim());
  }
  return tokens.filter(Boolean);
}

export interface FonnteSendOptions {
  target: string;
  message: string;
  url?: string | null;
  imageUrl?: string | null;
  filename?: string;
  delay?: string;
}

export interface SendWhatsAppMessageParams {
  target: string;
  message: string;
  imageUrl?: string | null;
  url?: string | null;
}

export interface FonnteSendResult {
  status: boolean;
  success: boolean;
  data?: any;
  error?: any;
  message?: string;
  usedTokenIndex?: number;
}

/**
 * Send WhatsApp message with automatic multi-token failover
 */
export async function sendFonnteMessageWithFailover(options: FonnteSendOptions): Promise<FonnteSendResult> {
  const tokens = getFonnteTokens();

  if (tokens.length === 0) {
    console.error("[Fonnte] Tidak ada FONNTE_API_TOKEN yang ditemukan di .env");
    return { status: false, success: false, message: "Fonnte token not configured" };
  }

  let cleanPhone = (options.target || "").replace(/[^0-9]/g, "");
  if (cleanPhone.startsWith("0")) {
    cleanPhone = "62" + cleanPhone.slice(1);
  } else if (cleanPhone.startsWith("8")) {
    cleanPhone = "62" + cleanPhone;
  }

  // Strict URL validation: Must be non-empty and start with http:// or https://
  const rawUrl = options.url || options.imageUrl;
  let mediaUrl: string | undefined = undefined;
  if (rawUrl && typeof rawUrl === "string") {
    const trimmedUrl = rawUrl.trim();
    if (trimmedUrl.startsWith("http://") || trimmedUrl.startsWith("https://")) {
      mediaUrl = trimmedUrl;
    } else {
      console.warn(`[Fonnte Dispatcher] Invalid media URL prefix (ignored): "${trimmedUrl}"`);
    }
  }

  let lastResponse: any = null;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    try {
      const payload: Record<string, any> = {
        target: cleanPhone,
        message: options.message,
        countryCode: "62",
      };

      if (mediaUrl) {
        payload.url = mediaUrl;
        payload.delay = options.delay || "2";
      }

      if (options.filename) {
        payload.filename = options.filename;
      }

      const response = await fetch("https://api.fonnte.com/send", {
        method: "POST",
        headers: {
          Authorization: token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = (await response.json().catch(() => ({}))) as { status?: boolean | string; [key: string]: any };

      // Fonnte returns { status: true, ... } on success
      if (data && (data.status === true || data.status === "true")) {
        console.log(`[Fonnte API Response]: Pesan sukses terkirim via token ke-${i + 1} ke ${cleanPhone}`);
        return { status: true, success: true, data, usedTokenIndex: i + 1 };
      }

      console.warn(
        `[Fonnte Failover] Token ke-${i + 1} gagal mengirim pesan (Respon Fonnte: ${JSON.stringify(data)}). Mencoba token berikutnya...`
      );
      lastResponse = data;
    } catch (err) {
      console.warn(`[Fonnte Failover] Error jaringan pada token ke-${i + 1}:`, err);
      lastResponse = err;
    }
  }

  console.error("[Fonnte] Semua token Fonnte gagal mengirim pesan.");
  return { status: false, success: false, error: lastResponse, message: "Semua token Fonnte gagal mengirim pesan." };
}

/**
 * Backward-compatible helper for sendWhatsAppMessage
 */
export async function sendWhatsAppMessage(params: SendWhatsAppMessageParams): Promise<FonnteSendResult> {
  return sendFonnteMessageWithFailover({
    target: params.target,
    message: params.message,
    url: params.url || params.imageUrl,
  });
}

/**
 * Backward-compatible helper for sendFonnteMessage
 */
export async function sendFonnteMessage(target: string, message: string, imageUrl?: string | null): Promise<FonnteSendResult> {
  return sendFonnteMessageWithFailover({
    target,
    message,
    url: imageUrl,
  });
}

/**
 * Returns raw emoji progress bar blocks without percentages.
 */
export function getWaProgressBarBlocks(percent: number): string {
  const totalBlocks = 10;
  const validPercent = Math.min(100, Math.max(0, Math.round(percent)));
  const filledBlocks = validPercent > 0 ? Math.max(1, Math.floor((validPercent / 100) * totalBlocks)) : 0;
  const emptyBlocks = totalBlocks - filledBlocks;

  let activeEmoji = "🟧";
  if (validPercent >= 70) {
    activeEmoji = "🟩";
  } else if (validPercent >= 30) {
    activeEmoji = "🟨";
  }

  const emptyEmoji = "⬛";
  return activeEmoji.repeat(filledBlocks) + emptyEmoji.repeat(emptyBlocks);
}

/**
 * Generates a high-contrast emoji progress bar for WhatsApp notifications.
 * @param percent Number between 0 and 100 representing completion percentage.
 */
export function generateWaProgressBar(percent: number): string {
  const validPercent = Math.min(100, Math.max(0, Math.round(percent)));
  const progressBar = getWaProgressBarBlocks(percent);
  return `${progressBar} 🎯 *${validPercent}%*`;
}
