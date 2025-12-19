/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Configuration du Serveur Python - SAÉ 3.02
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Ce fichier centralise les URLs et paramètres pour communiquer avec le
 * serveur Python (FastAPI + UDP) qui sert de middleware obligatoire.
 */

// Mode de déploiement
const IS_PRODUCTION = import.meta.env.PROD;
const IS_HUGGING_FACE = false; // Mettre à true si déployé sur Hugging Face Spaces

/**
 * URL de base du serveur Python
 * - Développement: localhost:7860
 * - Production: Hugging Face Spaces ou autre hébergeur
 */
export const SERVER_BASE_URL = IS_HUGGING_FACE
  ? 'https://TON-ESPACE.hf.space'  // Remplacer par ton URL Hugging Face
  : 'http://localhost:7860';

/**
 * Configuration complète du serveur
 */
export const SERVER_CONFIG = {
  // URL de base
  BASE_URL: SERVER_BASE_URL,
  
  // Endpoints API (TCP/HTTP)
  ENDPOINTS: {
    // Envoi de messages (passage obligatoire)
    SEND_MESSAGE: '/api/send_message',
    
    // Upload d'images par chunks
    UPLOAD_CHUNK: '/api/upload_chunk',
    
    // Récupérer la liste des utilisateurs en ligne
    PRESENCE: '/api/presence',
    
    // Heartbeat HTTP (alternative à UDP)
    HEARTBEAT: '/api/heartbeat',
    
    // Health check
    HEALTH: '/health',
    
    // Signalement de messages
    REPORT: '/api/report',
  },
  
  // WebSocket pour heartbeat (navigateurs ne supportent pas UDP natif)
  WEBSOCKET: {
    HEARTBEAT: '/ws/heartbeat',
  },
  
  // Configuration UDP (pour référence - utilisé côté serveur)
  UDP: {
    PORT: 5005,
    HEARTBEAT_INTERVAL: 30000, // 30 secondes
  },
  
  // Configuration des chunks pour upload d'images
  CHUNKS: {
    SIZE: 64 * 1024, // 64KB par chunk
    MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB max
  },
  
  // Timeouts
  TIMEOUTS: {
    REQUEST: 10000, // 10 secondes
    UPLOAD: 30000,  // 30 secondes pour upload
  },
} as const;

/**
 * Vérifie si le serveur Python est accessible
 */
export async function checkServerHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${SERVER_CONFIG.BASE_URL}${SERVER_CONFIG.ENDPOINTS.HEALTH}`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Construit l'URL complète d'un endpoint
 */
export function getEndpointUrl(endpoint: keyof typeof SERVER_CONFIG.ENDPOINTS): string {
  return `${SERVER_CONFIG.BASE_URL}${SERVER_CONFIG.ENDPOINTS[endpoint]}`;
}

/**
 * Construit l'URL WebSocket
 */
export function getWebSocketUrl(endpoint: keyof typeof SERVER_CONFIG.WEBSOCKET): string {
  const wsBase = SERVER_CONFIG.BASE_URL.replace('http', 'ws');
  return `${wsBase}${SERVER_CONFIG.WEBSOCKET[endpoint]}`;
}
