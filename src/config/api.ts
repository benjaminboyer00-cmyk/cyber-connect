/**
 * Configuration API pour les appels HTTP et WebSocket
 * 
 * Ce fichier centralise la configuration des appels API et WebSocket
 * pour communiquer avec le backend Hugging Face.
 */

// URL de base du backend (peut être surchargée par variable d'environnement)
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "https://benji4565-projet-sae.hf.space";

// Configurer les WebSockets en wss:// pour HTTPS, ws:// pour HTTP
export const WS_BASE_URL = API_BASE_URL
  .replace('http://', 'ws://')
  .replace('https://', 'wss://');

// Configuration axios (si utilisé)
// Note: Le projet utilise actuellement fetch() directement, mais cette config
// peut être utilisée si vous migrez vers axios
export const apiConfig = {
  baseURL: API_BASE_URL,
  timeout: 30000, // 30 secondes pour les uploads
  headers: {
    'Content-Type': 'application/json',
  },
};

// Helper pour construire les URLs WebSocket
export function getWebSocketUrl(path: string): string {
  return `${WS_BASE_URL}${path}`;
}

// Helper pour construire les URLs API
export function getApiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}
