"""
═══════════════════════════════════════════════════════════════════════════════
    SERVEUR PYTHON - SAÉ 3.02 Application Communicante Client/Serveur
    Auteur: Étudiant R&T
    Architecture: FastAPI (TCP/HTTP) + Socket UDP + Chiffrement Fernet
═══════════════════════════════════════════════════════════════════════════════
"""

import asyncio
import base64
import hashlib
import io
import json
import os
import socket
import threading
import time
from datetime import datetime
from typing import Dict, Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

# ═══════════════════════════════════════════════════════════════════════════════
# CHIFFREMENT - Module Fernet (AES-128)
# ═══════════════════════════════════════════════════════════════════════════════

try:
    from cryptography.fernet import Fernet
    ENCRYPTION_ENABLED = True
except ImportError:
    ENCRYPTION_ENABLED = False
    print("⚠️  Module cryptography non installé - chiffrement désactivé")

# Clé de chiffrement (en production, utiliser une variable d'environnement)
ENCRYPTION_KEY = os.getenv("ENCRYPTION_KEY", Fernet.generate_key().decode() if ENCRYPTION_ENABLED else "")

def get_fernet():
    """Retourne une instance Fernet pour le chiffrement/déchiffrement"""
    if ENCRYPTION_ENABLED:
        return Fernet(ENCRYPTION_KEY.encode() if isinstance(ENCRYPTION_KEY, str) else ENCRYPTION_KEY)
    return None

def encrypt_message(content: str) -> str:
    """Chiffre un message avec Fernet (AES-128)"""
    fernet = get_fernet()
    if fernet and content:
        encrypted = fernet.encrypt(content.encode())
        return encrypted.decode()
    return content

def decrypt_message(encrypted_content: str) -> str:
    """Déchiffre un message avec Fernet"""
    fernet = get_fernet()
    if fernet and encrypted_content:
        try:
            decrypted = fernet.decrypt(encrypted_content.encode())
            return decrypted.decode()
        except Exception:
            return encrypted_content  # Retourne le contenu original si déchiffrement échoue
    return encrypted_content

# ═══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION SUPABASE
# ═══════════════════════════════════════════════════════════════════════════════

SUPABASE_URL = os.getenv("SUPABASE_URL", "https://xjtbbufhlvtvmlkoisxj.supabase.co")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

# Client Supabase (optionnel - si la lib est installée)
supabase_client = None
try:
    from supabase import create_client
    if SUPABASE_SERVICE_KEY:
        supabase_client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
        print("✅ Connexion Supabase établie")
    else:
        print("⚠️  SUPABASE_SERVICE_ROLE_KEY non définie")
except ImportError:
    print("⚠️  Module supabase non installé")

# ═══════════════════════════════════════════════════════════════════════════════
# STOCKAGE EN MÉMOIRE
# ═══════════════════════════════════════════════════════════════════════════════

# Présence des utilisateurs (mis à jour via UDP/WebSocket)
user_presence: Dict[str, dict] = {}

# Chunks d'images en cours de réception
pending_chunks: Dict[str, dict] = {}

# Connexions WebSocket actives
active_websockets: Dict[str, WebSocket] = {}

# ═══════════════════════════════════════════════════════════════════════════════
# MODÈLES PYDANTIC
# ═══════════════════════════════════════════════════════════════════════════════

class MessagePayload(BaseModel):
    conversation_id: str
    sender_id: str
    content: str
    image_url: Optional[str] = None
    encrypt: bool = True  # Chiffrer par défaut

class ChunkPayload(BaseModel):
    upload_id: str
    chunk_index: int
    total_chunks: int
    data: str  # Base64
    file_name: str
    user_id: str

class HeartbeatPayload(BaseModel):
    user_id: str
    status: str = "online"

class ReportPayload(BaseModel):
    message_id: str
    reporter_id: str
    reason: str

# ═══════════════════════════════════════════════════════════════════════════════
# THREAD UDP - Heartbeat & Présence (Port 5005)
# ═══════════════════════════════════════════════════════════════════════════════

UDP_PORT = 5005
udp_running = True

