# 📡 SAÉ 3.02 - Application Communicante Client/Serveur

## Architecture Technique de la Messagerie Instantanée

---

## 📋 Sommaire

1. [Contexte](#contexte)
2. [Objectifs](#objectifs)
3. [Architecture Globale](#architecture-globale)
4. [Protocoles Implémentés](#protocoles-implémentés)
5. [Flux de Données](#flux-de-données)
6. [Sécurité](#sécurité)
7. [Déploiement](#déploiement)
8. [Guide d'Installation](#guide-dinstallation)

---

## 📚 Contexte

Cette application a été développée dans le cadre de la **SAÉ 3.02** du BUT Réseaux & Télécoms. L'objectif principal est de démontrer la maîtrise des concepts de programmation réseau à travers une application de messagerie instantanée fonctionnelle.

### Contraintes Académiques

| Contrainte | Solution Implémentée |
|------------|---------------------|
| Architecture Client/Serveur obligatoire | Backend Python (FastAPI) comme middleware |
| Protocole TCP | API REST sur le port 7860 |
| Protocole UDP | Socket heartbeat sur le port 5005 |
| Manipulation de flux réseaux | Upload d'images par chunks |
| Sécurité des données | Chiffrement Fernet (AES-128) |

---

## 🎯 Objectifs

### Objectifs Techniques

1. **Valider la compétence "Programmation Socket"** : Implémentation d'un serveur UDP pour la gestion de présence
2. **Valider la compétence "Protocoles Applicatifs"** : API REST sur TCP/HTTP
3. **Valider la compétence "Sécurité"** : Chiffrement des messages
4. **Valider la compétence "Flux Réseaux"** : Transmission d'images par chunks

### Objectifs Fonctionnels

- Messagerie instantanée en temps réel
- Gestion de groupes (max 50 membres)
- Partage d'images
- Indicateur de présence en ligne

---

## 🏗️ Architecture Globale

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              ARCHITECTURE SAÉ 3.02                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────┐         ┌─────────────────┐         ┌───────────────┐ │
│  │                 │  HTTP   │                 │   SQL   │               │ │
│  │  CLIENT REACT   │◄───────►│  SERVEUR PYTHON │◄───────►│   SUPABASE    │ │
│  │  (TypeScript)   │  :7860  │  (FastAPI)      │         │  (PostgreSQL) │ │
│  │                 │         │                 │         │               │ │
│  └────────┬────────┘         └────────┬────────┘         └───────────────┘ │
│           │                           │                                     │
│           │  WebSocket                │  UDP :5005                          │
│           │  (Heartbeat)              │  (Heartbeat interne)                │
│           │                           │                                     │
│           └───────────────────────────┘                                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Composants

| Composant | Technologie | Rôle |
|-----------|-------------|------|
| **Client** | React + TypeScript | Interface utilisateur, envoi de requêtes |
| **Serveur** | Python + FastAPI | Middleware obligatoire, chiffrement, validation |
| **Base de données** | Supabase (PostgreSQL) | Stockage persistant, temps réel |
| **Stockage fichiers** | Supabase Storage | Hébergement des images |

---

## 📡 Protocoles Implémentés

### 1. Protocole TCP/HTTP (Port 7860)

Le serveur FastAPI expose une API REST pour toutes les opérations critiques.

#### Endpoints

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| `POST` | `/api/send_message` | Envoi d'un message (chiffré) |
| `POST` | `/api/upload_chunk` | Réception d'un chunk d'image |
| `GET` | `/api/presence` | Liste des utilisateurs en ligne |
| `POST` | `/api/heartbeat` | Heartbeat HTTP (fallback) |
| `POST` | `/api/report` | Signalement d'un message |
| `GET` | `/health` | Health check |

#### Exemple de Requête

```bash
curl -X POST http://localhost:7860/api/send_message \
  -H "Content-Type: application/json" \
  -d '{
    "conversation_id": "uuid-conversation",
    "sender_id": "uuid-user",
    "content": "Hello World!",
    "encrypt": true
  }'
```

### 2. Protocole UDP (Port 5005)

Un thread dédié écoute les paquets UDP pour la gestion de présence.

#### Format des Paquets

```
USER_ID:STATUS

Exemples:
- "abc123-uuid:ONLINE"
- "def456-uuid:AWAY"
- "ghi789-uuid:OFFLINE"
```

#### Flux UDP

```
┌──────────┐                    ┌──────────────┐
│  Client  │  ────UDP:5005────► │   Serveur    │
│  (App)   │  "USER:ONLINE"     │   Python     │
└──────────┘                    └──────┬───────┘
                                       │
                                       ▼
                              ┌────────────────┐
                              │  Mise à jour   │
                              │  table profiles │
                              └────────────────┘
```

### 3. WebSocket (Fallback navigateur)

Les navigateurs ne supportant pas UDP natif, un endpoint WebSocket fait office de bridge.

```
ws://localhost:7860/ws/heartbeat
```

---

## 🔄 Flux de Données

### Envoi d'un Message Texte

```
1. Utilisateur tape "Bonjour !" ──► React (useMessages.ts)
                                         │
2. fetch('/api/send_message') ◄──────────┘
         │
         ▼
3. Serveur Python reçoit le JSON
         │
4. Chiffrement Fernet ──► "gAAAAABl..."
         │
5. INSERT INTO messages ──► Supabase
         │
6. Supabase Realtime ──► Broadcast
         │
7. Tous les clients reçoivent le message
```

### Upload d'une Image (Chunks)

```
1. Utilisateur sélectionne image (2MB)
         │
2. React découpe en chunks de 64KB ──► 32 chunks
         │
3. Pour chaque chunk:
   │
   ├─► POST /api/upload_chunk (chunk 1/32)
   ├─► POST /api/upload_chunk (chunk 2/32)
   ├─► ...
   └─► POST /api/upload_chunk (chunk 32/32)
         │
4. Serveur Python réassemble les chunks
         │
5. Upload vers Supabase Storage
         │
6. Retourne l'URL publique
```

### Gestion de Présence (Heartbeat)

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   Client                    Serveur                   BDD       │
│     │                          │                        │       │
│     │──WebSocket Connect──────►│                        │       │
│     │                          │                        │       │
│     │──{"user":"abc", ────────►│                        │       │
│     │   "status":"online"}     │                        │       │
│     │                          │──UPDATE profiles──────►│       │
│     │                          │                        │       │
│     │      (30 secondes)       │                        │       │
│     │                          │                        │       │
│     │──{"user":"abc", ────────►│                        │       │
│     │   "status":"online"}     │                        │       │
│     │                          │──UPDATE profiles──────►│       │
│     │                          │                        │       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔐 Sécurité

### Chiffrement des Messages

L'application utilise **Fernet** (basé sur AES-128-CBC) pour chiffrer les messages avant stockage.

```python
from cryptography.fernet import Fernet

# Génération de clé
key = Fernet.generate_key()
fernet = Fernet(key)

# Chiffrement
encrypted = fernet.encrypt(b"Message secret")

# Déchiffrement
decrypted = fernet.decrypt(encrypted)
```

### Row Level Security (RLS)

Supabase applique des politiques RLS pour contrôler l'accès aux données :

| Table | Politique |
|-------|-----------|
| `messages` | Lecture/écriture limitée aux membres de la conversation |
| `conversations` | Accès limité aux participants |
| `profiles` | Lecture publique, écriture par propriétaire |

### SERVICE_ROLE_KEY

Le serveur Python utilise la clé `SERVICE_ROLE_KEY` pour bypasser les RLS et insérer les messages. Cette clé n'est jamais exposée au client.

---

## 🚀 Déploiement

### Développement Local

```bash
# Terminal 1 - Serveur Python
cd /chemin/vers/projet
pip install -r requirements.txt
python server.py

# Terminal 2 - Client React
npm run dev
```

### Production (Hugging Face Spaces)

1. Créer un Space sur [huggingface.co](https://huggingface.co/spaces)
2. Choisir "Docker" ou "Gradio" comme SDK
3. Uploader `server.py` et `requirements.txt`
4. Configurer les secrets :
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `ENCRYPTION_KEY`

---

## 📦 Guide d'Installation

### Prérequis

- Python 3.10+
- Node.js 18+
- Compte Supabase

### Étapes

#### 1. Cloner le projet

```bash
git clone <url-du-repo>
cd projet-sae302
```

#### 2. Installer les dépendances Python

```bash
pip install -r requirements.txt
```

#### 3. Configurer les variables d'environnement

Créer un fichier `.env` :

```env
SUPABASE_URL=https://votre-projet.supabase.co
SUPABASE_SERVICE_ROLE_KEY=votre-cle-service-role
ENCRYPTION_KEY=votre-cle-fernet-base64
```

#### 4. Lancer le serveur Python

```bash
python server.py
```

Sortie attendue :
```
🚀 Serveur SAÉ 3.02 démarré
   📡 API HTTP/TCP: http://0.0.0.0:7860
   📶 UDP Heartbeat: port 5005
   🔐 Chiffrement: Activé (Fernet/AES-128)
```

#### 5. Lancer le client React

```bash
npm install
npm run dev
```

---

## 📊 Métriques de Performance

| Métrique | Valeur |
|----------|--------|
| Latence moyenne (message) | < 100ms |
| Taille max fichier | 10MB |
| Taille chunk | 64KB |
| Intervalle heartbeat | 30s |
| Timeout inactivité | 2 min |

---

## 🧪 Tests

### Test du serveur

```bash
# Health check
curl http://localhost:7860/health

# Envoi de message
curl -X POST http://localhost:7860/api/send_message \
  -H "Content-Type: application/json" \
  -d '{"conversation_id":"test","sender_id":"test","content":"Hello"}'
```

### Test UDP (avec netcat)

```bash
echo "user123:ONLINE" | nc -u localhost 5005
```

---

## 📝 Auteur

**Étudiant BUT R&T**  
SAÉ 3.02 - Application Communicante Client/Serveur  
Année universitaire 2024-2025

---

## 📄 Licence

Ce projet est réalisé dans un cadre académique. Tous droits réservés.
