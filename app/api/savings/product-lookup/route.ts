import { NextRequest, NextResponse } from 'next/server';
import { resolveProductDetails } from '@/lib/product-search';
import { uploadProductImageToStorage } from '@/lib/storage-helper';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { title?: string; product_url?: string; goal_id?: string };
    const { title, product_url, goal_id } = body || {};

    const result = await resolveProductDetails(title || '', product_url || '');

    let permanentImageUrl = result.image_url;
    if (permanentImageUrl) {
      permanentImageUrl = await uploadProductImageToStorage(
        permanentImageUrl,
        goal_id || title || 'product'
      );
    }

    return NextResponse.json({
      success: true,
      product_url: result.product_url,
      image_url: permanentImageUrl,
    });
  } catch (error: any) {
    console.error('Error resolving product details:', error);
    return NextResponse.json({
      success: false,
      product_url: null,
      image_url: null,
    });
  }
}