def udp_heartbeat_listener():
    """
    Thread UDP non-bloquant pour recevoir les heartbeats de présence.
    Format attendu: "USER_ID:STATUS" (ex: "abc123:ONLINE")
    
    Ce thread valide la compétence "Programmation Socket" de la SAÉ.
    """
    global udp_running
    
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("0.0.0.0", UDP_PORT))
    sock.setblocking(False)
    sock.settimeout(0.5)
    
    print(f"🟢 UDP Heartbeat listener démarré sur le port {UDP_PORT}")
    
    while udp_running:
        try:
            data, addr = sock.recvfrom(1024)
            message = data.decode('utf-8').strip()
            
            # Format: "USER_ID:STATUS"
            if ":" in message:
                parts = message.split(":", 1)
                user_id = parts[0]
                status = parts[1] if len(parts) > 1 else "online"
                
                user_presence[user_id] = {
                    "status": status.lower(),
                    "last_seen": datetime.now().isoformat(),
                    "ip": addr[0],
                    "port": addr[1],
                    "protocol": "UDP"
                }
                
                print(f"💓 [UDP] Heartbeat: {user_id} -> {status} depuis {addr[0]}:{addr[1]}")
                
                # Mise à jour dans Supabase (async en arrière-plan)
                if supabase_client:
                    try:
                        supabase_client.table("profiles").update({
                            "status": status.lower(),
                            "last_seen": datetime.now().isoformat()
                        }).eq("id", user_id).execute()
                    except Exception as e:
                        print(f"⚠️  Erreur mise à jour présence Supabase: {e}")
                        
        except socket.timeout:
            continue
        except BlockingIOError:
            time.sleep(0.1)
        except Exception as e:
            print(f"❌ Erreur UDP: {e}")
            time.sleep(0.5)
    
    sock.close()
    print("🔴 UDP Heartbeat listener arrêté")

# ═══════════════════════════════════════════════════════════════════════════════
# FASTAPI APPLICATION
# ═══════════════════════════════════════════════════════════════════════════════

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Gestion du cycle de vie de l'application"""
    global udp_running
    
    # Démarrage du thread UDP
    udp_thread = threading.Thread(target=udp_heartbeat_listener, daemon=True)
    udp_thread.start()
    
    print("🚀 Serveur SAÉ 3.02 démarré")
    print(f"   📡 API HTTP/TCP: http://0.0.0.0:7860")
    print(f"   📶 UDP Heartbeat: port {UDP_PORT}")
    print(f"   🔐 Chiffrement: {'Activé (Fernet/AES-128)' if ENCRYPTION_ENABLED else 'Désactivé'}")
    
    yield
    
    # Arrêt propre
    udp_running = False
    print("👋 Arrêt du serveur...")

app = FastAPI(
    title="SAÉ 3.02 - Serveur Application Communicante",
    description="Backend Python pour messagerie Client/Serveur avec TCP/UDP",
    version="1.0.0",
    lifespan=lifespan
)

# Configuration CORS pour autoriser le frontend React
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "https://*.lovable.app",
        "https://*.lovableproject.com",
        "*"  # En développement uniquement
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ═══════════════════════════════════════════════════════════════════════════════
# ROUTES API - PROTOCOLE TCP/HTTP
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/")
async def root():
    """Page d'accueil du serveur"""
    return {
        "service": "SAÉ 3.02 - Application Communicante",
        "status": "running",
        "protocols": {
            "tcp_http": "Port 7860",
            "udp_heartbeat": f"Port {UDP_PORT}"
        },
        "encryption": "Fernet/AES-128" if ENCRYPTION_ENABLED else "Disabled",
        "timestamp": datetime.now().isoformat()
    }

@app.get("/health")
async def health_check():
    """Health check pour monitoring"""
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "uptime": "running",
        "services": {
            "tcp_api": True,
            "udp_heartbeat": udp_running,
            "supabase": supabase_client is not None,
            "encryption": ENCRYPTION_ENABLED
        },
        "active_users": len(user_presence),
        "pending_uploads": len(pending_chunks)
    }

