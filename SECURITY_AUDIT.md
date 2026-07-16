# Audit sécurité, confidentialité & anonymat — CyberConnect

_Réalisé le 2026-07-17. Portée : frontend React, serveur `server_hf.py` (HF Space `benji4565/projet_sae`), base Supabase `xjtbbufhlvtvmlkoisxj`, tiers._

Cotation : 🔴 critique · 🟠 élevé · 🟡 moyen · 🟢 bon / déjà en place.

---

## Synthèse

**Ce qui va bien 🟢**
- **RLS activé** sur toutes les tables cœur (`profiles`, `friends`, `conversations`, `conversation_members`, `messages`) avec des policies basées sur `auth.uid()` et l'appartenance à la conversation → un attaquant muni de la clé anon publique **ne peut pas** lire directement les messages des autres.
- Messages **chiffrés au repos** (Fernet) dans la base.
- Validation des payloads serveur (Pydantic), endpoints de diagnostic **sans fuite de secret**.
- Vérification d'appartenance ajoutée sur `get_messages`/`decrypt_message` (ce chantier).

**Le vrai problème de fond 🔴**
- **Ce n'est PAS du chiffrement de bout en bout.** La clé Fernet vit **sur le serveur**, qui déchiffre pour tout le monde. Donc : l'opérateur du serveur, l'hébergeur (Hugging Face), et quiconque obtient `ENCRYPTION_KEY` ou la `SERVICE_ROLE_KEY` peut lire **tous** les messages en clair. La confidentialité n'est garantie que contre un vol de dump de la base Supabase — pas contre le serveur.

---

## 🔴 Critiques

### C1 — Pas de chiffrement de bout en bout (E2E)
Le serveur détient la clé et déchiffre (`/api/get_messages`, `/api/decrypt_message`). Le « chiffré » ne protège que la colonne `content` en base.
**Impact :** confidentialité nulle vis-à-vis du serveur/hébergeur ; un leak de `ENCRYPTION_KEY` (secret HF) expose tout l'historique.
**Remédiation (roadmap) :**
1. Chiffrer/déchiffrer **côté client** (WebCrypto AES-GCM). Le serveur ne voit que du ciphertext, ne détient plus aucune clé.
2. Clé par conversation, échangée via crypto asymétrique (clé publique par utilisateur stockée en base, clé privée jamais transmise). Modèle type Signal/MLS.
3. Le serveur devient un simple relais chiffré ; supprimer `ENCRYPTION_KEY` et `/api/decrypt_message`.
> C'est un chantier structurant. Tant qu'il n'est pas fait, communiquer honnêtement : « chiffré côté serveur », pas « E2E ».

### C2 — Clé de service Supabase = joyau de la couronne
Le serveur utilise `SUPABASE_SERVICE_ROLE_KEY`, qui **contourne tout le RLS**. Toute compromission du Space HF = accès total lecture/écriture à la base.
**Remédiation :** minimiser la surface (voir C1 pour retirer le déchiffrement) ; ne jamais logguer la clé ; rotation régulière ; restreindre les endpoints serveur.

### C3 — Bucket de stockage `chat-files` PUBLIC
Policy storage : `"Anyone can view chat files" USING (bucket_id = 'chat-files')`. **Toute image, message vocal et « image éphémère » est accessible par URL sans authentification.**
**Impact :** l'« éphémère » est une illusion (le fichier reste servi publiquement) ; fuite de contenu privé à qui connaît/devine l'URL.
**Remédiation :** rendre le bucket privé + servir via **URL signées** à durée courte (`createSignedUrl`) réservées aux membres. Nécessite d'adapter le front (les `<img src>` directs → URL signées). Voir migration fournie.

---

## 🟠 Élevés — confidentialité & anonymat

### H1 — La traduction envoie le texte en clair à Google
`MessageBubble` → `/api/translate` → `deep_translator.GoogleTranslator`. **Le contenu déchiffré du message part chez Google.**
**Remédiation :** retirer, ou rendre explicitement opt-in avec avertissement, ou utiliser un moteur auto-hébergé (LibreTranslate).

### H2 — Fond de conversation = vecteur de désanonymisation
Le fond accepte une **URL d'image arbitraire**, partagée aux deux participants. Un attaquant met une URL vers son serveur : à chaque ouverture, il récupère **IP, user-agent, horaires de présence** de la cible. Idéal pour désanonymiser.
**Remédiation :** n'autoriser que des images hébergées sur le bucket de l'app (upload), ou proxifier/mettre en cache côté serveur. Ne jamais charger d'URL tierce fournie par un autre utilisateur.

