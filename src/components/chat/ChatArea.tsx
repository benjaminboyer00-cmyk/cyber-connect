import { useState, useRef, useEffect } from 'react';
import { Send, Image, Phone, Video, MoreVertical, Users, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useFileUpload } from '@/hooks/useFileUpload';
import { toast } from 'sonner';
import type { Tables } from '@/integrations/supabase/types';
import type { MessageWithSender } from '@/hooks/useMessages';

type Profile = Tables<'profiles'>;

interface ChatAreaProps {
  contact: Profile | null;
  messages: MessageWithSender[];
  currentUserId: string | undefined;
  onSendMessage: (content: string, imageUrl?: string) => void;
  loading: boolean;
  isGroup?: boolean;
  groupName?: string;
  members?: Profile[];
}

export function ChatArea({ contact, messages, currentUserId, onSendMessage, loading, isGroup, groupName, members }: ChatAreaProps) {
  const [message, setMessage] = useState('');
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { uploadFile, uploading } = useFileUpload();

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Veuillez sélectionner une image');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error('L\'image ne doit pas dépasser 10 Mo');
      return;
    }

    setSelectedImage(file);
    const reader = new FileReader();
    reader.onloadend = () => {
      setImagePreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const clearImage = () => {
    setSelectedImage(null);
    setImagePreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSend = async () => {
    if (!message.trim() && !selectedImage) return;
    if (!currentUserId) return;

    let imageUrl: string | undefined;

    if (selectedImage) {
      const url = await uploadFile(selectedImage, currentUserId);
      if (url) {
        imageUrl = url;
      } else {
        toast.error('Erreur lors de l\'envoi de l\'image');
        return;
      }
    }

    onSendMessage(message || '', imageUrl);
    setMessage('');
    clearImage();
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatTime = (dateStr: string | null) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  };

  const hasConversation = contact || isGroup;
  
  if (!hasConversation) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <div className="w-24 h-24 mx-auto rounded-full bg-muted/50 flex items-center justify-center">
            <Send className="w-10 h-10 text-muted-foreground" />
          </div>
          <h2 className="text-xl font-semibold text-foreground">Sélectionnez une conversation</h2>
          <p className="text-muted-foreground">Choisissez un ami pour commencer à discuter</p>
        </div>
      </div>
    );
  }

  const displayName = isGroup ? groupName : (contact?.username || 'Utilisateur');
  const displayStatus = isGroup 
    ? `${(members?.length || 0) + 1} membres` 
    : (contact?.status === 'online' ? 'En ligne' : 'Hors ligne');

  return (
    <div className="flex-1 flex flex-col bg-background">
      {/* Header */}
      <div className="h-16 px-6 border-b border-border flex items-center justify-between bg-card/50 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <Avatar className="w-10 h-10">
            {isGroup ? (
              <AvatarFallback className="bg-accent/20 text-accent">
                <Users className="w-5 h-5" />
              </AvatarFallback>
            ) : (
              <>
                <AvatarImage src={contact?.avatar_url || ''} />
                <AvatarFallback className="bg-primary/20 text-primary">
                  {contact?.username?.charAt(0).toUpperCase() || '?'}
                </AvatarFallback>
              </>
            )}
          </Avatar>
          <div>
            <p className="font-semibold text-foreground">{displayName}</p>
            <div className="flex items-center gap-1">
              {!isGroup && (
                <span className={`w-2 h-2 rounded-full ${contact?.status === 'online' ? 'bg-green-500' : 'bg-gray-500'}`} />
              )}
              <span className="text-xs text-muted-foreground">
                {displayStatus}
              </span>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
            <Phone className="w-5 h-5" />
          </Button>
          <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
            <Video className="w-5 h-5" />
          </Button>
          <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
            <MoreVertical className="w-5 h-5" />
          </Button>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-6 scrollbar-thin" ref={scrollRef}>
        <div className="space-y-4 max-w-3xl mx-auto">
          {loading ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">Chargement des messages...</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">Aucun message. Commencez la conversation !</p>
            </div>
          ) : (
            messages.map((msg) => {
              const isOwn = msg.sender_id === currentUserId;
              
              return (
                <div
                  key={msg.id}
                  className={`flex items-end gap-2 ${isOwn ? 'flex-row-reverse' : ''}`}
                >
                  {!isOwn && (
                    <Avatar className="w-8 h-8">
                      <AvatarImage src={msg.sender?.avatar_url || ''} />
                      <AvatarFallback className="text-xs bg-muted">
                        {msg.sender?.username?.charAt(0).toUpperCase() || '?'}
                      </AvatarFallback>
                    </Avatar>
                  )}
                  
                  <div className={`max-w-[70%] ${isOwn ? 'items-end' : 'items-start'}`}>
                    <div
                      className={`px-4 py-2 rounded-2xl ${
                        isOwn
                          ? 'bg-gradient-to-r from-primary to-accent text-primary-foreground rounded-br-md'
                          : 'bg-muted text-foreground rounded-bl-md'
                      }`}
                    >
                      {msg.image_url && (
                        <img 
                          src={msg.image_url} 
                          alt="Image" 
                          className="max-w-full rounded-lg mb-2 cursor-pointer hover:opacity-90 transition-opacity"
                          onClick={() => window.open(msg.image_url!, '_blank')}
                        />
                      )}
                      {msg.content && <p className="text-sm">{msg.content}</p>}
                    </div>
                    <p className={`text-xs text-muted-foreground mt-1 ${isOwn ? 'text-right' : ''}`}>
                      {formatTime(msg.created_at)}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>

      {/* Image Preview */}
      {imagePreview && (
        <div className="px-4 py-2 border-t border-border bg-muted/30">
          <div className="max-w-3xl mx-auto flex items-center gap-2">
            <div className="relative">
              <img 
                src={imagePreview} 
                alt="Preview" 
                className="h-20 w-20 object-cover rounded-lg"
              />
              <Button
                variant="destructive"
                size="icon"
                className="absolute -top-2 -right-2 h-6 w-6"
                onClick={clearImage}
              >
                <X className="w-3 h-3" />
              </Button>
            </div>
            <span className="text-sm text-muted-foreground">{selectedImage?.name}</span>
          </div>
        </div>
      )}

      {/* Input */}
      <div className="p-4 border-t border-border bg-card/50 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImageSelect}
            accept="image/*"
            className="hidden"
          />
          <Button 
            variant="ghost" 
            size="icon" 
            className="text-muted-foreground hover:text-foreground shrink-0"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            <Image className="w-5 h-5" />
          </Button>
          
          <Input
            placeholder="Écrivez un message..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyPress={handleKeyPress}
            className="flex-1 bg-muted/50 border-border focus:border-primary text-foreground placeholder:text-muted-foreground"
            disabled={uploading}
          />
          
          <Button 
            onClick={handleSend}
            disabled={(!message.trim() && !selectedImage) || uploading}
            className="bg-gradient-to-r from-primary to-accent hover:opacity-90 text-primary-foreground shrink-0"
          >
            {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          </Button>
        </div>
      </div>
    </div>
  );
}