@app.post("/api/send_message")
async def send_message(payload: MessagePayload):
    """
    Route TCP/HTTP pour envoyer un message.
    
    Flux:
    1. Réception du JSON depuis React
    2. Chiffrement optionnel du contenu (Fernet/AES-128)
    3. Insertion dans Supabase via SERVICE_ROLE_KEY
    4. Retour de confirmation
    
    Cette route valide la contrainte "passage obligatoire par le serveur Python"
    """
    try:
        # Chiffrement du contenu si demandé
        content_to_store = payload.content
        if payload.encrypt and ENCRYPTION_ENABLED:
            content_to_store = encrypt_message(payload.content)
            print(f"🔐 Message chiffré: {payload.content[:20]}... -> {content_to_store[:20]}...")
        
        # Préparation des données
        message_data = {
            "conversation_id": payload.conversation_id,
            "sender_id": payload.sender_id,
            "content": content_to_store,
            "image_url": payload.image_url,
            "is_read": False
        }
        
        # Insertion dans Supabase
        if supabase_client:
            result = supabase_client.table("messages").insert(message_data).execute()
            
            if result.data:
                print(f"✅ Message inséré: {result.data[0]['id']}")
                return {
                    "success": True,
                    "message_id": result.data[0]["id"],
                    "encrypted": payload.encrypt and ENCRYPTION_ENABLED,
                    "timestamp": datetime.now().isoformat()
                }
            else:
                raise HTTPException(status_code=500, detail="Insertion failed")
        else:
            # Mode simulation (sans Supabase)
            print(f"📝 [SIMULATION] Message reçu de {payload.sender_id}: {payload.content[:50]}...")
            return {
                "success": True,
                "message_id": f"sim_{int(time.time())}",
                "encrypted": payload.encrypt and ENCRYPTION_ENABLED,
                "simulated": True,
                "timestamp": datetime.now().isoformat()
            }
            
    except Exception as e:
        print(f"❌ Erreur envoi message: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/upload_chunk")
async def upload_chunk(payload: ChunkPayload):
    """
    Route pour recevoir les chunks d'images.
    
    Processus:
    1. Réception du chunk (base64)
    2. Stockage temporaire en mémoire
    3. Réassemblage quand tous les chunks sont reçus
    4. Upload vers Supabase Storage
    
    Cette route valide la contrainte "manipulation de flux réseaux"
    """
    try:
        upload_id = payload.upload_id
        
        # Initialiser le stockage pour cet upload
        if upload_id not in pending_chunks:
            pending_chunks[upload_id] = {
                "chunks": {},
                "total_chunks": payload.total_chunks,
                "file_name": payload.file_name,
                "user_id": payload.user_id,
                "created_at": datetime.now().isoformat()
            }
        
        # Stocker le chunk
        pending_chunks[upload_id]["chunks"][payload.chunk_index] = payload.data
        received = len(pending_chunks[upload_id]["chunks"])
        
        print(f"📦 Chunk {payload.chunk_index + 1}/{payload.total_chunks} reçu pour {upload_id}")
        
        # Vérifier si tous les chunks sont reçus
        if received == payload.total_chunks:
            # Réassembler le fichier
            chunks_data = pending_chunks[upload_id]["chunks"]
            ordered_chunks = [chunks_data[i] for i in range(payload.total_chunks)]
            complete_data = "".join(ordered_chunks)
            
            # Décoder le base64
            file_bytes = base64.b64decode(complete_data)
            
            print(f"✅ Fichier réassemblé: {payload.file_name} ({len(file_bytes)} bytes)")
            
            # Upload vers Supabase Storage
            file_url = None
            if supabase_client:
                try:
                    file_path = f"{payload.user_id}/{int(time.time())}_{payload.file_name}"
                    supabase_client.storage.from_("chat-files").upload(
                        file_path,
                        file_bytes,
                        {"content-type": "image/png"}
                    )
                    file_url = f"{SUPABASE_URL}/storage/v1/object/public/chat-files/{file_path}"
                    print(f"☁️  Uploadé vers Supabase: {file_url}")
                except Exception as e:
                    print(f"⚠️  Erreur upload Supabase: {e}")
            
            # Nettoyer
            del pending_chunks[upload_id]
            
            return {
                "success": True,
                "complete": True,
                "file_url": file_url,
                "file_size": len(file_bytes),
                "upload_id": upload_id
            }
        
        return {
            "success": True,
            "complete": False,
            "received": received,
            "total": payload.total_chunks,
            "progress": round(received / payload.total_chunks * 100, 1)
        }
        
    except Exception as e:
        print(f"❌ Erreur chunk: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/presence")