### H3 — Fuites de métadonnées vers des tiers (IP + activité)
- **Avatars DiceBear** : `api.dicebear.com/...?seed=<username>` → le pseudo est envoyé à DiceBear, et l'IP à chaque chargement.
- **GIF Giphy** : recherches + IP envoyées à Giphy (clé API en dur dans le bundle).
- **Spotify embeds** : charger un embed révèle à Spotify l'IP et le morceau consulté.
- **Discord webhooks** : relaient le contenu des messages vers Discord.
**Remédiation :** self-host des avatars (générer le SVG côté app), proxifier Giphy, remplacer les embeds Spotify par une simple carte lien, avertir pour Discord.

### H4 — Authentification par email = non anonyme
Supabase Auth stocke email + IP + timestamps de connexion. Le modèle n'est pas anonyme par conception.
**Remédiation (si l'anonymat est un objectif) :** pseudonymes sans email (ex. auth par phrase secrète / clé), ou au minimum ne pas exiger d'email vérifié, et documenter ce que Supabase conserve.

### H5 — CORS permissif sur le serveur
`allow_origins=["*", ...]` avec `allow_credentials=True`. N'importe quelle origine peut appeler les endpoints non authentifiés (upload, report, presence, calls, discord…).
**Remédiation :** liste blanche d'origines explicite (env `ALLOWED_ORIGINS`). _Implémenté dans ce lot (rétro-compatible)._

---

## 🟡 Moyens

### M1 — Serveur Python sans authentification forte
Les endpoints font confiance aux `user_id`/`sender_id` envoyés par le client (pas de JWT vérifié). La vérif d'appartenance ajoutée s'appuie sur un `user_id` non authentifié : un attaquant qui connaît l'UUID d'un membre peut le rejouer.
**Remédiation :** vérifier le **JWT Supabase** côté serveur (`Authorization: Bearer`) et en dériver l'identité, au lieu de faire confiance au corps de requête. Puis activer `STRICT_AUTH=true`.

### M2 — Endpoints mutateurs non authentifiés
`/api/send_message`, `/api/report`, `/api/calls/*`, `/api/chat-background`, `/api/discord-incoming`, `/api/upload_chunk` acceptent des écritures sans vérifier l'identité de l'appelant → spoofing possible (envoyer un message au nom d'un autre `sender_id`, polluer, etc.).
**Remédiation :** idem M1 (JWT) + vérifier que `sender_id == identité authentifiée` et l'appartenance.

### M3 — Policy UPDATE des messages trop large
`"Users can update read status" FOR UPDATE USING (membre)` — **sans `WITH CHECK` ni restriction de colonne**. Un membre peut modifier **n'importe quel champ de n'importe quel message** de la conversation (y compris réécrire le `content` d'un autre).
**Remédiation :** restreindre l'édition de contenu au propriétaire (`sender_id = auth.uid()`) et n'autoriser aux autres que le passage de `is_read` (via trigger ou colonne dédiée). Migration fournie (base).

### M4 — Upload sans validation de type/taille côté serveur robuste
La taille est contrôlée côté client (10 Mo). Vérifier la validation serveur (type MIME réel, taille, nom de fichier) pour éviter le stockage de contenu arbitraire dans un bucket public (cf. C3).

---

## 🟢 Bon / déjà en place
- RLS activé + policies membres sur `messages`, `conversation_members`, `friends`.
- Diagnostic serveur sans fuite de secret.
- Clé **anon** exposée = normal (protégée par RLS).
- Chiffrement au repos.

---

## Plan d'action priorisé

| # | Action | Effort | Qui | Casse ? |
|---|--------|--------|-----|---------|
| 1 | Activer `STRICT_AUTH=true` (après redeploy front) | XS | toi (Space) | non |
| 2 | Vérifier le **JWT Supabase** côté serveur (M1/M2) | M | à faire ensemble | non |
| 3 | Bucket `chat-files` **privé** + URL signées (C3) | M | migration + front | oui (à adapter) |
| 4 | Fond de conv : **interdire les URL tierces** (H2) | S | front | mineur |
| 5 | Traduction **opt-in**/auto-hébergée (H1) | S | front/serveur | non |
| 6 | CORS liste blanche (H5) | XS | _fait_ (env) | non |
| 7 | Policy UPDATE messages restreinte (M3) | S | migration | mineur |
| 8 | Self-host avatars, proxy Giphy, cartes Spotify (H3) | M | front | non |
| 9 | **E2E** côté client (C1) — retire le déchiffrement serveur | L | chantier | archi |

_Migrations et changements de ce lot : voir `supabase/migrations/2026*_security_hardening.sql` et `server_hf.py` (CORS env `ALLOWED_ORIGINS`)._
