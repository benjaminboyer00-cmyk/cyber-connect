import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import { useFriends } from '@/hooks/useFriends';
import { useConversations } from '@/hooks/useConversations';
import { useMessages } from '@/hooks/useMessages';
import { Sidebar } from '@/components/chat/Sidebar';
import { ChatArea } from '@/components/chat/ChatArea';
import { SearchUsersModal } from '@/components/friends/SearchUsersModal';
import { FriendRequestsModal } from '@/components/friends/FriendRequestsModal';
import { NewChatModal } from '@/components/friends/NewChatModal';
import { CreateGroupModal } from '@/components/friends/CreateGroupModal';
import { toast } from 'sonner';

export default function Index() {
  const navigate = useNavigate();
  const { user, loading: authLoading, signOut } = useAuth();
  const { profile } = useProfile(user?.id);
  const { friends, pendingRequests, searchUsers, sendFriendRequest, acceptFriendRequest, rejectFriendRequest } = useFriends(user?.id);
  const { conversations, createConversation, createGroupConversation, refetch: refetchConversations } = useConversations(user?.id);
  
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [requestsModalOpen, setRequestsModalOpen] = useState(false);
  const [newChatModalOpen, setNewChatModalOpen] = useState(false);
  const [createGroupModalOpen, setCreateGroupModalOpen] = useState(false);

  const { messages, loading: messagesLoading, sendMessage } = useMessages(selectedConversation, user?.id);

  // Get contact for selected conversation
  const selectedConv = conversations.find(c => c.id === selectedConversation);
  const contact = selectedConv?.members[0] || null;

  // Redirect to auth if not logged in
  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [authLoading, user, navigate]);

  // Refetch conversations when friends change
  useEffect(() => {
    if (friends.length > 0) {
      refetchConversations();
    }
  }, [friends.length]);

  const handleSignOut = async () => {
    await signOut();
    toast.success('Déconnexion réussie');
    navigate('/auth');
  };

  const handleNewChat = async (friendId: string) => {
    const conversationId = await createConversation(friendId);
    if (conversationId) {
      setSelectedConversation(conversationId);
    }
  };

  const handleCreateGroup = async (memberIds: string[], name: string) => {
    const conversationId = await createGroupConversation(memberIds, name);
    if (conversationId) {
      setSelectedConversation(conversationId);
    }
    return conversationId;
  };

  const handleSendMessage = async (content: string) => {
    const { error } = await sendMessage(content);
    if (error) {
      toast.error("Erreur lors de l'envoi du message");
    }
  };

  const existingFriendIds = friends.map(f => f.profile?.id).filter(Boolean) as string[];

  if (authLoading) {
    return (
      <div className="dark min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Chargement...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="dark min-h-screen h-screen bg-background flex overflow-hidden">
      <Sidebar
        profile={profile}
        conversations={conversations}
        pendingRequests={pendingRequests}
        selectedConversation={selectedConversation}
        onSelectConversation={setSelectedConversation}
        onSignOut={handleSignOut}
        onSearchUsers={() => setSearchModalOpen(true)}
        onNewChat={() => setNewChatModalOpen(true)}
        onViewRequests={() => setRequestsModalOpen(true)}
        onCreateGroup={() => setCreateGroupModalOpen(true)}
      />
      
      <ChatArea
        contact={contact}
        messages={messages}
        currentUserId={user.id}
        onSendMessage={handleSendMessage}
        loading={messagesLoading}
        isGroup={selectedConv?.is_group || false}
        groupName={selectedConv?.name || ''}
        members={selectedConv?.members || []}
      />

      <SearchUsersModal
        open={searchModalOpen}
        onClose={() => setSearchModalOpen(false)}
        onSearch={searchUsers}
        onSendRequest={sendFriendRequest}
        existingFriendIds={existingFriendIds}
      />

      <FriendRequestsModal
        open={requestsModalOpen}
        onClose={() => setRequestsModalOpen(false)}
        requests={pendingRequests}
        onAccept={acceptFriendRequest}
        onReject={rejectFriendRequest}
      />

      <NewChatModal
        open={newChatModalOpen}
        onClose={() => setNewChatModalOpen(false)}
        friends={friends}
        onSelectFriend={handleNewChat}
      />

      <CreateGroupModal
        open={createGroupModalOpen}
        onClose={() => setCreateGroupModalOpen(false)}
        friends={friends}
        onCreateGroup={handleCreateGroup}
      />
    </div>
  );
}