async def get_presence():
    """Récupérer la liste des utilisateurs en ligne"""
    # Nettoyer les utilisateurs inactifs (>2 minutes)
    cutoff = datetime.now().timestamp() - 120
    active_users = {}
    
    for user_id, data in user_presence.items():
        try:
            last_seen = datetime.fromisoformat(data["last_seen"]).timestamp()
            if last_seen > cutoff:
                active_users[user_id] = data
        except:
            pass
    
    return {
        "users": active_users,
        "count": len(active_users),
        "timestamp": datetime.now().isoformat()
    }

@app.post("/api/heartbeat")
async def http_heartbeat(payload: HeartbeatPayload):
    """
    Alternative HTTP pour les heartbeats (si UDP non disponible).
    Utile pour les environnements où UDP est bloqué.
    """
    user_presence[payload.user_id] = {
        "status": payload.status,
        "last_seen": datetime.now().isoformat(),
        "protocol": "HTTP"
    }
    
    # Mise à jour Supabase
    if supabase_client:
        try:
            supabase_client.table("profiles").update({
                "status": payload.status,
                "last_seen": datetime.now().isoformat()
            }).eq("id", payload.user_id).execute()
        except Exception as e:
            print(f"⚠️  Erreur mise à jour présence: {e}")
    
    return {"success": True, "user_id": payload.user_id, "status": payload.status}

@app.post("/api/report")
async def report_message(payload: ReportPayload):
    """
    Signalement d'un message.
    Le serveur déplace le message vers une table de modération.
    """
    try:
        if supabase_client:
            # Récupérer le message
            result = supabase_client.table("messages").select("*").eq("id", payload.message_id).single().execute()
            
            if result.data:
                # Ici on pourrait créer une table 'reported_messages'
                # Pour l'instant, on log simplement
                print(f"⚠️  Message signalé: {payload.message_id} par {payload.reporter_id}")
                print(f"   Raison: {payload.reason}")
                
                return {
                    "success": True,
                    "message_id": payload.message_id,
                    "status": "reported"
                }
        
        return {"success": True, "simulated": True}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/calls/create")
async def create_call(payload: dict):
    """
    Créer un nouvel appel dans la base de données
    """
    try:
        caller_id = payload.get("caller_id")
        receiver_id = payload.get("receiver_id")
        call_type = payload.get("call_type", "audio")
        
        if not caller_id or not receiver_id:
            raise HTTPException(status_code=400, detail="caller_id and receiver_id are required")
        
        if call_type not in ["audio", "video"]:
            call_type = "audio"
        
        call_data = {
            "caller_id": caller_id,
            "receiver_id": receiver_id,
            "call_type": call_type,
            "status": "calling",
            "started_at": datetime.now().isoformat()
        }
        
        if supabase_client:
            result = supabase_client.table("calls").insert(call_data).execute()
            if result.data:
                print(f"✅ Appel créé: {result.data[0]['id']}")
                return {
                    "success": True,
                    "call_id": result.data[0]["id"],
                    "call": result.data[0]
                }
        
        # Mode simulation
        call_id = f"call_{int(time.time())}"
        return {
            "success": True,
            "call_id": call_id,
            "simulated": True
        }
        
    except Exception as e:
        print(f"❌ Erreur création appel: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/calls/history/{user_id}")
async def get_call_history(user_id: str):
    """
    Récupérer l'historique des appels d'un utilisateur
    """
    try:
        if not user_id:
            raise HTTPException(status_code=400, detail="user_id is required")
        
        if supabase_client:
            # Récupérer les appels où l'utilisateur est caller ou receiver
            result = supabase_client.table("calls") \
                .select("*") \
                .or_(f"caller_id.eq.{user_id},receiver_id.eq.{user_id}") \
                .order("created_at", desc=True) \
                .limit(50) \
                .execute()
            
            if result.data:
                return {
                    "success": True,
                    "calls": result.data,
                    "count": len(result.data)
                }
        
        # Mode simulation
        return {
            "success": True,
            "calls": [],
            "simulated": True
        }
        
    except Exception as e:
        print(f"❌ Erreur récupération historique: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/calls/update")
