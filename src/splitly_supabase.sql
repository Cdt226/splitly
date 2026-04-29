-- ============================================================
-- SPLITLY — Script SQL Supabase
-- À exécuter dans : Supabase Dashboard > SQL Editor > New query
-- ============================================================

-- ─── EXTENSIONS ──────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── TABLE : profiles ────────────────────────────────────────
-- Créée automatiquement à partir de auth.users
CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  full_name   TEXT,
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── TABLE : events ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.events (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         TEXT NOT NULL,
  date         DATE NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'EUR €',
  admin_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ─── TABLE : event_participants ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.event_participants (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id   UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  name       TEXT NOT NULL,  -- nom affiché (peut être un non-utilisateur)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, name)
);

-- ─── TABLE : expenses ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.expenses (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id     UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  category     TEXT NOT NULL,
  sub_category TEXT NOT NULL,
  detail       TEXT NOT NULL,
  qty          NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_price   NUMERIC(10,2) NOT NULL DEFAULT 0,
  paid_by      TEXT NOT NULL,  -- nom du payeur
  included     TEXT[] NOT NULL DEFAULT '{}',  -- noms des participants inclus
  created_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  version      INTEGER NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ─── TABLE : contributions ────────────────────────────────────
-- Un enregistrement par (event, participant) — montant total versé
CREATE TABLE IF NOT EXISTS public.contributions (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id     UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  participant  TEXT NOT NULL,  -- nom du participant
  amount       NUMERIC(10,2) NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, participant)
);

