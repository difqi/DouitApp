import { GoogleGenAI } from '@google/genai';
import { getGeminiApiKeys, executeWithGenAIFailover } from '@/lib/gemini';

interface ProductLookupResult {
  product_url: string | null;
  image_url: string | null;
}

const ALLOWED_MARKETPLACE_DOMAINS = [
  'tokopedia.com',
  'shopee.co.id',
  'shopee.com',
];



function isInvalidProductImage(imgUrl: string): boolean {
  if (!imgUrl || typeof imgUrl !== 'string') return true;
  const low = imgUrl.toLowerCase();

  const blockedKeywords = [
    'seller.tokopedia',
    'seller.shopee',
    'shop_snippet',
    'shop-snippet',
    'shop_logo',
    'shop-logo',
    'shop_icon',
    'store_logo',
    'merchant_logo',
    'profile_picture',
    'avatar',
    'badge',
    'banner',
    'placeholder',
    'default_avatar',
    'no-image',
    'no_image',
    'assets/images/default',
    'default-shop',
    'example.com',
    'gettyimages',
    'shutterstock',
    'alamy',
    'istockphoto',
    'clipart',
    'vector',
    'portrait',
    'fighter',
    'ufc',
    'wallpaper',
    'wallpapers',
    'wallpapercave',
    'pinterest',
    'facebook',
    'instagram',
    'twitter',
    'youtube',
    'lemon8',
    'cookpad',
    'bloggang',
    'game',
    'games',
    'hero',
  ];

  return blockedKeywords.some(kw => low.includes(kw));
}



function isRateLimitError(err: any): boolean {
  if (!err) return false;
  const status = err?.status || err?.statusCode || err?.response?.status || err?.error?.code;
  if (status === 429 || status === '429') return true;
  const msg = (err?.message || String(err)).toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('resource_exhausted') ||
    msg.includes('rate limit') ||
    msg.includes('quota exceeded') ||
    msg.includes('too many requests')
  );
}

interface GeminiProductResult {
  pdp_url: string | null;
  image_url: string | null;
}

const GENERIC_STOPWORDS = new Set([
  'beli', 'di', 'pada', 'dan', 'atau', 'or', 'yang', 'untuk', 'ke', 'dari',
  'produk', 'official', 'store', 'original', 'ori', 'jual', 'harga', 'promo',
  'murah', 'diskon', 'terbaru', 'terlaris', 'asli', 'terpercaya', 'bergaransi', 'garansi'
]);