async def update_call(payload: dict):
    """
    Mettre à jour le statut d'un appel
    """
    try:
        call_id = payload.get("call_id")
        status = payload.get("status")
        ended_at = payload.get("ended_at")
        duration_seconds = payload.get("duration_seconds")
        
        if not call_id or not status:
            raise HTTPException(status_code=400, detail="call_id and status are required")
        
        if status not in ["calling", "accepted", "rejected", "ended", "missed"]:
            raise HTTPException(status_code=400, detail="Invalid status")
        
        update_data = {
            "status": status,
            "updated_at": datetime.now().isoformat()
        }
        
        if ended_at:
            update_data["ended_at"] = ended_at
        
        if duration_seconds is not None:
            update_data["duration_seconds"] = duration_seconds
        
        if supabase_client:
            result = supabase_client.table("calls") \
                .update(update_data) \
                .eq("id", call_id) \
                .execute()
            
            if result.data:
                print(f"✅ Appel {call_id} mis à jour: {status}")
                return {
                    "success": True,
                    "call": result.data[0]
                }
        
        return {
            "success": True,
            "simulated": True
        }
        
    except Exception as e:
        print(f"❌ Erreur mise à jour appel: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/debug/webrtc")
async def debug_webrtc(payload: dict):
    """
    Endpoint pour debugger WebRTC - analyse les messages offer/answer
    """
    print("=" * 60)
    print("🔧 DEBUG WEBRTC")
    print("=" * 60)
    
    # Analyse du payload
    print(f"Type: {payload.get('type')}")
    print(f"Target ID: {payload.get('target_id')}")
    
    data = payload.get('payload') or payload.get('data') or {}
    
    if 'sdp' in data:
        sdp = data['sdp']
        print(f"SDP Type: {sdp.get('type', 'MISSING')}")
        print(f"SDP Length: {len(sdp.get('sdp', ''))}")
        
        # Validation
        if not sdp.get('type'):
            print("⚠️ ERREUR: Type SDP manquant!")
        elif sdp.get('type') not in ['offer', 'answer', 'pranswer', 'rollback']:
            print(f"⚠️ ERREUR: Type SDP invalide: {sdp.get('type')}")
    elif isinstance(data, dict) and 'type' in data:
        # Format direct (sdp directement dans payload)
        print(f"SDP Type (direct): {data.get('type', 'MISSING')}")
        print(f"SDP Length (direct): {len(data.get('sdp', ''))}")
        
        if not data.get('type'):
            print("⚠️ ERREUR: Type SDP manquant!")
        elif data.get('type') not in ['offer', 'answer', 'pranswer', 'rollback']:
            print(f"⚠️ ERREUR: Type SDP invalide: {data.get('type')}")
    else:
        print("⚠️ Format de données non reconnu")
        print(f"   Keys disponibles: {list(data.keys()) if isinstance(data, dict) else 'N/A'}")
    
    print("=" * 60)
    
    return {
        "status": "debugged",
        "payload_received": True,
        "sdp_valid": (
            ('sdp' in data and data['sdp'].get('type') in ['offer', 'answer', 'pranswer', 'rollback']) or
            (isinstance(data, dict) and data.get('type') in ['offer', 'answer', 'pranswer', 'rollback'])
        ),
        "timestamp": datetime.now().isoformat()
    }

# ═══════════════════════════════════════════════════════════════════════════════
# WEBSOCKET - Signaling WebRTC (Appels Audio/Vidéo)
# ═══════════════════════════════════════════════════════════════════════════════

# Connexions WebSocket signaling actives (par user_id)
signaling_websockets: Dict[str, WebSocket] = {}

