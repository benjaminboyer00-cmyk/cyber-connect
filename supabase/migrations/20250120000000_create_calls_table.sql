-- Migration: Création de la table calls pour l'historique des appels
-- Date: 2025-01-20

-- Créer la table calls
CREATE TABLE IF NOT EXISTS public.calls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    caller_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    receiver_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('calling', 'accepted', 'rejected', 'ended', 'missed')),
    call_type TEXT NOT NULL CHECK (call_type IN ('audio', 'video')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    duration_seconds INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Créer des index pour améliorer les performances
CREATE INDEX IF NOT EXISTS idx_calls_caller_id ON public.calls(caller_id);
CREATE INDEX IF NOT EXISTS idx_calls_receiver_id ON public.calls(receiver_id);
CREATE INDEX IF NOT EXISTS idx_calls_status ON public.calls(status);
CREATE INDEX IF NOT EXISTS idx_calls_created_at ON public.calls(created_at DESC);

-- Créer une fonction pour mettre à jour updated_at automatiquement
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Créer le trigger pour updated_at
CREATE TRIGGER update_calls_updated_at
    BEFORE UPDATE ON public.calls
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Activer Realtime pour la table calls
ALTER PUBLICATION supabase_realtime ADD TABLE public.calls;

-- Commentaires pour la documentation
COMMENT ON TABLE public.calls IS 'Table pour stocker l''historique des appels audio/vidéo';
COMMENT ON COLUMN public.calls.status IS 'Statut de l''appel: calling, accepted, rejected, ended, missed';
COMMENT ON COLUMN public.calls.call_type IS 'Type d''appel: audio ou video';
COMMENT ON COLUMN public.calls.duration_seconds IS 'Durée de l''appel en secondes (calculée à la fin)';
