import { Metadata } from 'next';
import { createClient } from '@supabase/supabase-js';
import ClientRedirect from './ClientRedirect';

interface PageProps {
  params: Promise<{ id: string }> | { id: string };
}

async function getGoal(id: string) {
  if (!id) return null;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data: goal } = await supabase
    .from('savings_goals')
    .select('id, title, target_amount, image_url, product_url')
    .eq('id', id)
    .maybeSingle();

  return goal;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const resolvedParams = await Promise.resolve(params);
  const goal = await getGoal(resolvedParams.id);
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://douit.my.id').trim().replace(/\/$/, '');

  if (!goal) {
    return {
      title: 'Target Tabungan Douit AI',
      description: 'Kelola dan wujudkan tabungan impian Anda bersama Douit AI.',
    };
  }

  const targetAmountNum = Number(goal.target_amount || 0);
  const formattedAmount = targetAmountNum.toLocaleString('id-ID');
  const imageUrl = goal.image_url || `${baseUrl}/images/default-target.png`;

  return {
    title: `🎯 ${goal.title}`,
    description: `Kumpulkan Rp ${formattedAmount} bersama Douit AI.`,
    openGraph: {
      title: `🎯 ${goal.title}`,
      description: `Kumpulkan Rp ${formattedAmount} bersama Douit AI.`,
      url: `${baseUrl}/p/${goal.id}`,
      siteName: 'Douit AI',
      images: [
        {
          url: imageUrl,
          width: 800,
          height: 600,
          alt: goal.title,
        },
      ],
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: `🎯 ${goal.title}`,
      description: `Kumpulkan Rp ${formattedAmount} bersama Douit AI.`,
      images: [imageUrl],
    },
  };
}

export default async function ProductRedirectPage({ params }: PageProps) {
  const resolvedParams = await Promise.resolve(params);
  const goal = await getGoal(resolvedParams.id);

  const targetUrl = goal?.product_url || '/nabung';

  return (
    <>
      <head>
        <meta httpEquiv="refresh" content={`0;url=${targetUrl}`} />
      </head>
      <ClientRedirect targetUrl={targetUrl} goalTitle={goal?.title} />
    </>
  );
}
