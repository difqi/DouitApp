-- 1. Create Categories Table
CREATE TABLE IF NOT EXISTS public.categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE, -- NULL for system defaults
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('EXPENSE', 'INCOME')),
    icon_name TEXT DEFAULT 'Folder', -- Lucide icon component name (e.g. 'ShoppingBag', 'Coffee')
    color_hex TEXT DEFAULT '#64748b', -- Hex code for soft background badge
    is_system BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Note: To make it truly idempotent for an existing table, we add columns if they are missing
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='categories' AND column_name='user_id') THEN
        ALTER TABLE public.categories ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
        ALTER TABLE public.categories ADD COLUMN icon_name TEXT DEFAULT 'Folder';
        ALTER TABLE public.categories ADD COLUMN color_hex TEXT DEFAULT '#64748b';
        ALTER TABLE public.categories ADD COLUMN is_system BOOLEAN DEFAULT TRUE;
        ALTER TABLE public.categories ALTER COLUMN type TYPE TEXT USING type::TEXT;
        ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_type_check;
        ALTER TABLE public.categories ADD CONSTRAINT categories_type_check CHECK (type IN ('EXPENSE', 'INCOME', 'income', 'expense'));
    END IF;
END $$;

-- 2. Indexes & RLS Setup
CREATE INDEX IF NOT EXISTS idx_categories_user ON public.categories(user_id);
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view system and own categories" ON public.categories;
CREATE POLICY "Users can view system and own categories" 
ON public.categories FOR SELECT 
USING (is_system = TRUE OR auth.uid() = user_id OR user_id IS NULL);

DROP POLICY IF EXISTS "Users can insert own categories" ON public.categories;
CREATE POLICY "Users can insert own categories" 
ON public.categories FOR INSERT 
WITH CHECK (auth.uid() = user_id AND is_system = FALSE);

DROP POLICY IF EXISTS "Users can update own categories" ON public.categories;
CREATE POLICY "Users can update own categories" 
ON public.categories FOR UPDATE 
USING (auth.uid() = user_id AND is_system = FALSE);

DROP POLICY IF EXISTS "Users can delete own categories" ON public.categories;
CREATE POLICY "Users can delete own categories" 
ON public.categories FOR DELETE 
USING (auth.uid() = user_id AND is_system = FALSE);
