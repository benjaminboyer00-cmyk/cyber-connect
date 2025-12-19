import { useState } from 'react';
import { Search, UserPlus, Check, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import type { Tables } from '@/integrations/supabase/types';

type Profile = Tables<'profiles'>;

interface SearchUsersModalProps {
  open: boolean;
  onClose: () => void;
  onSearch: (query: string) => Promise<Profile[]>;
  onSendRequest: (userId: string) => Promise<{ error: Error | null }>;
  existingFriendIds: string[];
}

export function SearchUsersModal({ open, onClose, onSearch, onSendRequest, existingFriendIds }: SearchUsersModalProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(false);
  const [sentRequests, setSentRequests] = useState<Set<string>>(new Set());

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    const users = await onSearch(query);
    setResults(users);
    setLoading(false);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const handleSendRequest = async (userId: string) => {
    const { error } = await onSendRequest(userId);
    if (error) {
      toast.error("Erreur lors de l'envoi de la demande");
    } else {
      toast.success('Demande envoyée !');
      setSentRequests(prev => new Set([...prev, userId]));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-foreground">Rechercher des utilisateurs</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Nom d'utilisateur..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyPress={handleKeyPress}
                className="pl-10 bg-muted/50 border-border"
              />
            </div>
            <Button onClick={handleSearch} disabled={loading} className="bg-primary hover:bg-primary/90">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Rechercher'}
            </Button>
          </div>

          <ScrollArea className="max-h-80">
            <div className="space-y-2">
              {results.length === 0 && query && !loading && (
                <p className="text-center text-muted-foreground py-4">
                  Aucun utilisateur trouvé
                </p>
              )}
              
              {results.map((user) => {
                const isFriend = existingFriendIds.includes(user.id);
                const requestSent = sentRequests.has(user.id);
                
                return (
                  <div
                    key={user.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <Avatar className="w-10 h-10">
                        <AvatarImage src={user.avatar_url || ''} />
                        <AvatarFallback className="bg-primary/20 text-primary">
                          {user.username?.charAt(0).toUpperCase() || '?'}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium text-foreground">{user.username}</p>
                        <p className="text-xs text-muted-foreground">
                          {user.status === 'online' ? 'En ligne' : 'Hors ligne'}
                        </p>
                      </div>
                    </div>
                    
                    {isFriend ? (
                      <span className="text-sm text-muted-foreground flex items-center gap-1">
                        <Check className="w-4 h-4" /> Ami
                      </span>
                    ) : requestSent ? (
                      <span className="text-sm text-muted-foreground">Demande envoyée</span>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => handleSendRequest(user.id)}
                        className="gap-1 bg-primary text-primary-foreground hover:bg-primary/90"
                      >
                        <UserPlus className="w-4 h-4" />
                        Ajouter
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}