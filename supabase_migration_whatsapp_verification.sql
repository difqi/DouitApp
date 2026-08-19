-- Migration: WhatsApp OTP Verification & Phone Rate Limiting
-- Idempotent SQL script for Supabase

-- 1. Create phone_verifications table for OTP rate limiting & verification tracking
CREATE TABLE IF NOT EXISTS public.phone_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  otp_code TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  is_verified BOOLEAN DEFAULT FALSE,
  attempts_today INT DEFAULT 1,
  last_sent_at TIMESTAMPTZ DEFAULT NOW()
);

-- Idempotent indexes
CREATE INDEX IF NOT EXISTS idx_phone_verif_user_phone ON public.phone_verifications(user_id, phone_number);
CREATE INDEX IF NOT EXISTS idx_phone_verif_user_created ON public.phone_verifications(user_id, created_at);

-- Enable RLS
ALTER TABLE public.phone_verifications ENABLE ROW LEVEL SECURITY;

-- Idempotent RLS Policies
DROP POLICY IF EXISTS "Users can view their own phone verifications" ON public.phone_verifications;
CREATE POLICY "Users can view their own phone verifications"
  ON public.phone_verifications FOR SELECT
  USING (auth.uid() = user_id);

-- 2. Add whatsapp columns to profiles table
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS whatsapp_number TEXT DEFAULT NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_whatsapp_verified BOOLEAN DEFAULT FALSE;
