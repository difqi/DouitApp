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
  deliveryOutcome?: 'ACCEPTED' | 'REJECTED' | 'AMBIGUOUS';
  providerMessageId?: string;
  errorCode?: string;
}

/**
 * Send WhatsApp message with automatic multi-token failover
 */
export async function sendFonnteMessageWithFailover(options: FonnteSendOptions): Promise<FonnteSendResult> {
  const tokens = getFonnteTokens();

  if (tokens.length === 0) {
    console.error("[Fonnte] Tidak ada FONNTE_API_TOKEN yang ditemukan di .env");
    return {
      status: false,
      success: false,
      deliveryOutcome: 'REJECTED',
      errorCode: 'FONNTE_TOKEN_NOT_CONFIGURED',
      message: 'Fonnte token not configured',
    };
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

      let data: { status?: boolean | string; [key: string]: any };
      try {
        data = (await response.json()) as { status?: boolean | string; [key: string]: any };
      } catch {
        console.warn('[Fonnte Dispatcher] Provider response could not be classified; send outcome is ambiguous.');
        return {
          status: false,
          success: false,
          deliveryOutcome: 'AMBIGUOUS',
          errorCode: 'FONNTE_RESPONSE_AMBIGUOUS',
          message: 'Fonnte response was not classifiable.',
        };
      }

      // Fonnte returns { status: true, ... } on success
      if (data && (data.status === true || data.status === "true")) {
        const rawProviderMessageId = Array.isArray(data.id) ? data.id[0] : data.id;
        const providerMessageId =
          typeof rawProviderMessageId === 'string' || typeof rawProviderMessageId === 'number'
            ? String(rawProviderMessageId)
            : undefined;
        console.log(`[Fonnte API Response]: Pesan diterima provider via token ke-${i + 1}`);
        return {
          status: true,
          success: true,
          data,
          usedTokenIndex: i + 1,
          deliveryOutcome: 'ACCEPTED',
          providerMessageId,
        };
      }

      const explicitlyRejected = data?.status === false || data?.status === 'false';
      if (!explicitlyRejected) {
        console.warn('[Fonnte Dispatcher] Provider response had no definitive status; send outcome is ambiguous.');
        return {
          status: false,
          success: false,
          data,
          deliveryOutcome: 'AMBIGUOUS',
          errorCode: 'FONNTE_STATUS_AMBIGUOUS',
          message: 'Fonnte response did not contain a definitive status.',
        };
      }

      console.warn(`[Fonnte Failover] Token ke-${i + 1} ditolak provider. Mencoba token berikutnya...`);
      lastResponse = data;
    } catch (err) {
      // A transport failure can happen after Fonnte accepted the request. Trying
      // another token here could duplicate the message, so stop and surface the
      // outcome as ambiguous instead of treating it as a safe rejection.
      console.warn(`[Fonnte Failover] Hasil token ke-${i + 1} ambigu karena kegagalan transport.`);
      return {
        status: false,
        success: false,
        error: err,
        deliveryOutcome: 'AMBIGUOUS',
        errorCode: 'FONNTE_TRANSPORT_AMBIGUOUS',
        message: 'Fonnte transport outcome is ambiguous.',
      };
    }
  }

  console.error("[Fonnte] Semua token Fonnte gagal mengirim pesan.");
  return {
    status: false,
    success: false,
    error: lastResponse,
    deliveryOutcome: 'REJECTED',
    errorCode: 'FONNTE_REJECTED',
    message: 'Semua token Fonnte menolak pesan.',
  };
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
