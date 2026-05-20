# Migration Notes — personal expenses

## Status
Supabase CLI not configured locally. Execute the following SQL manually in:
**Supabase Dashboard → SQL Editor**

## SQL to execute

```sql
-- 1. Mise à jour du CHECK constraint sur event_type
DO $$
BEGIN
  ALTER TABLE public.events
    DROP CONSTRAINT IF EXISTS events_event_type_check;
EXCEPTION WHEN others THEN NULL;
END $$;

ALTER TABLE public.events
  ADD CONSTRAINT events_event_type_check
  CHECK (event_type IN ('split', 'budget', 'personal'));

-- 2. Table des plafonds de budget par catégorie (par user)
CREATE TABLE IF NOT EXISTS public.personal_budget_limits (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  category      TEXT NOT NULL,
  monthly_limit NUMERIC(10,2) NOT NULL DEFAULT 0,
  currency      TEXT NOT NULL DEFAULT 'EUR €',
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, category)
);

ALTER TABLE public.personal_budget_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pbl_own" ON public.personal_budget_limits
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 3. Index performance
CREATE INDEX IF NOT EXISTS idx_pbl_user
  ON public.personal_budget_limits(user_id);
```

## v2 — Date de dépense et multi-devises (2026-05-20)

```sql
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS expense_date        DATE,
  ADD COLUMN IF NOT EXISTS original_currency   VARCHAR(10),
  ADD COLUMN IF NOT EXISTS original_amount     DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS exchange_rate       DECIMAL(12,6),
  ADD COLUMN IF NOT EXISTS exchange_rate_date  DATE;
```