function extractKeyTokens(query: string): string[] {
  return (query || '')
    .toLowerCase()
    .replace(/["'?!,.:;()\\/_-]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2 && !GENERIC_STOPWORDS.has(t));
}

function calculateBrandRelevanceScore(queryTokens: string[], candidateText: string): number {
  if (!candidateText || queryTokens.length === 0) return 0;
  const low = candidateText.toLowerCase();
  let score = 0;
  for (const token of queryTokens) {
    if (low.includes(token)) {
      score += 1;
    }
  }
  return score;
}

export async function resolveProductDetails(
  title: string,
  userProductUrl?: string | null
): Promise<ProductLookupResult> {
  const startTime = Date.now();
  try {
    const cleanTitle = (title || "").trim();
    let cleanUserUrl = (userProductUrl || "").trim();

    if (cleanUserUrl && !cleanUserUrl.startsWith('http://') && !cleanUserUrl.startsWith('https://')) {
      cleanUserUrl = `https://${cleanUserUrl}`;
    }

    const searchQuery = cleanTitle || cleanUserUrl;
    if (!searchQuery) {
      return { product_url: null, image_url: null };
    }

    const fallbackUrl = cleanUserUrl || `https://www.tokopedia.com/find/${encodeURIComponent(cleanTitle || 'produk')}`;
    let selectedUrl: string | null = cleanUserUrl || null;
    let imageUrl: string | null = null;

    // TIER 1: High-Precision Gemini Search Grounding with Multi-Key Failover
    const geminiKeys = getGeminiApiKeys();
    if (geminiKeys.length > 0 && !selectedUrl) {
      // Helper to query Gemini Grounding and extract authentic live PDP links strictly from grounding chunks
      async function searchProductWithGemini(ai: GoogleGenAI, queryText: string): Promise<string | null> {
        try {
          const searchPromise = fetchGeminiSearchResponse(ai, queryText);
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error(`Gemini Product Search for "${queryText}" timed out after 8000ms`)), 8000);
          });

          const response = await Promise.race([searchPromise, timeoutPromise]);
          const candidate = (response as any)?.candidates?.[0];
          const groundingMetadata = candidate?.groundingMetadata;
          const rawChunks: Array<{ web?: { title?: string; uri?: string } }> = groundingMetadata?.groundingChunks || [];

          // STRUCTURAL MATCH, BRAND RELEVANCE & MODIFIER PREFERENCE (TOKOPEDIA FIRST):
          const queryTokens = extractKeyTokens(cleanTitle);
          const queryHasLite = cleanTitle.toLowerCase().includes('lite');
          const queryHasMini = cleanTitle.toLowerCase().includes('mini');

          const validCandidates: Array<{ uri: string; title: string; isTokopedia: boolean; score: number }> = [];
          for (const chunk of rawChunks) {
            const rawUri = chunk.web?.uri;
            if (!rawUri || !isValidRealUrl(rawUri)) continue;

            const unwrapped = await unwrapRedirectUrl(rawUri);
            if (isValidRealUrl(unwrapped) && isPdpUrl(unwrapped)) {
              const isTokopedia = unwrapped.toLowerCase().includes('tokopedia.com');
              const score = calculateBrandRelevanceScore(queryTokens, `${unwrapped} ${chunk.web?.title || ''}`);
              validCandidates.push({ uri: unwrapped, title: chunk.web?.title || '', isTokopedia, score });
            }
          }

          if (validCandidates.length === 0) return null;

          // Disqualify brand hijacking / knock-off candidates if candidates with matching brand tokens exist
          const relevantCandidates = (queryTokens.length > 1 && validCandidates.some(c => c.score > 0))
            ? validCandidates.filter(c => c.score > 0)
            : validCandidates;

          const filterModifier = (candidateList: typeof validCandidates) => {
            // Sort by score DESC, then Tokopedia first
            const sorted = [...candidateList].sort((a, b) => {
              if (b.score !== a.score) return b.score - a.score;
              if (a.isTokopedia && !b.isTokopedia) return -1;
              if (!a.isTokopedia && b.isTokopedia) return 1;
              return 0;
            });

            const exact = sorted.find(c => {
              const low = `${c.uri} ${c.title}`.toLowerCase();
              const hasLite = low.includes('-lite') || low.includes('/lite') || low.includes('_lite') || low.includes(' lite');
              const hasMini = low.includes('-mini') || low.includes('/mini') || low.includes('_mini') || low.includes(' mini');

              if (!queryHasLite && hasLite) return false;
              if (!queryHasMini && hasMini) return false;
              return true;
            });
            return exact?.uri || sorted[0]?.uri || null;
          };

          // 1. Prioritize Tokopedia PDPs first (for native WhatsApp link previews)
          const tokopediaCandidates = relevantCandidates.filter(c => c.isTokopedia);
          if (tokopediaCandidates.length > 0) {
            const chosenTokopedia = filterModifier(tokopediaCandidates);
            if (chosenTokopedia) return chosenTokopedia;
          }

          // 2. Fallback to Shopee PDPs if no valid Tokopedia listing exists
          const shopeeCandidates = relevantCandidates.filter(c => !c.isTokopedia);
          if (shopeeCandidates.length > 0) {
            const chosenShopee = filterModifier(shopeeCandidates);
            if (chosenShopee) return chosenShopee;
          }

          return relevantCandidates[0].uri;

        } catch (err: any) {
          console.warn(`[Product Search] Grounding attempt for "${queryText}" failed:`, err?.message || err);
          throw err;
        }
      }

      try {
        selectedUrl = await executeWithGenAIFailover(async (aiInstance) => {
          return await searchProductWithGemini(aiInstance, cleanTitle || searchQuery);
        });
      } catch (aiErr: any) {
        console.warn(`[Product Search] Stage 1 Gemini Grounding failover error:`, aiErr?.message || aiErr);
      }
    }

    if (selectedUrl) {
      selectedUrl = await unwrapRedirectUrl(selectedUrl);
    }

    // Try HTML OpenGraph extraction if Tier 1 resolved a valid PDP
    if (selectedUrl && isValidRealUrl(selectedUrl) && isPdpUrl(selectedUrl)) {
      imageUrl = await extractOgImageFromUrl(selectedUrl);
    }

    // TIER 2: Dual Marketplace Harvester (If URL or Image is missing)
    if (!selectedUrl || !imageUrl) {
      const harvested = await harvestMarketplaceDetails(cleanTitle);
      if (!selectedUrl && harvested.product_url && isPdpUrl(harvested.product_url)) {
        selectedUrl = harvested.product_url;
      }
      if (!imageUrl && harvested.image_url) {
        imageUrl = harvested.image_url;
      }
    }

    // TIER 3: Fallback Construction
    const finalProductUrl = (selectedUrl && isValidRealUrl(selectedUrl)) ? selectedUrl : fallbackUrl;
    const duration = Date.now() - startTime;

    console.log('[Product Search] Stage 1 Resolved PDP URL:', finalProductUrl);
    console.log('[Product Search] Stage 2 Resolved Image URL:', imageUrl);
    console.log(`[Product Search] Assembly complete in ${duration}ms:`, {
      product_url: finalProductUrl,
      image_url: imageUrl,
    });

    return {
      product_url: finalProductUrl,
      image_url: imageUrl,
    };
  } catch (err: any) {
    const duration = Date.now() - startTime;
    console.error(`[Product Search] Unexpected error (failed in ${duration}ms):`, err?.message || err);
    const fallbackUrl = title ? `https://www.tokopedia.com/find/${encodeURIComponent(title.trim())}` : null;
    return {
      product_url: fallbackUrl,
      image_url: null,
    };
  }
}