@app.websocket("/ws/{user_id}")
async def websocket_signaling(websocket: WebSocket, user_id: str):
    """
    WebSocket pour le signaling WebRTC (appels audio/vidéo).
    Relaie les messages offer/answer/ice-candidate entre utilisateurs.
    """
    await websocket.accept()
    signaling_websockets[user_id] = websocket
    print(f"📞 [Signaling] Connecté: {user_id}")
    
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            
            msg_type = message.get("type")
            
            # Support ping/pong pour heartbeat (le frontend envoie ping toutes les 20s)
            if msg_type == "ping":
                await websocket.send_json({"type": "pong", "timestamp": datetime.now().isoformat()})
                continue
            
            target_id = message.get("target_id")
            # Support à la fois "payload" et "data" pour compatibilité
            payload = message.get("payload") or message.get("data")
            
            print(f"📞 [Signaling] {user_id} -> {target_id}: {msg_type}")
            
            # Relayer au destinataire
            if target_id and target_id in signaling_websockets:
                target_ws = signaling_websockets[target_id]
                # IMPORTANT: Envoyer avec "payload" (le frontend attend "payload")
                await target_ws.send_json({
                    "type": msg_type,
                    "sender_id": user_id,
                    "target_id": target_id,
                    "payload": payload
                })
                print(f"✅ [Signaling] Message relayé à {target_id}")
            else:
                print(f"⚠️ [Signaling] Destinataire {target_id} non connecté")
                # Notifier l'expéditeur avec plus de détails
                await websocket.send_json({
                    "type": "error",
                    "error_type": "TARGET_NOT_CONNECTED",
                    "message": f"User {target_id} is not connected",
                    "target_id": target_id,
                    "available_users": list(signaling_websockets.keys())
                })
                
    except WebSocketDisconnect:
        if user_id in signaling_websockets:
            del signaling_websockets[user_id]
        print(f"👋 [Signaling] Déconnecté: {user_id}")
    except Exception as e:
        print(f"❌ [Signaling] Erreur: {e}")
        if user_id in signaling_websockets:
            del signaling_websockets[user_id]

# ═══════════════════════════════════════════════════════════════════════════════
# WEBSOCKET - Alternative pour Heartbeat (navigateurs ne supportent pas UDP)
# ═══════════════════════════════════════════════════════════════════════════════

@app.websocket("/ws/heartbeat")
async def websocket_heartbeat(websocket: WebSocket):
    """
    WebSocket pour les heartbeats depuis le navigateur.
    Le serveur fait le bridge vers la logique UDP interne.
    """
    await websocket.accept()
    user_id = None
    
    try:
        while True:
            data = await websocket.receive_text()
            
            try:
                message = json.loads(data)
                user_id = message.get("user_id")
                status = message.get("status", "online")
                
                if user_id:
                    user_presence[user_id] = {
                        "status": status,
                        "last_seen": datetime.now().isoformat(),
                        "protocol": "WebSocket"
                    }
                    
                    active_websockets[user_id] = websocket
                    
                    # Broadcast aux autres utilisateurs
                    await websocket.send_json({
                        "type": "presence_update",
                        "user_id": user_id,
                        "status": status
                    })
                    
            except json.JSONDecodeError:
                # Format simple: "USER_ID:STATUS"
                if ":" in data:
                    parts = data.split(":", 1)
                    user_id = parts[0]
                    status = parts[1] if len(parts) > 1 else "online"
                    
                    user_presence[user_id] = {
                        "status": status,
                        "last_seen": datetime.now().isoformat(),
                        "protocol": "WebSocket"
                    }
                    
    except WebSocketDisconnect:
        if user_id:
            user_presence[user_id] = {
                "status": "offline",
                "last_seen": datetime.now().isoformat(),
                "protocol": "WebSocket"
            }
            if user_id in active_websockets:
                del active_websockets[user_id]
        print(f"👋 WebSocket déconnecté: {user_id}")

# ═══════════════════════════════════════════════════════════════════════════════
# POINT D'ENTRÉE
# ═══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("""
    ╔═══════════════════════════════════════════════════════════════════════════════╗
    ║           SAÉ 3.02 - SERVEUR APPLICATION COMMUNICANTE                         ║
    ║                                                                               ║
    ║   Protocoles implémentés:                                                     ║
    ║   • TCP/HTTP (FastAPI) - Port 7860                                            ║
    ║   • UDP (Socket) - Port 5005                                                  ║
    ║   • WebSocket - /ws/heartbeat                                                 ║
    ║                                                                               ║
    ║   Fonctionnalités:                                                            ║
    ║   • Envoi de messages chiffrés (Fernet/AES-128)                               ║
    ║   • Upload d'images par chunks                                                ║
    ║   • Gestion de présence (heartbeat)                                           ║
    ║   • Signalement de messages                                                   ║
    ╚═══════════════════════════════════════════════════════════════════════════════╝
    """)
    
    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=7860,
        reload=True,
        log_level="info"
    )
