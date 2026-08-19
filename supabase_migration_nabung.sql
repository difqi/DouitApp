-- 1. Create savings_goals table
CREATE TABLE IF NOT EXISTS public.savings_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  target_amount NUMERIC(15, 2) NOT NULL,
  current_amount NUMERIC(15, 2) DEFAULT 0.00,
  daily_target NUMERIC(15, 2) NOT NULL,
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  target_date DATE NOT NULL,
  image_url TEXT,
  storage_type VARCHAR(50) NOT NULL DEFAULT 'GOPAY_MERCHANT', -- 'GOPAY_MERCHANT', 'TUNAI', 'BANK_TRANSFER'
  storage_detail VARCHAR(255), -- Merchant name or account note
  reminder_times TEXT[] DEFAULT ARRAY['08:00'],
  whatsapp_number VARCHAR(30),
  mode VARCHAR(30) DEFAULT 'RELAXED', -- 'RELAXED' (molor jika skip) or 'DISCIPLINED' (nominal naik)
  streak_count INT DEFAULT 0,
  last_deposit_date DATE,
  status VARCHAR(30) DEFAULT 'ACTIVE', -- 'ACTIVE', 'COMPLETED', 'PAUSED'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Alter reminder_time to support multiple time slots (Safe for existing tables)
ALTER TABLE public.savings_goals 
DROP COLUMN IF EXISTS reminder_time,
ADD COLUMN IF NOT EXISTS reminder_times TEXT[] DEFAULT ARRAY['08:00'];

-- 2. Create savings_logs table
CREATE TABLE IF NOT EXISTS public.savings_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id UUID NOT NULL REFERENCES public.savings_goals(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount NUMERIC(15, 2) NOT NULL,
  notes TEXT,
  source_type VARCHAR(50) DEFAULT 'MANUAL', -- 'MANUAL', 'INBOUND_EMAIL', 'WHATSAPP_BOT'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Enable RLS
ALTER TABLE public.savings_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.savings_logs ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies (Prepend DROP POLICY IF EXISTS per idempotent rule)
DROP POLICY IF EXISTS "Users can manage their own savings goals" ON public.savings_goals;
CREATE POLICY "Users can manage their own savings goals"
ON public.savings_goals FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage their own savings logs" ON public.savings_logs;
CREATE POLICY "Users can manage their own savings logs"
ON public.savings_logs FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- 5. Storage Bucket for Goal Images (Public Read)
INSERT INTO storage.buckets (id, name, public) 
VALUES ('savings_images', 'savings_images', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public savings images access" ON storage.objects;
CREATE POLICY "Public savings images access"
ON storage.objects FOR SELECT
USING (bucket_id = 'savings_images');

DROP POLICY IF EXISTS "Users can upload savings images" ON storage.objects;
CREATE POLICY "Users can upload savings images"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'savings_images' AND auth.role() = 'authenticated');