async function extractOgImageFromUrl(pdpUrl: string): Promise<string | null> {
  // Never scrape OpenGraph images from generic search/find pages
  if (!pdpUrl || pdpUrl.includes('/find/') || pdpUrl.includes('/search') || pdpUrl.includes('/catalog') || pdpUrl.includes('/jual/')) {
    return null;
  }

  return new Promise((resolve) => {
    try {
      const url = new URL(pdpUrl);
      const isHttps = url.protocol === 'https:';
      const httpLib = isHttps ? require('node:https') : require('node:http');

      const req = httpLib.get(
        {
          hostname: url.hostname,
          path: url.pathname + url.search,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
          },
          timeout: 5000,
        },
        (res: any) => {
          let html = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            html += chunk;
            if (html.length > 500000) {
              req.destroy();
            }
          });
          res.on('end', () => {
            // 1. OpenGraph meta tag
            const ogMatch = html.match(/<meta[^>]*?property=["'](?:og:image|og:image:secure_url)["'][^>]*?content=["']([^"']+)["']/i) ||
              html.match(/<meta[^>]*?content=["']([^"']+)["'][^>]*?property=["'](?:og:image|og:image:secure_url)["']/i);

            if (ogMatch && ogMatch[1]) {
              let clean = ogMatch[1].replace(/&amp;/g, '&').trim();
              if (clean.startsWith('//')) clean = `https:${clean}`;
              if ((clean.startsWith('http://') || clean.startsWith('https://')) && !isInvalidProductImage(clean)) {
                return resolve(clean);
              }
            }

            // 2. Twitter Card image
            const twitterMatch = html.match(/<meta[^>]*?name=["']twitter:image["'][^>]*?content=["']([^"']+)["']/i) ||
              html.match(/<meta[^>]*?content=["']([^"']+)["'][^>]*?name=["']twitter:image["']/i);

            if (twitterMatch && twitterMatch[1]) {
              let clean = twitterMatch[1].replace(/&amp;/g, '&').trim();
              if (clean.startsWith('//')) clean = `https:${clean}`;
              if ((clean.startsWith('http://') || clean.startsWith('https://')) && !isInvalidProductImage(clean)) {
                return resolve(clean);
              }
            }

            // 3. JSON-LD Schema
            const jsonLdMatches = [...html.matchAll(/<script[^>]*?type=["']application\/ld\+json["'][^>]*?>([\s\S]*?)<\/script>/gi)];
            for (const m of jsonLdMatches) {
              try {
                const json = JSON.parse(m[1].trim());
                const extractImg = (obj: any): string | null => {
                  if (!obj) return null;
                  if (typeof obj.image === 'string' && !isInvalidProductImage(obj.image)) return obj.image;
                  if (Array.isArray(obj.image) && typeof obj.image[0] === 'string' && !isInvalidProductImage(obj.image[0])) return obj.image[0];
                  if (typeof obj.image === 'object' && obj.image.url && !isInvalidProductImage(obj.image.url)) return obj.image.url;
                  return null;
                };
                const found = extractImg(json) || (Array.isArray(json) ? json.map(extractImg).find(Boolean) : null);
                if (found) {
                  let clean = found.replace(/&amp;/g, '&').trim();
                  if (clean.startsWith('//')) clean = `https:${clean}`;
                  if ((clean.startsWith('http://') || clean.startsWith('https://')) && !isInvalidProductImage(clean)) {
                    return resolve(clean);
                  }
                }
              } catch {}
            }

            resolve(null);
          });
          res.on('error', () => resolve(null));
        }
      );

      req.on('timeout', () => { req.destroy(); resolve(null); });
      req.on('error', () => resolve(null));
    } catch {
      resolve(null);
    }
  });
}

export interface MarketplaceHarvestResult {
  product_url: string | null;
  image_url: string | null;
}

export async function harvestMarketplaceDetails(rawQuery: string): Promise<MarketplaceHarvestResult> {
  const cleanRaw = (rawQuery || '')
    .replace(/["'?!,.:;()\\/_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleanRaw) return { product_url: null, image_url: null };

  const words = cleanRaw.split(/\s+/);
  const shortQuery = words.length > 5 ? words.slice(0, 5).join(' ') : cleanRaw;

  const allowedDomains = [
    'tokopedia.com',
    'tokopedia.net',
    'images.tokopedia.net',
    'shopee.co.id',
    'shopee.com',
    'susercontent.com',
    'cf.shopee.co.id',
    'pressplay.id',
    'pressplayid.com',
    'mi.com',
    'appmifile.com',
    'salomon.com',
  ];

  const titleLower = shortQuery.toLowerCase();
  const queryTokens = extractKeyTokens(cleanRaw);
  const queryHasLite = titleLower.includes('lite');
  const queryHasMini = titleLower.includes('mini');

  const searchQueries = [
    `${shortQuery} official produk`,
    `${shortQuery} official`,
    `${shortQuery} produk site:tokopedia.com OR site:shopee.co.id`,
    `${shortQuery} site:tokopedia.com OR site:shopee.co.id`,
  ];

  let fallbackImage: string | null = null;
  let fallbackProductUrl: string | null = null;

  for (const q of searchQueries) {
    try {
      const candidates = await queryBingCandidates(q, allowedDomains);
      if (candidates.length === 0) continue;

      // Score candidates by brand/model keyword overlap
      const scoredCandidates = candidates.map(c => {
        const score = calculateBrandRelevanceScore(queryTokens, `${c.purl} ${c.title} ${c.murl}`);
        const isTokopedia = c.purl.toLowerCase().includes('tokopedia.com');
        return { ...c, score, isTokopedia };
      });

      // Filter modifier intent (non-Lite when query lacks "lite")
      const filtered = scoredCandidates.filter(c => {
        const low = `${c.purl} ${c.title}`.toLowerCase();
        const hasLite = low.includes('-lite') || low.includes('/lite') || low.includes('_lite') || low.includes(' lite');
        const hasMini = low.includes('-mini') || low.includes('/mini') || low.includes('_mini') || low.includes(' mini');

        if (!queryHasLite && hasLite) return false;
        if (!queryHasMini && hasMini) return false;
        return true;
      });

      // Prevent brand hijacking in Tier 2:
      // If query has multiple tokens and candidates with matching brand tokens exist, reject 0-score knock-offs
      const validPdpCandidates = filtered.filter(c => c.purl && isPdpUrl(c.purl));
      const brandPdpCandidates = (queryTokens.length > 1 && validPdpCandidates.some(c => c.score > 0))
        ? validPdpCandidates.filter(c => c.score > 0)
        : validPdpCandidates;

      brandPdpCandidates.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (a.isTokopedia && !b.isTokopedia) return -1;
        if (!a.isTokopedia && b.isTokopedia) return 1;
        return 0;
      });

      const tokopediaPdp = brandPdpCandidates.find(c => c.isTokopedia);
      const shopeePdp = brandPdpCandidates.find(c => !c.isTokopedia);

      const chosenPdp = tokopediaPdp || shopeePdp;

      // For image selection, sort all filtered candidates by brand relevance score
      const sortedImageCandidates = [...filtered].sort((a, b) => b.score - a.score);
      const brandImageCandidates = (queryTokens.length > 1 && sortedImageCandidates.some(c => c.score > 0))
        ? sortedImageCandidates.filter(c => c.score > 0)
        : sortedImageCandidates;

      const selectedImage = brandImageCandidates[0] || candidates[0];

      if (selectedImage?.murl && !fallbackImage) {
        fallbackImage = selectedImage.murl;
      }

      if (chosenPdp?.purl && !fallbackProductUrl) {
        fallbackProductUrl = chosenPdp.purl;
        if (chosenPdp.murl) {
          fallbackImage = chosenPdp.murl;
        }
      }

      if (fallbackImage && fallbackProductUrl) {
        return { product_url: fallbackProductUrl, image_url: fallbackImage };
      }
    } catch (err) {
      console.warn('[Product Search] Tier 2 Bing harvesting error:', err);
    }
  }

  return { product_url: fallbackProductUrl, image_url: fallbackImage };
}

export async function fetchProductImage(rawQuery: string): Promise<string | null> {
  const harvested = await harvestMarketplaceDetails(rawQuery);
  return harvested.image_url;
}

async function queryBingCandidates(
  query: string,
  allowedDomains: string[]
): Promise<Array<{ murl: string; purl: string; title: string }>> {
  const url = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&first=1&cc=ID`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
    },
    signal: AbortSignal.timeout(5000),
  });

  if (!res.ok) return [];
  const html = await res.text();

  const matches = [...html.matchAll(/class="iusc"[^>]*?m="([^"]+)"/gi)];
  const results: Array<{ murl: string; purl: string; title: string }> = [];

  for (const match of matches) {
    try {
      const rawJson = match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
      const data = JSON.parse(rawJson);

      const murl: string = data.murl || '';
      const purl: string = data.purl || '';
      const title: string = (data.t || '').toLowerCase();
      const murlLower = murl.toLowerCase();
      const purlLower = purl.toLowerCase();

      if (!murl || !murl.startsWith('http')) continue;

      if (isInvalidProductImage(murl) || isInvalidProductImage(purlLower) || isInvalidProductImage(title)) {
        continue;
      }

      const isFromAllowedDomain = allowedDomains.some(
        domain => purlLower.includes(domain) || murlLower.includes(domain)
      );

      if (isFromAllowedDomain) {
        results.push({ murl, purl, title });
      }
    } catch {
      continue;
    }
  }

  return results;
}

async function fetchGeminiSearchResponse(ai: GoogleGenAI, cleanTitle: string): Promise<any> {
  const prompt = `Find the product listing for ${cleanTitle} on tokopedia.com or shopee.co.id. Return direct product page link.`;

  try {
    console.log('[Product Search] Querying Gemini 2.5-Flash for:', cleanTitle);
    return await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        temperature: 0.1,
        thinkingConfig: {
          thinkingBudget: 0,
        },
      },
    });
  } catch (err: any) {
    if (isRateLimitError(err)) {
      throw err;
    }
    console.warn('[Product Search] Gemini 2.5-Flash grounding error:', err?.message || err);
    throw err;
  }
}




function isPdpUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  const low = trimmed.toLowerCase();

  // Basic exclusion of search / catalog / cart / checkout pages
  if (
    low.includes('/find/') ||
    low.includes('/search') ||
    low.includes('/list/') ||
    low.includes('/cart') ||
    low.includes('/checkout') ||
    low.includes('/account') ||
    low.includes('/login') ||
    low.includes('/register') ||
    low.includes('/jual/') ||
    low.includes('/katalog/') ||
    low.includes('/hot/') ||
    low.includes('/discovery/') ||
    low.includes('/promo/')
  ) {
    return false;
  }

  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname;
    const segments = pathname.split('/').filter(Boolean);

    // STRICTLY TOKOPEDIA & SHOPEE ONLY

    // --- 1. TOKOPEDIA PDP VALIDATION ---
    if (host.includes('tokopedia.com')) {
      if (host.includes('seller.')) return false;

      const nonPdpPrefixes = [
        'find', 'search', 'discovery', 'promo', 'hot', 'p', 'official-store',
        'events', 'blog', 'help', 'login', 'register', 'jual', 'katalog', 'mitra', 'list'
      ];
      if (segments.length === 0) return false;
      if (nonPdpPrefixes.includes(segments[0].toLowerCase())) return false;

      // Tokopedia PDP MUST have at least 2 path segments (/[shop_slug]/[product_slug])
      return segments.length >= 2;
    }

    // --- 2. SHOPEE PDP VALIDATION ---
    if (host.includes('shopee.co.id') || host.includes('shopee.com')) {
      if (host.includes('seller.')) return false;

      const nonPdpPrefixes = [
        'search', 'mall', 'user', 'flash_sale', 'daily_discover', 'cart',
        'buyer', 'events', 'm', 'find', 'jual', 'katalog', 'list', 'help', 'shop', 'order'
      ];
      if (segments.length === 0) return false;
      if (nonPdpPrefixes.includes(segments[0].toLowerCase())) return false;

      // Authentic Shopee PDP item identifier
      if (pathname.includes('-i.')) return true;
      if (segments[0].toLowerCase() === 'product' && segments.length >= 3) return true;

      // Explicitly reject store profile homepages (e.g. /iboxofficial, /tokopedia)
      if (segments.length === 1) return false;

      return segments.length >= 2;
    }
  } catch {
    // If URL parsing fails
  }

  return false;
}





function isWhitelistedEcommerce(title: string, uri: string): boolean {
  const lowTitle = (title || '').toLowerCase();
  const lowUri = (uri || '').toLowerCase();

  const marketplaceKeywords = [
    'tokopedia',
    'shopee',
    'blibli',
    'lazada',
    'pressplay',
    'mi.com',
    'mi.co.id',
    'poco',
    'salomon',
    'apple',
    'samsung',
    'logitech',
    'asus',
    'erigo',
    'eatsambal',
  ];

  if (marketplaceKeywords.some(kw => lowTitle.includes(kw) || lowUri.includes(kw))) {
    return true;
  }

  if (ALLOWED_MARKETPLACE_DOMAINS.some(domain => lowUri.includes(domain))) {
    return true;
  }

  return false;
}

function isValidRealUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) return false;

  if (
    /example\.com|placeholder|fakeurl|dummy-url|test\.com|contoh-toko/i.test(trimmed)
  ) {
    return false;
  }

  return true;
}


async function unwrapRedirectUrl(url: string): Promise<string> {
  if (!url) return url;
  if (url.includes('vertexaisearch.cloud.google.com') || url.includes('grounding-api-redirect')) {
    try {
      const parsed = new URL(url);
      const target =
        parsed.searchParams.get('url') ||
        parsed.searchParams.get('uri') ||
        parsed.searchParams.get('target') ||
        parsed.searchParams.get('dest');
      if (target && (target.startsWith('http://') || target.startsWith('https://'))) {
        return target;
      }
      const res = await fetch(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(800) });
      const location = res.headers.get('location');
      if (location && (location.startsWith('http://') || location.startsWith('https://'))) {
        return location;
      }
    } catch (err) {
      // Ignore redirect unwrap errors
    }
  }
  return url;
}

export interface SavingsDepositAdjustmentParams {
  mode: string;
  targetAmount: number;
  currentAmount: number;
  depositAmount: number;
  targetDate: string;
  dailyTarget?: number;
  accumulatedTimeDebt?: number;
  totalDelayDays?: number;
}

export interface SavingsDepositAdjustmentResult {
  newCurrentAmount: number;
  newTargetDate: string;
  newAccumulatedTimeDebt: number;
  newTotalDelayDays: number;
  addedDebtToday: number;
  shiftedDaysToday: number;
  nextDailyTarget: number;
  remainingDays: number;
  isCompleted: boolean;
  percent: number;
}

/**
 * Calculates deposit adjustments for Relaxed Mode (Fractional Delay) and Disciplined Mode (Dynamic Catch-Up with Safety Shield).
 */
export function calculateSavingsDepositAdjustment(
  params: SavingsDepositAdjustmentParams
): SavingsDepositAdjustmentResult {
  const {
    mode,
    targetAmount,
    currentAmount,
    depositAmount,
    targetDate,
    dailyTarget,
    accumulatedTimeDebt = 0,
    totalDelayDays = 0,
  } = params;

  const todayWIB = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  const targetTime = new Date(targetDate + 'T00:00:00+07:00').getTime();
  const todayTime = new Date(todayWIB + 'T00:00:00+07:00').getTime();
  const diffMs = targetTime - todayTime;
  const remainingDays = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));

  const initialDailyTarget = Math.ceil(
    dailyTarget && dailyTarget > 0
      ? dailyTarget
      : Math.ceil((targetAmount - currentAmount) / remainingDays)
  );

  const newCurrentAmount = currentAmount + depositAmount;
  const shortfall = initialDailyTarget - depositAmount;

  const normalizedMode = (mode || 'RELAXED').toLowerCase();
  let currentAccumulatedDebt = Number(accumulatedTimeDebt) || 0;
  let currentTotalDelay = Number(totalDelayDays) || 0;

  let addedDebtToday = 0;
  let shiftedDaysToday = 0;
  let nextDailyTarget = initialDailyTarget;

  if (shortfall > 0) {
    if (normalizedMode === 'disciplined') {
      // MODE DISIPLIN: Dynamic Catch-Up
      const remainingDaysAfterToday = Math.max(1, remainingDays - 1);
      const remainingAmount = Math.max(0, targetAmount - newCurrentAmount);
      const newDailyTarget = Math.ceil(remainingAmount / remainingDaysAfterToday);
      const maxAllowedDailyTarget = Math.ceil(initialDailyTarget * 1.5);

      if (newDailyTarget > maxAllowedDailyTarget) {
        // Safety Shield: cap at 1.5x, convert excess to time debt
        const excess = newDailyTarget - maxAllowedDailyTarget;
        addedDebtToday = excess / (initialDailyTarget || 1);
        currentAccumulatedDebt += addedDebtToday;

        if (currentAccumulatedDebt >= 1.0) {
          shiftedDaysToday = Math.floor(currentAccumulatedDebt);
          currentTotalDelay += shiftedDaysToday;
          currentAccumulatedDebt = Number((currentAccumulatedDebt - shiftedDaysToday).toFixed(2));
        }

        nextDailyTarget = maxAllowedDailyTarget;
      } else {
        nextDailyTarget = newDailyTarget;
      }
    } else {
      // MODE SANTAI (default / relaxed): Fractional Delay
      addedDebtToday = shortfall / (initialDailyTarget || 1);
      currentAccumulatedDebt += addedDebtToday;

      if (currentAccumulatedDebt >= 1.0) {
        shiftedDaysToday = Math.floor(currentAccumulatedDebt);
        currentTotalDelay += shiftedDaysToday;
        currentAccumulatedDebt = Number((currentAccumulatedDebt - shiftedDaysToday).toFixed(2));
      }

      nextDailyTarget = initialDailyTarget;
    }
  } else {
    // Setoran >= Target Harian
    if (shortfall < 0 && currentAccumulatedDebt > 0) {
      const extra = depositAmount - initialDailyTarget;
      const debtReduced = extra / (initialDailyTarget || 1);
      currentAccumulatedDebt = Math.max(0, Number((currentAccumulatedDebt - debtReduced).toFixed(2)));
    }
    nextDailyTarget = initialDailyTarget;
  }

  // Calculate new target date if date shifted
  let newTargetDate = targetDate;
  if (shiftedDaysToday > 0) {
    const d = new Date(targetDate + 'T00:00:00+07:00');
    d.setDate(d.getDate() + shiftedDaysToday);
    newTargetDate = d.toISOString().split('T')[0];
  }

  // Recalculate remaining days from updated target date
  const newTargetTime = new Date(newTargetDate + 'T00:00:00+07:00').getTime();
  const updatedRemainingDays = Math.max(0, Math.ceil((newTargetTime - todayTime) / (1000 * 60 * 60 * 24)));

  const percent = targetAmount > 0 ? Math.min(100, Math.round((newCurrentAmount / targetAmount) * 100)) : 100;
  const isCompleted = newCurrentAmount >= targetAmount;

  return {
    newCurrentAmount,
    newTargetDate,
    newAccumulatedTimeDebt: Number(currentAccumulatedDebt.toFixed(2)),
    newTotalDelayDays: currentTotalDelay,
    addedDebtToday: Number(addedDebtToday.toFixed(2)),
    shiftedDaysToday,
    nextDailyTarget,
    remainingDays: updatedRemainingDays,
    isCompleted,
    percent,
  };
}

/**
 * Formats target date prediction & schedule status for WhatsApp notifications.
 */
export function formatWaTargetScheduleStatus(
  targetDateStr: string,
  totalDelayDays: number = 0,
  accumulatedTimeDebt: number = 0
): string {
  const todayWIB = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  const targetTime = new Date(targetDateStr + 'T00:00:00+07:00').getTime();
  const todayTime = new Date(todayWIB + 'T00:00:00+07:00').getTime();
  const diffMs = targetTime - todayTime;
  const remainingDays = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));

  const formattedDate = new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  }).format(new Date(targetDateStr + 'T00:00:00+07:00'));

  let scheduleText = `📅 Estimasi Target: *${formattedDate}* (Sisa ${remainingDays} hari)`;

  if (totalDelayDays > 0 || accumulatedTimeDebt > 0) {
    const delayText = totalDelayDays > 0 ? `+${totalDelayDays} hari mundur` : `0 hari mundur`;
    const debtText = `(Beban pecahan: ${accumulatedTimeDebt.toFixed(1)} hari)`;
    scheduleText += `\n⏳ Status Jadwal: ${delayText} ${debtText}`;
  }

  return scheduleText;
}

export { uploadProductImageToStorage } from './storage-helper';


