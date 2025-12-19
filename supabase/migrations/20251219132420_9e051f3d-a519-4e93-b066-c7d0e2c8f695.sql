-- Fix INSERT policy for conversation_members to allow RPC function to add members
DROP POLICY IF EXISTS "Users can add members to conversations" ON public.conversation_members;

CREATE POLICY "Users can add members to conversations"
ON public.conversation_members
FOR INSERT
WITH CHECK (
  auth.uid() = user_id 
  OR 
  public.is_conversation_member(conversation_id, auth.uid())
);

-- Add DELETE policy for messages
CREATE POLICY "Users can delete messages in their conversations"
ON public.messages
FOR DELETE
USING (public.is_conversation_member(conversation_id, auth.uid()));

-- Create storage bucket for chat files
INSERT INTO storage.buckets (id, name, public) 
VALUES ('chat-files', 'chat-files', true)
ON CONFLICT (id) DO NOTHING;

-- Policy for uploading files (authenticated users only)
CREATE POLICY "Authenticated users can upload chat files"
ON storage.objects
FOR INSERT
WITH CHECK (bucket_id = 'chat-files' AND auth.role() = 'authenticated');

-- Policy for viewing files (public)
CREATE POLICY "Anyone can view chat files"
ON storage.objects
FOR SELECT
USING (bucket_id = 'chat-files');

-- Policy for deleting own files
CREATE POLICY "Users can delete their own chat files"
ON storage.objects
FOR DELETE
USING (bucket_id = 'chat-files' AND auth.uid()::text = (storage.foldername(name))[1]);