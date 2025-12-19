/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Configuration du Serveur Python - SAÉ 3.02
 * ═══════════════════════════════════════════════════════════════════════════════
 * * Ce fichier centralise les URLs et paramètres pour communiquer avec le
 * serveur Python (FastAPI + UDP) qui sert de middleware obligatoire.
 */

// On force l'URL de ton Space Hugging Face pour être sûr que ça marche partout
export const SERVER_BASE_URL = 'https://benji4565-projet-sae.hf.space';

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
 * Fallback: si /health échoue, on teste la racine /
 */
export async function checkServerHealth(): Promise<boolean> {
  // Essayer /health d'abord
  try {
    const response = await fetch(`${SERVER_CONFIG.BASE_URL}${SERVER_CONFIG.ENDPOINTS.HEALTH}`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) return true;
  } catch {
    // Continuer avec le fallback
  }
  
  // Fallback: tester la racine /
  try {
    const response = await fetch(`${SERVER_CONFIG.BASE_URL}/`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    // Même une 404 de FastAPI prouve que le serveur répond
    return response.status < 500;
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
