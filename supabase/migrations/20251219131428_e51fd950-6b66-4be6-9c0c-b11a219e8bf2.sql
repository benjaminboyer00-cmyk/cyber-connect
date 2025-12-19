-- Supprimer l'ancienne politique restrictive
DROP POLICY IF EXISTS "Users can view conversations they are part of" ON conversation_members;

-- Nouvelle politique qui permet de voir tous les membres d'une conversation où on est membre
CREATE POLICY "Users can view members of their conversations" 
ON conversation_members FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM conversation_members cm 
    WHERE cm.conversation_id = conversation_members.conversation_id 
    AND cm.user_id = auth.uid()
  )
);

-- Permettre aux membres de quitter/supprimer leurs liens avec la conversation
CREATE POLICY "Users can leave conversations" 
ON conversation_members FOR DELETE 
USING (auth.uid() = user_id);

-- Permettre aux membres de supprimer une conversation
CREATE POLICY "Users can delete their conversations" 
ON conversations FOR DELETE 
USING (
  EXISTS (
    SELECT 1 FROM conversation_members 
    WHERE conversation_members.conversation_id = conversations.id 
    AND conversation_members.user_id = auth.uid()
  )
);