/**
 * Constantes de chiffrement partagées côté client.
 *
 * Le serveur Python chiffre les messages avec Fernet : les tokens produits
 * sont encodés en base64url et commencent toujours par « gAAAAA » (version
 * 0x80 + timestamp). On centralise ce préfixe pour éviter les incohérences
 * (auparavant : 'gAAAA' à 5 A dans useMessages vs 'gAAAAA' à 6 A ailleurs).
 */
export const ENCRYPTED_PREFIX = 'gAAAAA';

/** Retourne vrai si le contenu ressemble à un token Fernet chiffré. */
export function isLikelyEncrypted(content: string | null | undefined): boolean {
  return typeof content === 'string' && content.startsWith(ENCRYPTED_PREFIX);
}
