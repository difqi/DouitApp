import { createClient } from '@supabase/supabase-js';

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

/**
 * Downloads an external image binary (e.g. from Tokopedia, Shopee, or Bing)
 * and uploads it permanently to the Supabase Storage bucket `goal-images`.
 * 
 * Prevents 24-hour expiration of signed CDN URLs (e.g. Tokopedia x-expires tokens).
 *
 * @param rawImageUrl The original image URL (external or storage URL)
 * @param goalId Unique identifier for naming the stored asset
 * @returns Permanent public Supabase Storage URL, or rawImageUrl as fallback
 */
export async function uploadProductImageToStorage(
  rawImageUrl: string,
  goalId: string = 'product'
): Promise<string> {
  try {
    if (!rawImageUrl || typeof rawImageUrl !== 'string') return '';

    const cleanUrl = rawImageUrl.trim();
    if (!cleanUrl) return '';

    // If it's already a Supabase Storage permanent URL in goal-images, return it directly
    if (cleanUrl.includes('/storage/v1/object/public/goal-images/')) {
      return cleanUrl;
    }

    const supabaseAdmin = getSupabaseAdmin();


    // Fetch binary directly with no-referrer and user-agent
    const res = await fetch(cleanUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      },
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      console.warn(`[Storage Helper] Failed to fetch external image binary (HTTP ${res.status}), fallback to raw URL`);
      return cleanUrl;
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length === 0) {
      console.warn('[Storage Helper] Downloaded empty image buffer, fallback to raw URL');
      return cleanUrl;
    }

    const rawContentType = res.headers.get('content-type') || '';
    let contentType = 'image/jpeg';
    let ext = 'jpeg';

    if (rawContentType.includes('png') || cleanUrl.includes('.png')) {
      contentType = 'image/png';
      ext = 'png';
    } else if (rawContentType.includes('webp') || cleanUrl.includes('.webp')) {
      contentType = 'image/webp';
      ext = 'webp';
    } else if (rawContentType.includes('gif') || cleanUrl.includes('.gif')) {
      contentType = 'image/gif';
      ext = 'gif';
    } else if (rawContentType.includes('jpeg') || rawContentType.includes('jpg') || cleanUrl.includes('.jpg') || cleanUrl.includes('.jpeg')) {
      contentType = 'image/jpeg';
      ext = 'jpeg';
    }

    const safeGoalId = goalId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filePath = `goals/${safeGoalId}-${Date.now()}.${ext}`;

    // Upload buffer to Supabase Storage bucket 'goal-images'
    const { data, error } = await supabaseAdmin.storage
      .from('goal-images')
      .upload(filePath, buffer, {
        contentType,
        upsert: true,
      });

    if (error) {
      console.error('[Storage Helper] Supabase storage upload error:', error);
      return cleanUrl;
    }

    // Return permanent public URL
    const { data: publicData } = supabaseAdmin.storage
      .from('goal-images')
      .getPublicUrl(filePath);

    if (publicData?.publicUrl) {
      console.log(`[Storage Helper] Successfully saved permanent image: ${publicData.publicUrl}`);
      return publicData.publicUrl;
    }

    return cleanUrl;
  } catch (err: any) {
    console.error('[Storage Helper] Error in uploadProductImageToStorage:', err?.message || err);
    return rawImageUrl;
  }
}
