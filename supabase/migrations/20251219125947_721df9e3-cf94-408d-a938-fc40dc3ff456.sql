-- Function to create a conversation and add members (bypasses RLS)
CREATE OR REPLACE FUNCTION public.create_conversation_with_members(
  member_ids UUID[],
  conversation_name TEXT DEFAULT NULL,
  is_group_chat BOOLEAN DEFAULT FALSE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_conversation_id UUID;
  member_id UUID;
BEGIN
  -- Validate member count for groups (max 50)
  IF array_length(member_ids, 1) > 50 THEN
    RAISE EXCEPTION 'Groups cannot have more than 50 members';
  END IF;

  -- Create the conversation
  INSERT INTO conversations (name, is_group, created_at)
  VALUES (conversation_name, is_group_chat, now())
  RETURNING id INTO new_conversation_id;

  -- Add the creator as a member
  INSERT INTO conversation_members (conversation_id, user_id)
  VALUES (new_conversation_id, auth.uid());

  -- Add all other members
  FOREACH member_id IN ARRAY member_ids
  LOOP
    IF member_id != auth.uid() THEN
      INSERT INTO conversation_members (conversation_id, user_id)
      VALUES (new_conversation_id, member_id);
    END IF;
  END LOOP;

  RETURN new_conversation_id;
END;
$$;

-- Enable realtime for friends table
ALTER TABLE public.friends REPLICA IDENTITY FULL;