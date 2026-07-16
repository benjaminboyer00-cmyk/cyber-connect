-- ============================================================================
-- Durcissement sécurité — CyberConnect (cf. SECURITY_AUDIT.md)
-- Les blocs ACTIFS sont sûrs à appliquer. Les blocs COMMENTÉS ont un impact
-- fonctionnel (nécessitent une adaptation du frontend) : à activer sciemment.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- M3 — Empêcher un membre non-auteur de modifier autre chose que is_read
-- La policy UPDATE actuelle autorise tout membre à modifier n'importe quel
-- champ de n'importe quel message. Ce trigger limite les non-auteurs au seul
-- passage de is_read (et champs de modération), sans casser le marquage "lu".
-- ----------------------------------------------------------------------------
create or replace function public.enforce_message_update_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- L'auteur du message peut tout modifier.
  if auth.uid() is not null and auth.uid() = old.sender_id then
    return new;
  end if;

  -- Les autres (dont le rôle service pour marquer lu / modération) ne peuvent
  -- PAS altérer le contenu ni l'identité du message.
  if new.content        is distinct from old.content
  or new.image_url      is distinct from old.image_url
  or new.sender_id      is distinct from old.sender_id
  or new.conversation_id is distinct from old.conversation_id
  or new.created_at     is distinct from old.created_at then
    raise exception 'Seul l''auteur peut modifier le contenu de ce message';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_message_update_scope on public.messages;
create trigger trg_enforce_message_update_scope
before update on public.messages
for each row execute function public.enforce_message_update_scope();


-- ----------------------------------------------------------------------------
-- C3 — Rendre le bucket "chat-files" PRIVÉ (images, vocaux, images éphémères)
-- ⚠️ À ACTIVER SEULEMENT après avoir migré le frontend vers des URL signées
--    (supabase.storage.from('chat-files').createSignedUrl(path, 60)) ou un
--    proxy serveur. Sinon les médias déjà affichés via <img src> casseront.
-- ----------------------------------------------------------------------------
-- update storage.buckets set public = false where id = 'chat-files';
-- drop policy if exists "Anyone can view chat files" on storage.objects;
-- -- (Lecture via URL signées générées côté serveur/membre ; l'upload et la
-- --  suppression par propriétaire restent régis par les policies existantes.)


-- ----------------------------------------------------------------------------
-- H1/anonymat — Restreindre la visibilité des profils
-- ⚠️ Impact : casse la recherche d'utilisateurs côté client (searchUsers).
--    À activer en déplaçant la recherche côté serveur (RPC SECURITY DEFINER
--    limitée au strict nécessaire : username exact, pas d'énumération).
-- ----------------------------------------------------------------------------
-- drop policy if exists "Users can view all profiles" on public.profiles;
-- create policy "Users can view self and connections" on public.profiles
-- for select using (
--   auth.uid() = id
--   or exists (select 1 from public.friends f
--              where (f.user_id = auth.uid() and f.friend_id = profiles.id)
--                 or (f.friend_id = auth.uid() and f.user_id = profiles.id))
--   or exists (select 1 from public.conversation_members m1
--              join public.conversation_members m2 on m1.conversation_id = m2.conversation_id
--              where m1.user_id = auth.uid() and m2.user_id = profiles.id)
-- );
