import { Check, X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import type { FriendWithProfile } from '@/hooks/useFriends';

interface FriendRequestsModalProps {
  open: boolean;
  onClose: () => void;
  requests: FriendWithProfile[];
  onAccept: (requestId: string) => Promise<{ error: Error | null }>;
  onReject: (requestId: string) => Promise<{ error: Error | null }>;
}

export function FriendRequestsModal({ open, onClose, requests, onAccept, onReject }: FriendRequestsModalProps) {
  const handleAccept = async (requestId: string) => {
    const { error } = await onAccept(requestId);
    if (error) {
      toast.error("Erreur lors de l'acceptation");
    } else {
      toast.success('Demande acceptée !');
    }
  };

  const handleReject = async (requestId: string) => {
    const { error } = await onReject(requestId);
    if (error) {
      toast.error('Erreur lors du refus');
    } else {
      toast.success('Demande refusée');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-foreground">Demandes d'amis</DialogTitle>
        </DialogHeader>
        
        <ScrollArea className="max-h-80">
          <div className="space-y-2">
            {requests.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                Aucune demande en attente
              </p>
            ) : (
              requests.map((request) => (
                <div
                  key={request.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/30"
                >
                  <div className="flex items-center gap-3">
                    <Avatar className="w-10 h-10">
                      <AvatarImage src={request.profile?.avatar_url || ''} />
                      <AvatarFallback className="bg-primary/20 text-primary">
                        {request.profile?.username?.charAt(0).toUpperCase() || '?'}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium text-foreground">{request.profile?.username}</p>
                      <p className="text-xs text-muted-foreground">Demande d'ami</p>
                    </div>
                  </div>
                  
                  <div className="flex gap-2">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => handleAccept(request.id)}
                      className="text-green-500 hover:text-green-400 hover:bg-green-500/10"
                    >
                      <Check className="w-5 h-5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => handleReject(request.id)}
                      className="text-destructive hover:text-destructive/80 hover:bg-destructive/10"
                    >
                      <X className="w-5 h-5" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}