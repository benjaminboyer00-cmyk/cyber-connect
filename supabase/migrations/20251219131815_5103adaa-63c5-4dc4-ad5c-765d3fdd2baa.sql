-- Fix: avoid infinite recursion in conversation_members SELECT policy

-- 1) Create a security definer helper to test membership without triggering RLS recursion
CREATE OR REPLACE FUNCTION public.is_conversation_member(_conversation_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversation_members
    WHERE conversation_id = _conversation_id
      AND user_id = _user_id
  );
$$;

-- 2) Replace the recursive policy with a function-based policy
DROP POLICY IF EXISTS "Users can view members of their conversations" ON public.conversation_members;

CREATE POLICY "Users can view members of their conversations"
ON public.conversation_members
FOR SELECT
USING (public.is_conversation_member(conversation_members.conversation_id, auth.uid()));
