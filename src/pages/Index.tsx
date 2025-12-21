import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import { useFriends } from '@/hooks/useFriends';
import { useConversations } from '@/hooks/useConversations';
import { useMessages } from '@/hooks/useMessages';
import { useWebRTC } from '@/hooks/useWebRTC';
import { Sidebar } from '@/components/chat/Sidebar';
import { ChatArea } from '@/components/chat/ChatArea';
import { SearchUsersModal } from '@/components/friends/SearchUsersModal';
import { FriendRequestsModal } from '@/components/friends/FriendRequestsModal';
import { NewChatModal } from '@/components/friends/NewChatModal';
import { CreateGroupModal } from '@/components/friends/CreateGroupModal';
import { IncomingCallModal } from '@/components/chat/IncomingCallModal';
import { CallInterface } from '@/components/chat/CallInterface';
import { toast } from 'sonner';

export default function Index() {
  const navigate = useNavigate();
  const { user, loading: authLoading, signOut } = useAuth();
  const { profile } = useProfile(user?.id);
  const { friends, pendingRequests, searchUsers, sendFriendRequest, acceptFriendRequest, rejectFriendRequest } = useFriends(user?.id);
  const { conversations, createConversation, createGroupConversation, deleteConversation, refetch: refetchConversations } = useConversations(user?.id);
  
  // WebRTC au niveau global pour recevoir les appels même sans conversation ouverte
  const {
    callState,
    callType,
    localStream,
    remoteStream,
    incomingCall,
    signalingConnected,
    startCall,
    acceptCall,
    rejectCall,
    endCall,
  } = useWebRTC(user?.id);

  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [requestsModalOpen, setRequestsModalOpen] = useState(false);
  const [newChatModalOpen, setNewChatModalOpen] = useState(false);
  const [createGroupModalOpen, setCreateGroupModalOpen] = useState(false);

  const { messages, loading: messagesLoading, sendMessage } = useMessages(selectedConversation, user?.id);

  // Get contact for selected conversation
  const selectedConv = conversations.find(c => c.id === selectedConversation);
  const contact = selectedConv?.members[0] || null;
  
  // Trouver le profil de l'appelant pour afficher son nom
  const getCallerProfile = () => {
    if (!incomingCall) return null;
    // Chercher dans les amis
    const friend = friends.find(f => f.profile?.id === incomingCall.from);
    return friend?.profile || null;
  };
  
  const callerProfile = getCallerProfile();
  
  // Trouver le profil du destinataire actuel de l'appel
  const getRemoteProfile = () => {
    // Si on est en appel avec quelqu'un, trouver son profil
    if (callState === 'calling' || callState === 'connected') {
      // Le contact de la conversation actuelle ou l'appelant
      return contact || callerProfile;
    }
    return callerProfile;
  };
  
  const remoteProfile = getRemoteProfile();

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

  const handleDeleteConversation = async (conversationId: string) => {
    const success = await deleteConversation(conversationId);
    if (success) {
      if (selectedConversation === conversationId) {
        setSelectedConversation(null);
      }
      toast.success('Conversation supprimée');
    } else {
      toast.error('Erreur lors de la suppression');
    }
  };

  const handleSendMessage = async (content: string, imageUrl?: string) => {
    const { error } = await sendMessage(content, imageUrl);
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

  // Handlers pour les appels
  const handleAcceptCall = () => {
    acceptCall();
    toast.success('Appel accepté');
  };

  const handleRejectCall = () => {
    rejectCall();
    toast.info('Appel refusé');
  };

  const handleEndCall = () => {
    endCall();
    toast.info('Appel terminé');
  };

  return (
    <div className="dark min-h-screen h-screen bg-background flex overflow-hidden">
      <Sidebar
        profile={profile}
        conversations={conversations}
        pendingRequests={pendingRequests}
        selectedConversation={selectedConversation}
        onSelectConversation={setSelectedConversation}
        onDeleteConversation={handleDeleteConversation}
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
        // Props WebRTC passées depuis Index
        callState={callState}
        signalingConnected={signalingConnected}
        onStartCall={startCall}
      />

      {/* Modal appel entrant - au niveau global */}
      <IncomingCallModal
        isOpen={callState === 'receiving' && !!incomingCall}
        callerName={callerProfile?.username || incomingCall?.from || 'Utilisateur'}
        callerAvatar={callerProfile?.avatar_url || undefined}
        callType={incomingCall?.callType || 'audio'}
        onAccept={handleAcceptCall}
        onReject={handleRejectCall}
      />

      {/* Interface d'appel en cours - au niveau global */}
      <CallInterface
        isOpen={callState === 'calling' || callState === 'connected'}
        callType={callType}
        localStream={localStream}
        remoteStream={remoteStream}
        remoteName={remoteProfile?.username || 'Utilisateur'}
        remoteAvatar={remoteProfile?.avatar_url || undefined}
        onEndCall={handleEndCall}
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