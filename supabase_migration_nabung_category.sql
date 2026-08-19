-- Migration: Add System-Only "Nabung" Category
-- Instructions: Run this script in the Supabase SQL Editor

INSERT INTO public.categories (name, type, icon_name, color_hex, is_system, user_id)
SELECT 'Nabung', 'EXPENSE', 'PiggyBank', '#10b981', TRUE, NULL
WHERE NOT EXISTS (
    SELECT 1 FROM public.categories WHERE name = 'Nabung' AND is_system = TRUE
);
