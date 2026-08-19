-- Migration to add is_pinned column to chat_sessions table
ALTER TABLE public.chat_sessions 
ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT FALSE;

-- Ensure index for fast query of user's pinned sessions
CREATE INDEX IF NOT EXISTS idx_chat_sessions_pinned 
ON public.chat_sessions(user_id, is_pinned, created_at DESC);
