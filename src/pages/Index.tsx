import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import { useFriends } from '@/hooks/useFriends';
import { useConversations } from '@/hooks/useConversations';
import { useMessages } from '@/hooks/useMessages';
import { useSignaling } from '@/hooks/useSignaling';
import { useWebRTC } from '@/hooks/useWebRTC';
import { useHeartbeat } from '@/hooks/useHeartbeat';
import { useReactions } from '@/hooks/useReactions';
import { useTheme } from '@/hooks/useTheme';
import { usePinnedMessages } from '@/hooks/usePinnedMessages';
import { useChatBackground } from '@/hooks/useChatBackground';
import { Sidebar } from '@/components/chat/Sidebar';
import { ChatArea } from '@/components/chat/ChatArea';
import { SearchUsersModal } from '@/components/friends/SearchUsersModal';
import { FriendRequestsModal } from '@/components/friends/FriendRequestsModal';
import { NewChatModal } from '@/components/friends/NewChatModal';
import { CreateGroupModal } from '@/components/friends/CreateGroupModal';
import { IncomingCallModal } from '@/components/chat/IncomingCallModal';
import { CallInterface } from '@/components/chat/CallInterface';
import { DiscordBotSettings } from '@/components/settings/DiscordBotSettings';
import { ThemeSettings } from '@/components/settings/ThemeSettings';
import { ProfileSettings } from '@/components/settings/ProfileSettings';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';

export default function Index() {
  const navigate = useNavigate();
  const { user, loading: authLoading, signOut } = useAuth();
  const { profile, updateProfile } = useProfile(user?.id);
  const { friends, pendingRequests, searchUsers, sendFriendRequest, acceptFriendRequest, rejectFriendRequest, removeFriend } = useFriends(user?.id);
  const { conversations, createConversation, createGroupConversation, deleteConversation, refetch: refetchConversations } = useConversations(user?.id);
  
  // Signaling WebSocket
  const signaling = useSignaling(user?.id);
  
  // Heartbeat pour la présence en ligne
  const heartbeat = useHeartbeat(user?.id);
  
  // WebRTC avec signaling passé en paramètre
  const {
    callState,
    callType,
    localStream,
    remoteStream,
    isCaller,
    currentCall,
    callUser,
    acceptCall,
    rejectCall,
    endCall,
  } = useWebRTC(user?.id || null, signaling);

  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [requestsModalOpen, setRequestsModalOpen] = useState(false);
  const [newChatModalOpen, setNewChatModalOpen] = useState(false);
  const [createGroupModalOpen, setCreateGroupModalOpen] = useState(false);
  const [discordBotsModalOpen, setDiscordBotsModalOpen] = useState(false);
  const [themeModalOpen, setThemeModalOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  
  // Réactions
  const { addReaction, getReactionCounts, hasUserReacted } = useReactions(user?.id);
  
  // Messages épinglés
  const { pinMessage, unpinMessage, isMessagePinned } = usePinnedMessages(selectedConversation, user?.id);
  
  // Fond de chat par conversation
  const { background: chatBackground, setConversationBackground, clearBackground } = useChatBackground(selectedConversation, user?.id);
  
  // Thème
  useTheme(); // Initialise le thème au chargement

  const { messages, loading: messagesLoading, sendMessage } = useMessages(selectedConversation, user?.id);

  // Get contact for selected conversation
  const selectedConv = conversations.find(c => c.id === selectedConversation);
  const contact = selectedConv?.members[0] || null;
  
  // Trouver le profil de l'appelant pour afficher son nom
  const getCallerProfile = () => {
    if (callState !== 'ringing' || !currentCall.callerId) return null;
    const friend = friends.find(f => f.profile?.id === currentCall.callerId);
    return friend?.profile || null;
  };
  
  const callerProfile = getCallerProfile();
  
  // Trouver le profil du destinataire actuel de l'appel
  const getRemoteProfile = () => {
    if (callState === 'calling' || callState === 'connected') {
      if (isCaller && currentCall.targetId) {
        const friend = friends.find(f => f.profile?.id === currentCall.targetId);
        return friend?.profile || contact;
      }
      return callerProfile || contact;
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
  const handleStartCall = (targetUserId: string, type: 'audio' | 'video') => {
    callUser(targetUserId, type);
    toast.info(`Appel ${type === 'video' ? 'vidéo' : 'audio'} en cours...`);
  };

  const handleAcceptCall = () => {
    acceptCall();
    toast.success('Appel accepté');
  };

  const handleRejectCall = () => {
    rejectCall();
    toast.info('Appel refusé');
  };

  const handleEndCall = () => {
    endCall(true); // userInitiated = true → envoie call-ended
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
        onUpdateAvatar={async (avatarUrl) => {
          await updateProfile({ avatar_url: avatarUrl });
        }}
        onOpenDiscordBots={() => setDiscordBotsModalOpen(true)}
        onOpenTheme={() => setThemeModalOpen(true)}
        onOpenProfile={() => setProfileModalOpen(true)}
        isMobileOpen={sidebarOpen}
        onCloseMobile={() => setSidebarOpen(false)}
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
        callState={callState}
        signalingConnected={signaling.isConnected}
        onStartCall={handleStartCall}
        onRemoveFriend={async (friendId) => {
          const { error } = await removeFriend(friendId);
          if (!error) {
            setSelectedConversation(null);
            refetchConversations();
          }
        }}
        onReaction={addReaction}
        getReactionCounts={getReactionCounts}
        hasUserReacted={hasUserReacted}
        isMessagePinned={isMessagePinned}
        onPinMessage={pinMessage}
        onUnpinMessage={unpinMessage}
        chatBackground={chatBackground}
        onSetChatBackground={(url) => setConversationBackground(url)}
        onClearChatBackground={clearBackground}
      />

      {/* Modal appel entrant */}
      <IncomingCallModal
        isOpen={callState === 'ringing' && !!currentCall.callerId}
        callerName={callerProfile?.username || currentCall.callerId || 'Utilisateur'}
        callerAvatar={callerProfile?.avatar_url || undefined}
        callType={callType}
        onAccept={handleAcceptCall}
        onReject={handleRejectCall}
      />

      {/* Interface d'appel en cours */}
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

      {/* Modal Discord Bots Global */}
      <AlertDialog open={discordBotsModalOpen} onOpenChange={setDiscordBotsModalOpen}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>🤖 Bots Discord</AlertDialogTitle>
            <AlertDialogDescription>
              Gérez vos webhooks Discord pour recevoir les messages.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <DiscordBotSettings conversationId="global" />
          <AlertDialogFooter>
            <AlertDialogCancel>Fermer</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modal Thème */}
      <AlertDialog open={themeModalOpen} onOpenChange={setThemeModalOpen}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>🎨 Personnalisation</AlertDialogTitle>
            <AlertDialogDescription>
              Personnalisez l'apparence de l'application.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ThemeSettings />
          <AlertDialogFooter>
            <AlertDialogCancel>Fermer</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modal Profil */}
      <AlertDialog open={profileModalOpen} onOpenChange={setProfileModalOpen}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>👤 Mon Profil</AlertDialogTitle>
            <AlertDialogDescription>
              Modifiez vos informations personnelles.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ProfileSettings 
            profile={profile}
            onUpdateProfile={updateProfile}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Fermer</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
