-- Migration: Update Default System Categories
-- Instructions: Run this script in the Supabase SQL Editor

-- 1. Add "Jasa" (Pengeluaran, Briefcase)
INSERT INTO public.categories (name, type, icon_name, color_hex, is_system, user_id)
SELECT 'Jasa', 'EXPENSE', 'Briefcase', '#8b5cf6', TRUE, NULL
WHERE NOT EXISTS (
    SELECT 1 FROM public.categories WHERE name = 'Jasa' AND is_system = TRUE
);

-- 2. Rename "Gaji" to "Transfer"
UPDATE public.categories
SET name = 'Transfer'
WHERE name = 'Gaji' AND is_system = TRUE;

-- 3. Add "Biaya Admin" (Pengeluaran, Receipt)
INSERT INTO public.categories (name, type, icon_name, color_hex, is_system, user_id)
SELECT 'Biaya Admin', 'EXPENSE', 'Receipt', '#f43f5e', TRUE, NULL
WHERE NOT EXISTS (
    SELECT 1 FROM public.categories WHERE name = 'Biaya Admin' AND is_system = TRUE
);