-- ─── TABLE : history ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.history (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id     UUID REFERENCES public.events(id) ON DELETE CASCADE,
  action       TEXT NOT NULL,
  actor_id     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_name   TEXT,
  before_data  JSONB,
  after_data   JSONB,
  invalidated  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ─── TABLE : notifications ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notifications (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  event_id     UUID REFERENCES public.events(id) ON DELETE CASCADE,
  type         TEXT NOT NULL DEFAULT 'info' CHECK (type IN ('info', 'success', 'warning', 'request')),
  message      TEXT NOT NULL,
  is_read      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ─── TABLE : invitations ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invitations (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id     UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  invited_by   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'read' CHECK (role IN ('read', 'edit')),
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, email)
);

-- ─── TABLE : access_requests ─────────────────────────────────
-- Demandes de droits supplémentaires par un invité
CREATE TABLE IF NOT EXISTS public.access_requests (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id     UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  requester_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  requested_role TEXT NOT NULL DEFAULT 'edit',
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ENABLE ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE public.profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contributions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.history           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.access_requests   ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- HELPER FUNCTION : est-ce que l'utilisateur a accès à l'event ?
-- ============================================================
CREATE OR REPLACE FUNCTION public.user_has_event_access(p_event_id UUID, p_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = p_event_id AND e.admin_id = p_user_id
    UNION
    SELECT 1 FROM public.invitations i
    WHERE i.event_id = p_event_id
      AND i.email = (SELECT email FROM public.profiles WHERE id = p_user_id)
      AND i.status = 'accepted'
  );
$$;

CREATE OR REPLACE FUNCTION public.user_can_edit_event(p_event_id UUID, p_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = p_event_id AND e.admin_id = p_user_id
    UNION
    SELECT 1 FROM public.invitations i
    WHERE i.event_id = p_event_id
      AND i.email = (SELECT email FROM public.profiles WHERE id = p_user_id)
      AND i.status = 'accepted'
      AND i.role = 'edit'
  );
$$;

-- ============================================================
-- RLS POLICIES
-- ============================================================

-- profiles : chaque utilisateur voit et modifie son propre profil
CREATE POLICY "profiles_select" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles_insert" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- events : l'admin ou les invités acceptés peuvent lire
CREATE POLICY "events_select" ON public.events FOR SELECT
  USING (public.user_has_event_access(id, auth.uid()));
CREATE POLICY "events_insert" ON public.events FOR INSERT
  WITH CHECK (admin_id = auth.uid());
CREATE POLICY "events_update" ON public.events FOR UPDATE
  USING (admin_id = auth.uid());
CREATE POLICY "events_delete" ON public.events FOR DELETE
  USING (admin_id = auth.uid());

-- event_participants
CREATE POLICY "ep_select" ON public.event_participants FOR SELECT
  USING (public.user_has_event_access(event_id, auth.uid()));
CREATE POLICY "ep_insert" ON public.event_participants FOR INSERT
  WITH CHECK (public.user_can_edit_event(event_id, auth.uid()));
CREATE POLICY "ep_delete" ON public.event_participants FOR DELETE
  USING ((SELECT admin_id FROM public.events WHERE id = event_id) = auth.uid());

-- expenses
CREATE POLICY "expenses_select" ON public.expenses FOR SELECT
  USING (public.user_has_event_access(event_id, auth.uid()));
CREATE POLICY "expenses_insert" ON public.expenses FOR INSERT
  WITH CHECK (public.user_can_edit_event(event_id, auth.uid()));
CREATE POLICY "expenses_update" ON public.expenses FOR UPDATE
  USING (
    -- admin peut tout modifier
    (SELECT admin_id FROM public.events WHERE id = event_id) = auth.uid()
    OR
    -- invité edit peut modifier ses propres charges
    (created_by = auth.uid() AND public.user_can_edit_event(event_id, auth.uid()))
  );
CREATE POLICY "expenses_delete" ON public.expenses FOR DELETE
  USING ((SELECT admin_id FROM public.events WHERE id = event_id) = auth.uid());

-- contributions
CREATE POLICY "contrib_select" ON public.contributions FOR SELECT
  USING (public.user_has_event_access(event_id, auth.uid()));
CREATE POLICY "contrib_upsert" ON public.contributions FOR INSERT
  WITH CHECK ((SELECT admin_id FROM public.events WHERE id = event_id) = auth.uid());
CREATE POLICY "contrib_update" ON public.contributions FOR UPDATE
  USING ((SELECT admin_id FROM public.events WHERE id = event_id) = auth.uid());

-- history
CREATE POLICY "history_select" ON public.history FOR SELECT
  USING (public.user_has_event_access(event_id, auth.uid()));
CREATE POLICY "history_insert" ON public.history FOR INSERT
  WITH CHECK (public.user_can_edit_event(event_id, auth.uid()));
CREATE POLICY "history_update" ON public.history FOR UPDATE
  USING ((SELECT admin_id FROM public.events WHERE id = event_id) = auth.uid());

-- notifications : chaque user voit ses propres notifs
CREATE POLICY "notif_select" ON public.notifications FOR SELECT
  USING (user_id = auth.uid());
CREATE POLICY "notif_insert" ON public.notifications FOR INSERT
  WITH CHECK (TRUE); -- le système peut insérer
CREATE POLICY "notif_update" ON public.notifications FOR UPDATE
  USING (user_id = auth.uid());
CREATE POLICY "notif_delete" ON public.notifications FOR DELETE
  USING (user_id = auth.uid());

-- invitations : admin gère, invités voient les leurs
CREATE POLICY "invit_select" ON public.invitations FOR SELECT
  USING (
    invited_by = auth.uid()
    OR email = (SELECT email FROM public.profiles WHERE id = auth.uid())
  );
CREATE POLICY "invit_insert" ON public.invitations FOR INSERT
  WITH CHECK ((SELECT admin_id FROM public.events WHERE id = event_id) = auth.uid());
CREATE POLICY "invit_update" ON public.invitations FOR UPDATE
  USING (
    invited_by = auth.uid()
    OR email = (SELECT email FROM public.profiles WHERE id = auth.uid())
  );
CREATE POLICY "invit_delete" ON public.invitations FOR DELETE
  USING (invited_by = auth.uid());

-- access_requests
CREATE POLICY "ar_select" ON public.access_requests FOR SELECT
  USING (
    requester_id = auth.uid()
    OR (SELECT admin_id FROM public.events WHERE id = event_id) = auth.uid()
  );
CREATE POLICY "ar_insert" ON public.access_requests FOR INSERT
  WITH CHECK (requester_id = auth.uid());
CREATE POLICY "ar_update" ON public.access_requests FOR UPDATE
  USING ((SELECT admin_id FROM public.events WHERE id = event_id) = auth.uid());

-- ============================================================
-- TRIGGERS : updated_at automatique
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER events_updated_at    BEFORE UPDATE ON public.events    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER expenses_updated_at  BEFORE UPDATE ON public.expenses  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER contrib_updated_at   BEFORE UPDATE ON public.contributions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- TRIGGER : créer un profil automatiquement à l'inscription
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- TRIGGER : boucler un event efface l'historique des modifs
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_event_closed()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'closed' AND OLD.status = 'open' THEN
    DELETE FROM public.history
    WHERE event_id = NEW.id AND invalidated = FALSE;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_event_closed
  AFTER UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.handle_event_closed();

-- ============================================================
-- INDEXES pour les performances
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_expenses_event    ON public.expenses(event_id);
CREATE INDEX IF NOT EXISTS idx_contrib_event     ON public.contributions(event_id);
CREATE INDEX IF NOT EXISTS idx_history_event     ON public.history(event_id);
CREATE INDEX IF NOT EXISTS idx_notif_user        ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_invit_event       ON public.invitations(event_id);
CREATE INDEX IF NOT EXISTS idx_invit_email       ON public.invitations(email);
CREATE INDEX IF NOT EXISTS idx_ep_event          ON public.event_participants(event_id);

-- ============================================================
-- FIN DU SCRIPT
-- Message de confirmation :
SELECT 'SplitLy — Base de données créée avec succès ✓' AS status;
-- ============================================================
