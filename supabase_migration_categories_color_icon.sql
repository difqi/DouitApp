-- Migration: Add missing 'color' and 'icon' columns to categories table
-- This fixes schema cache errors when inserting or selecting UI-specific fields on categories.

ALTER TABLE public.categories 
ADD COLUMN IF NOT EXISTS color VARCHAR(50) DEFAULT '#10B981',
ADD COLUMN IF NOT EXISTS icon VARCHAR(50) DEFAULT 'Folder';

-- Reload PostgREST Schema Cache so the frontend API recognizes the new columns immediately
NOTIFY pgrst, 'reload schema';
