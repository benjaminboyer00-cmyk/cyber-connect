import { useState, useEffect } from 'react';
import { Bot, Plus, Trash2, ExternalLink, Check, X, Loader2, ArrowUpRight, ArrowDownLeft, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { toast } from 'sonner';

interface DiscordWebhook {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  conversationId?: string;
}

interface DiscordBotSettingsProps {
  conversationId: string;
  onWebhookSend?: (webhookUrl: string, content: string) => Promise<void>;
}

// Stockage local des webhooks
const STORAGE_KEY = 'cyber-connect-discord-webhooks';

function getStoredWebhooks(): DiscordWebhook[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveWebhooks(webhooks: DiscordWebhook[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(webhooks));
}

export function DiscordBotSettings({ conversationId, onWebhookSend }: DiscordBotSettingsProps) {
  const [webhooks, setWebhooks] = useState<DiscordWebhook[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newWebhookName, setNewWebhookName] = useState('');
  const [newWebhookUrl, setNewWebhookUrl] = useState('');
  const [testing, setTesting] = useState<string | null>(null);

  useEffect(() => {
    setWebhooks(getStoredWebhooks());
  }, []);

  const validateWebhookUrl = (url: string): boolean => {
    return url.startsWith('https://discord.com/api/webhooks/') || 
           url.startsWith('https://discordapp.com/api/webhooks/');
  };

  const addWebhook = () => {
    if (!newWebhookName.trim() || !newWebhookUrl.trim()) {
      toast.error('Nom et URL requis');
      return;
    }

    if (!validateWebhookUrl(newWebhookUrl)) {
      toast.error('URL de webhook Discord invalide');
      return;
    }

    const webhook: DiscordWebhook = {
      id: `webhook_${Date.now()}`,
      name: newWebhookName.trim(),
      url: newWebhookUrl.trim(),
      enabled: true,
      conversationId
    };

    const updated = [...webhooks, webhook];
    setWebhooks(updated);
    saveWebhooks(updated);
    
    setNewWebhookName('');
    setNewWebhookUrl('');
    setDialogOpen(false);
    toast.success('Webhook Discord ajouté');
  };

  const removeWebhook = (id: string) => {
    const updated = webhooks.filter(w => w.id !== id);
    setWebhooks(updated);
    saveWebhooks(updated);
    toast.success('Webhook supprimé');
  };

  const toggleWebhook = (id: string) => {
    const updated = webhooks.map(w => 
      w.id === id ? { ...w, enabled: !w.enabled } : w
    );
    setWebhooks(updated);
    saveWebhooks(updated);
  };

  const testWebhook = async (webhook: DiscordWebhook) => {
    setTesting(webhook.id);
    try {
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: `🔔 Test de connexion depuis Cyber-Connect`,
          username: 'Cyber-Connect Bot',
          embeds: [{
            title: 'Connexion réussie !',
            description: `Le webhook "${webhook.name}" est correctement configuré.`,
            color: 0x00ff00,
            timestamp: new Date().toISOString()
          }]
        })
      });

      if (response.ok) {
        toast.success('Test réussi ! Vérifiez votre salon Discord');
      } else {
        toast.error('Échec du test - vérifiez l\'URL');
      }
    } catch (error) {
      toast.error('Erreur de connexion au webhook');
    } finally {
      setTesting(null);
    }
  };

  // Filtrer les webhooks pour cette conversation
  const conversationWebhooks = webhooks.filter(
    w => !w.conversationId || w.conversationId === conversationId
  );

  // URL du endpoint pour recevoir les messages Discord (à configurer dans le bot Discord)
  const getDiscordBotEndpoint = () => {
    const baseUrl = window.location.origin;
    return `${baseUrl}/api/discord-incoming`;
  };

  const copyEndpoint = () => {
    navigator.clipboard.writeText(getDiscordBotEndpoint());
    toast.success('URL copiée !');
  };

  return (
    <div className="space-y-4">
      <Tabs defaultValue="send" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="send" className="text-xs">
            <ArrowUpRight className="w-3 h-3 mr-1" />
            Vers Discord
          </TabsTrigger>
          <TabsTrigger value="receive" className="text-xs">
            <ArrowDownLeft className="w-3 h-3 mr-1" />
            Depuis Discord
          </TabsTrigger>
        </TabsList>

        {/* Tab: Envoyer vers Discord */}
        <TabsContent value="send" className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Envoyer les messages vers un salon Discord
            </p>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <Plus className="w-4 h-4 mr-1" />
                  Ajouter
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Ajouter un Webhook Discord</DialogTitle>
                  <DialogDescription>
                    Les messages seront envoyés vers ce salon Discord.
                  </DialogDescription>
                </DialogHeader>
                
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="webhook-name">Nom du bot</Label>
                    <Input
                      id="webhook-name"
                      placeholder="Mon bot Discord"
                      value={newWebhookName}
                      onChange={(e) => setNewWebhookName(e.target.value)}
                      className="bg-background text-foreground"
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="webhook-url">URL du Webhook</Label>
                    <Input
                      id="webhook-url"
                      placeholder="https://discord.com/api/webhooks/..."
                      value={newWebhookUrl}
                      onChange={(e) => setNewWebhookUrl(e.target.value)}
                      className="bg-background text-foreground"
                    />
                    <p className="text-xs text-muted-foreground">
                      Discord → Paramètres du salon → Intégrations → Webhooks
                    </p>
                  </div>
                </div>
                
                <DialogFooter>
                  <Button variant="outline" onClick={() => setDialogOpen(false)}>
                    Annuler
                  </Button>
                  <Button onClick={addWebhook}>
                    Ajouter
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

      {/* Liste des webhooks */}
          {conversationWebhooks.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Aucun webhook configuré
            </p>
          ) : (
            <div className="space-y-2">
              {conversationWebhooks.map((webhook) => (
                <div 
                  key={webhook.id}
                  className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <Bot className={`w-4 h-4 ${webhook.enabled ? 'text-green-500' : 'text-muted-foreground'}`} />
                    <div>
                      <p className="font-medium text-sm">{webhook.name}</p>
                      <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                        {webhook.url.substring(0, 50)}...
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => testWebhook(webhook)}
                      disabled={testing === webhook.id}
                    >
                      {testing === webhook.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <ExternalLink className="w-4 h-4" />
                      )}
                    </Button>
                    
                    <Switch
                      checked={webhook.enabled}
                      onCheckedChange={() => toggleWebhook(webhook.id)}
                    />
                    
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => removeWebhook(webhook.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Tab: Recevoir depuis Discord */}
        <TabsContent value="receive" className="space-y-4">
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Recevez les messages Discord dans Cyber-Connect
            </p>
            
            <div className="p-4 bg-muted/30 rounded-lg border border-border space-y-3">
              <div className="flex items-center gap-2">
                <Bot className="w-5 h-5 text-primary" />
                <span className="font-medium text-sm">Configuration du Bot Discord</span>
              </div>
              
              <ol className="text-xs text-muted-foreground space-y-2 list-decimal list-inside">
                <li>Créez un bot sur <a href="https://discord.com/developers/applications" target="_blank" rel="noopener" className="text-primary underline">Discord Developer Portal</a></li>
                <li>Invitez le bot sur votre serveur avec les permissions "Lire les messages"</li>
                <li>Configurez votre bot pour envoyer les messages vers l'URL ci-dessous</li>
              </ol>

              <div className="space-y-2">
                <Label className="text-xs">URL Webhook (pour votre bot)</Label>
                <div className="flex gap-2">
                  <Input
                    value={getDiscordBotEndpoint()}
                    readOnly
                    className="text-xs bg-background text-foreground font-mono"
                  />
                  <Button variant="outline" size="sm" onClick={copyEndpoint}>
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              <div className="pt-2 border-t border-border">
                <p className="text-xs text-muted-foreground">
                  💡 <strong>Alternative simple:</strong> Utilisez un bot comme <a href="https://github.com/discordjs/discord.js" target="_blank" rel="noopener" className="text-primary underline">Discord.js</a> ou <a href="https://zapier.com" target="_blank" rel="noopener" className="text-primary underline">Zapier</a> pour relayer les messages.
                </p>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Hook pour envoyer des messages aux webhooks Discord
export function useDiscordWebhooks() {
  const sendToWebhooks = async (message: string, senderName: string) => {
    const webhooks = getStoredWebhooks().filter(w => w.enabled);
    
    for (const webhook of webhooks) {
      try {
        await fetch(webhook.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: message,
            username: `${senderName} (via Cyber-Connect)`,
          })
        });
      } catch (error) {
        console.error('Erreur envoi webhook Discord:', error);
      }
    }
  };

  return { sendToWebhooks };
}
