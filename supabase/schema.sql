-- Custom Types
CREATE TYPE transaction_status AS ENUM ('APPROVED', 'PENDING_APPROVAL', 'IGNORED');
CREATE TYPE transaction_source AS ENUM ('AUTOMATIC_EMAIL', 'MANUAL_CHAT', 'MANUAL_FORM');
CREATE TYPE transaction_type AS ENUM ('EXPENSE', 'INCOME');

-- 1. Profiles Table (extends auth.users)
CREATE TABLE public.profiles (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    inbound_email_alias TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Categories Table
CREATE TABLE public.categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    type transaction_type NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert Default Categories
INSERT INTO public.categories (name, type) VALUES
('Makanan & Minuman', 'EXPENSE'),
('Transportasi', 'EXPENSE'),
('Barang Digital', 'EXPENSE'),
('Belanja', 'EXPENSE'),
('Tagihan', 'EXPENSE'),
('Lain-lain', 'EXPENSE'),
('Gaji', 'INCOME'),
('Bonus', 'INCOME');

-- 3. User Merchant Rules Table (Adaptive Learning)
CREATE TABLE public.user_merchant_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    merchant_pattern TEXT NOT NULL,
    category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
    keyword TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, merchant_pattern)
);

-- 4. Transactions Table
CREATE TABLE public.transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    amount NUMERIC(15, 2) NOT NULL,
    type transaction_type NOT NULL,
    merchant TEXT NOT NULL,
    category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
    status transaction_status DEFAULT 'PENDING_APPROVAL',
    source transaction_source NOT NULL,
    confidence_score FLOAT DEFAULT 1.0,
    idempotency_key TEXT UNIQUE,
    raw_email_body TEXT,
    notes TEXT,
    transaction_date TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_transactions_user_id ON public.transactions(user_id);
CREATE INDEX idx_transactions_date ON public.transactions(transaction_date);
CREATE INDEX idx_merchant_rules_user ON public.user_merchant_rules(user_id);
CREATE INDEX idx_profiles_email_alias ON public.profiles(inbound_email_alias);

-- Trigger to automatically create profile on sign up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, inbound_email_alias)
  VALUES (
    new.id,
    new.email,
    REPLACE(new.id::text, '-', '') || '@astiizilaz.resend.app'
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Row Level Security (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_merchant_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- Profiles: Users can only read and update their own profile
CREATE POLICY "Users can view own profile" 
ON public.profiles FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" 
ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Categories: Everyone can view categories
CREATE POLICY "Categories are viewable by everyone" 
ON public.categories FOR SELECT USING (true);

-- User Merchant Rules: Users can manage their own rules
CREATE POLICY "Users can view own rules" 
ON public.user_merchant_rules FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own rules" 
ON public.user_merchant_rules FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own rules" 
ON public.user_merchant_rules FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own rules" 
ON public.user_merchant_rules FOR DELETE USING (auth.uid() = user_id);

-- Transactions: Users can manage their own transactions
CREATE POLICY "Users can view own transactions" 
ON public.transactions FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own transactions" 
ON public.transactions FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own transactions" 
ON public.transactions FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own transactions" 
ON public.transactions FOR DELETE USING (auth.uid() = user_id);

-- 5. Chat Sessions Table
CREATE TABLE public.chat_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT 'Percakapan Baru',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Chat Messages Table
CREATE TABLE public.chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    action_draft_id TEXT,
    draft_data JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for Chat
CREATE INDEX idx_chat_sessions_user_id ON public.chat_sessions(user_id);
CREATE INDEX idx_chat_messages_session_id ON public.chat_messages(session_id);
CREATE INDEX idx_chat_messages_session_id_created ON public.chat_messages(session_id, created_at ASC);

-- RLS for Chat
ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own chat sessions" 
ON public.chat_sessions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own chat sessions" 
ON public.chat_sessions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own chat sessions" 
ON public.chat_sessions FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own chat sessions" 
ON public.chat_sessions FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view own chat messages" 
ON public.chat_messages FOR SELECT USING (EXISTS (SELECT 1 FROM public.chat_sessions WHERE id = chat_messages.session_id AND user_id = auth.uid()));
CREATE POLICY "Users can insert own chat messages" 
ON public.chat_messages FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.chat_sessions WHERE id = chat_messages.session_id AND user_id = auth.uid()));
