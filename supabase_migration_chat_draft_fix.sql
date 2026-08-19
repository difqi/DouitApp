-- Migration: Fix action_draft_id type and add draft_data column to chat_messages table
-- Idempotent script safe to run multiple times

-- 1. Drop foreign key constraint on action_draft_id if it exists
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.table_constraints 
        WHERE constraint_name = 'chat_messages_action_draft_id_fkey' 
        AND table_name = 'chat_messages'
    ) THEN
        ALTER TABLE public.chat_messages DROP CONSTRAINT chat_messages_action_draft_id_fkey;
    END IF;
END $$;

-- 2. Alter action_draft_id column type to TEXT if needed
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'chat_messages' 
        AND column_name = 'action_draft_id' 
        AND data_type != 'text'
    ) THEN
        ALTER TABLE public.chat_messages ALTER COLUMN action_draft_id TYPE TEXT USING action_draft_id::TEXT;
    END IF;
END $$;

-- 3. Add draft_data JSONB column if it does not exist
ALTER TABLE public.chat_messages 
ADD COLUMN IF NOT EXISTS draft_data JSONB;

-- 4. Create index for fast loading of chat session messages
CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id_created 
ON public.chat_messages(session_id, created_at ASC);

-- 5. Ensure RLS Policies for chat_messages are idempotent
DROP POLICY IF EXISTS "Users can view own chat messages" ON public.chat_messages;
CREATE POLICY "Users can view own chat messages" 
ON public.chat_messages FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.chat_sessions WHERE id = chat_messages.session_id AND user_id = auth.uid())
);

DROP POLICY IF EXISTS "Users can insert own chat messages" ON public.chat_messages;
CREATE POLICY "Users can insert own chat messages" 
ON public.chat_messages FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.chat_sessions WHERE id = chat_messages.session_id AND user_id = auth.uid())
);

DROP POLICY IF EXISTS "Users can update own chat messages" ON public.chat_messages;
CREATE POLICY "Users can update own chat messages" 
ON public.chat_messages FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.chat_sessions WHERE id = chat_messages.session_id AND user_id = auth.uid())
);

DROP POLICY IF EXISTS "Users can delete own chat messages" ON public.chat_messages;
CREATE POLICY "Users can delete own chat messages" 
ON public.chat_messages FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.chat_sessions WHERE id = chat_messages.session_id AND user_id = auth.uid())
);
