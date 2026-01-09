"""
Cyber-Connect Ultimate V4.0 - Backend Production-Ready
FastAPI + WebSocket + Supabase + Fernet Encryption
OPTIMISÉ pour WebRTC - Hugging Face Spaces - PRODUCTION

CORRECTIFS APPLIQUÉS:
- WebSocket signaling: utilise "payload" au lieu de "data" pour compatibilité frontend
- Support ping/pong pour heartbeat
- Erreurs structurées avec target_id et available_users
"""

import os
import time
import json
import asyncio
import random
import base64
from datetime import datetime
from typing import Dict, List, Optional, Any, Tuple
import traceback

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, File, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, validator
from supabase import create_client, Client
from cryptography.fernet import Fernet, InvalidToken
from deep_translator import GoogleTranslator

# ============================================================================
# CONFIGURATION - PRODUCTION READY
# ============================================================================

class Config:
    """Configuration de production"""
    SUPABASE_URL = os.environ.get("SUPABASE_URL", "").strip()
    SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    ENCRYPTION_KEY = os.environ.get("ENCRYPTION_KEY", "").strip()
    
    WS_HEARTBEAT_INTERVAL = 20
    WS_INACTIVITY_TIMEOUT = 90
    WS_CLEANUP_INTERVAL = 30
    WS_CONNECTION_TIMEOUT = 300
    
    LOG_LEVEL = "INFO"
    DEBUG_MODE = os.environ.get("DEBUG", "false").lower() == "true"

# ============================================================================
# INITIALISATION FASTAPI
# ============================================================================

app = FastAPI(
    title="Cyber-Connect API V4.0",
    description="Backend de messagerie instantanée avec WebRTC - Production Ready",
    version="4.0.0",
    docs_url="/docs" if Config.DEBUG_MODE else None,
    redoc_url="/redoc" if Config.DEBUG_MODE else None
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["*"]
)

# ============================================================================
# DATA MODELS
# ============================================================================

class MessagePayload(BaseModel):
    content: str = Field(..., min_length=1, max_length=5000)
    sender_id: str = Field(..., min_length=1, max_length=100)
    conversation_id: str = Field(..., min_length=1, max_length=100)
    image_url: Optional[str] = Field(None, max_length=500)
    
    @validator('sender_id', 'conversation_id')
    def validate_ids(cls, v):
        invalid_values = ["undefined", "null", "none", ""]
        if v.lower() in invalid_values:
            raise ValueError(f"ID invalide: {v}")
        return v.strip()

class DecryptPayload(BaseModel):
    content: str = Field(..., min_length=1)

class ReportPayload(BaseModel):
    message_id: str = Field(..., min_length=1)
    reporter_id: str = Field(..., min_length=1)
    reason: str = Field(..., min_length=5, max_length=500)

class TranslationPayload(BaseModel):
    text: str = Field(..., min_length=1, max_length=5000)
    target_lang: str = Field("fr", pattern="^[a-z]{2}$")

class CallCreatePayload(BaseModel):
    caller_id: str
    receiver_id: str
    call_type: str = "audio"

class CallUpdatePayload(BaseModel):
    call_id: str
    status: str
    ended_at: Optional[str] = None

# ============================================================================
# CORE SERVICES
# ============================================================================

class Logger:
    @staticmethod
    def info(message: str, **kwargs):
        print(f"ℹ️ [{datetime.now().strftime('%H:%M:%S')}] {message}")
        if kwargs:
            print(f"   Details: {kwargs}")
    
    @staticmethod
    def success(message: str, **kwargs):
        print(f"✅ [{datetime.now().strftime('%H:%M:%S')}] {message}")
    
    @staticmethod
    def warning(message: str, **kwargs):
        print(f"⚠️ [{datetime.now().strftime('%H:%M:%S')}] {message}")
    
    @staticmethod
    def error(message: str, error: Exception = None, **kwargs):
        print(f"❌ [{datetime.now().strftime('%H:%M:%S')}] {message}")
        if error:
            print(f"   Exception: {type(error).__name__}: {str(error)}")
    
    @staticmethod
    def webrtc(event: str, sender: str, target: str, **kwargs):
        print(f"📞 [WEBRTC] {sender[:8]} → {target[:8]}: {event}")

class EncryptionService:
    def __init__(self, key: str):
        self.cipher = None
        self.key = key
        self.initialized = False
        
        if not key:
            Logger.warning("EncryptionService: Aucune clé fournie, chiffrement désactivé")
            return
        
        try:
            if len(key) < 43:
                raise ValueError("Clé de chiffrement trop courte")
            
            self.cipher = Fernet(key.encode())
            self.initialized = True
            Logger.success("EncryptionService: Initialisé avec succès")
            
        except Exception as e:
            Logger.error("EncryptionService: Échec d'initialisation", e)
    
    def encrypt(self, content: str) -> Tuple[str, bool]:
        if not self.initialized or not content:
            return content, False
        
        try:
            encrypted = self.cipher.encrypt(content.encode()).decode()
            return encrypted, True
        except Exception as e:
            Logger.error("EncryptionService: Échec de chiffrement", e)
            return content, False
    
    def decrypt(self, encrypted_content: str) -> Tuple[str, bool]:
        if not self.initialized or not encrypted_content:
            return encrypted_content, False
        
        try:
            if not self.is_likely_fernet(encrypted_content):
                return encrypted_content, False
            
            decrypted = self.cipher.decrypt(encrypted_content.encode()).decode()
            return decrypted, True
        except InvalidToken:
            Logger.warning("EncryptionService: Token Fernet invalide")
            return "[ERREUR: Token invalide]", False
        except Exception as e:
            Logger.error("EncryptionService: Échec de déchiffrement", e)
            return f"[ERREUR: {str(e)[:50]}]", False

    def is_likely_fernet(self, token: str) -> bool:
        if not token or not isinstance(token, str):
            return False
        if len(token) < 10:
            return False
        try:
            if '=' in token[-2:]:
                return True
            elif len(token) % 4 == 0:
                return True
            return False
        except:
            return True

    def status(self) -> Dict[str, Any]:
        return {
            "initialized": self.initialized,
            "key_provided": bool(self.key),
            "key_length": len(self.key) if self.key else 0,
            "cipher_available": self.cipher is not None
        }

class DatabaseService:
    def __init__(self, url: str, key: str):
        self.client = None
        self.url = url
        self.key = key
        self.connected = False
        
        if url and key:
            self._connect()
        else:
            Logger.warning("DatabaseService: Mode démo activé (pas de Supabase)")
    
    def _connect(self):
        try:
            self.client = create_client(self.url, self.key)
            self.client.table("messages").select("count", count="exact").limit(1).execute()
            self.connected = True
            Logger.success(f"DatabaseService: Connecté à {self.url[:30]}...")
        except Exception as e:
            Logger.error("DatabaseService: Échec de connexion", e)
            self.connected = False
    
    def insert_message(self, message_data: dict) -> Tuple[Optional[str], bool]:
        if not self.connected:
            return f"demo_{int(time.time())}", True
        
        try:
            full_message_data = {
                "content": message_data.get("content", ""),
                "sender_id": message_data.get("sender_id", ""),
                "conversation_id": message_data.get("conversation_id", ""),
                "image_url": message_data.get("image_url"),
                "is_read": message_data.get("is_read", False),
                "created_at": message_data.get("created_at", datetime.now().isoformat()),
                "_encrypted": message_data.get("_encrypted", False)
            }
            
            response = self.client.table("messages").insert(full_message_data).execute()
            if response.data:
                message_id = response.data[0]['id']
                Logger.info(f"DatabaseService: Message inséré ID={message_id[:8]}")
                return message_id, True
            return None, False
        except Exception as e:
            Logger.error("DatabaseService: Échec d'insertion", e)
            return None, False
    
    def get_messages(self, conversation_id: str, limit: int = 50) -> Tuple[List[dict], bool]:
        if not self.connected:
            return [], True
        
        try:
            essential_columns = [
                "id", "content", "sender_id", "conversation_id", 
                "image_url", "is_read", "created_at"
            ]
            
            optional_columns = [
                "reported", "report_reason", "reporter_id", "reported_at",
                "_encrypted", "_encryption_version"
            ]
            
            all_columns = essential_columns + optional_columns
            
            try:
                response = self.client.table("messages") \
                    .select(",".join(all_columns)) \
                    .eq("conversation_id", conversation_id) \
                    .order("created_at", desc=True) \
                    .limit(limit) \
                    .execute()
            except Exception:
                response = self.client.table("messages") \
                    .select(",".join(essential_columns)) \
                    .eq("conversation_id", conversation_id) \
                    .order("created_at", desc=True) \
                    .limit(limit) \
                    .execute()
            
            messages = response.data or []
            
            processed_messages = []
            for msg in messages:
                processed_msg = dict(msg)
                defaults = {
                    "_encrypted": False,
                    "_decrypted": False,
                    "reported": False,
                    "is_read": False,
                    "image_url": None,
                }
                for field, default_value in defaults.items():
                    if field not in processed_msg:
                        processed_msg[field] = default_value
                processed_messages.append(processed_msg)
            
            return processed_messages, True
            
        except Exception as e:
            Logger.error("DatabaseService: Échec de récupération", e)
            return [], False
    
    def status(self) -> Dict[str, Any]:
        return {
            "connected": self.connected,
            "url_provided": bool(self.url),
            "key_provided": bool(self.key)
        }

class WebSocketManager:
    def __init__(self):
        self.active_connections: Dict[str, Dict] = {}
        self._lock = asyncio.Lock()
        self.metrics = {
            "total_connections": 0,
            "messages_relayed": 0,
            "errors": 0,
            "start_time": time.time()
        }
    
    async def connect(self, websocket: WebSocket, user_id: str) -> Tuple[str, bool]:
        try:
            await websocket.accept()
            connection_id = f"conn_{user_id}_{int(time.time())}_{random.randint(1000, 9999)}"
            
            async with self._lock:
                if user_id in self.active_connections:
                    old_conn = self.active_connections[user_id]
                    try:
                        await old_conn['websocket'].close(code=1000, reason="Nouvelle connexion")
                    except:
                        pass
                
                self.active_connections[user_id] = {
                    'websocket': websocket,
                    'connection_id': connection_id,
                    'last_ping': time.time(),
                    'connected_at': time.time(),
                    'ip_address': websocket.client.host if websocket.client else "unknown"
                }
                
                self.metrics["total_connections"] += 1
            
            Logger.success(f"WebSocketManager: Connexion {connection_id} pour {user_id}")
            return connection_id, True
            
        except Exception as e:
            Logger.error("WebSocketManager: Échec de connexion", e)
            return "", False
    
    async def disconnect(self, user_id: str, connection_id: str) -> bool:
        try:
            async with self._lock:
                if user_id in self.active_connections:
                    conn = self.active_connections[user_id]
                    if conn['connection_id'] == connection_id:
                        try:
                            await conn['websocket'].close(code=1000, reason="Déconnexion normale")
                        except:
                            pass
                        del self.active_connections[user_id]
                        return True
            return False
        except Exception as e:
            Logger.error("WebSocketManager: Échec de déconnexion", e)
            return False
    
    async def send_to_user(self, user_id: str, message: Dict) -> bool:
        async with self._lock:
            if user_id not in self.active_connections:
                return False
            
            try:
                conn = self.active_connections[user_id]
                await conn['websocket'].send_json(message)
                self.metrics["messages_relayed"] += 1
                return True
            except Exception as e:
                Logger.error(f"WebSocketManager: Échec d'envoi à {user_id}", e)
                self.metrics["errors"] += 1
                return False
    
    async def is_user_connected(self, user_id: str) -> bool:
        async with self._lock:
            return user_id in self.active_connections
    
    async def get_connected_users(self) -> List[str]:
        async with self._lock:
            return list(self.active_connections.keys())
    
    async def update_ping(self, user_id: str) -> bool:
        async with self._lock:
            if user_id in self.active_connections:
                self.active_connections[user_id]['last_ping'] = time.time()
                return True
            return False
    
    async def get_metrics(self) -> Dict[str, Any]:
        async with self._lock:
            now = time.time()
            return {
                "active_connections": len(self.active_connections),
                "total_connections": self.metrics["total_connections"],
                "messages_relayed": self.metrics["messages_relayed"],
                "errors": self.metrics["errors"],
                "uptime_seconds": round(now - self.metrics["start_time"], 1),
            }

# ============================================================================
# INITIALISATION DES SERVICES GLOBAUX
# ============================================================================

def initialize_services() -> Tuple[DatabaseService, EncryptionService, WebSocketManager]:
    Logger.success("=" * 60)
    Logger.success("🚀 CYBER-CONNECT V4.0 - INITIALISATION")
    Logger.success("=" * 60)
    
    Logger.info("CONFIGURATION:")
    Logger.info(f"  SUPABASE_URL: {'✅' if Config.SUPABASE_URL else '❌'}")
    Logger.info(f"  SUPABASE_KEY: {'✅' if Config.SUPABASE_KEY else '❌'}")
    Logger.info(f"  ENCRYPTION_KEY: {'✅' if Config.ENCRYPTION_KEY else '❌'}")
    
    db_service = DatabaseService(Config.SUPABASE_URL, Config.SUPABASE_KEY)
    encryption_service = EncryptionService(Config.ENCRYPTION_KEY)
    ws_manager = WebSocketManager()
    
    Logger.success("✅ SERVICES INITIALISÉS")
    return db_service, encryption_service, ws_manager

db, encryption, ws_manager = initialize_services()

# Variable globale pour Supabase (compatibilité avec les routes /api/calls/*)
supabase = db.client

# ============================================================================
# UTILITY FUNCTIONS
# ============================================================================

def generate_timestamp() -> str:
    return datetime.now().isoformat()

def format_error_response(error_type: str, message: str, **kwargs) -> Dict:
    response = {
        "type": "error",
        "error_type": error_type,
        "message": message,
        "timestamp": time.time(),
    }
    response.update(kwargs)
    return response

# ============================================================================
# API ROUTES
# ============================================================================

@app.get("/")
async def root():
    metrics = await ws_manager.get_metrics()
    return {
        "status": "online",
        "service": "Cyber-Connect API V4.0",
        "version": "4.0.0",
        "timestamp": generate_timestamp(),
        "metrics": {
            "active_connections": metrics["active_connections"],
            "uptime_seconds": metrics["uptime_seconds"]
        }
    }

@app.get("/health")
async def health_check():
    metrics = await ws_manager.get_metrics()
    encryption_status = encryption.status()
    db_status = db.status()
    
    all_healthy = db_status["connected"]
    
    return {
        "status": "healthy" if all_healthy else "degraded",
        "timestamp": generate_timestamp(),
        "services": {
            "websocket": {
                "status": "healthy",
                "active_connections": metrics["active_connections"],
            },
            "encryption": {
                "status": "healthy" if encryption_status["initialized"] else "disabled",
                "initialized": encryption_status["initialized"],
            },
            "database": {
                "status": "healthy" if db_status["connected"] else "degraded",
                "connected": db_status["connected"]
            }
        }
    }

@app.get("/api/diagnostic")
async def full_diagnostic():
    metrics = await ws_manager.get_metrics()
    return {
        "status": "success",
        "timestamp": generate_timestamp(),
        "websocket": metrics,
        "encryption": encryption.status(),
        "database": db.status(),
    }

@app.post("/api/send_message")
async def send_message(payload: MessagePayload):
    try:
        encrypted_content, encryption_success = encryption.encrypt(payload.content)
        
        message_data = {
            "content": encrypted_content,
            "sender_id": payload.sender_id,
            "conversation_id": payload.conversation_id,
            "image_url": payload.image_url,
            "is_read": False,
            "created_at": generate_timestamp(),
            "_encrypted": encryption_success
        }
        
        message_id, insert_success = db.insert_message(message_data)
        
        if not insert_success:
            raise HTTPException(status_code=500, detail="Échec de l'insertion du message")
        
        return {
            "status": "success",
            "message_id": message_id,
            "encrypted": encryption_success,
            "timestamp": generate_timestamp()
        }
        
    except Exception as e:
        Logger.error("Erreur send_message", e)
        raise HTTPException(status_code=500, detail=f"Erreur interne: {str(e)[:100]}")

@app.get("/api/get_messages/{conversation_id}")
async def get_messages(conversation_id: str, limit: int = 50, decrypt: bool = True):
    try:
        if not conversation_id or conversation_id.lower() in ["undefined", "null"]:
            return {"messages": [], "error": "conversation_id invalide"}
        
        messages, success = db.get_messages(conversation_id, limit)
        
        if not success:
            return JSONResponse(status_code=500, content={"error": "Échec de récupération"})
        
        stats = {"total": len(messages), "decrypted": 0, "encrypted": 0, "failed": 0, "plaintext": 0}
        
        processed_messages = []
        for msg in messages:
            try:
                content = msg.get("content", "")
                is_encrypted = encryption.is_likely_fernet(content)
                
                if is_encrypted:
                    stats["encrypted"] += 1
                    msg["_encrypted"] = True
                    
                    if decrypt and encryption.initialized:
                        decrypted_content, decrypt_success = encryption.decrypt(content)
                        if decrypt_success:
                            msg["content"] = decrypted_content
                            msg["_decrypted"] = True
                            stats["decrypted"] += 1
                        else:
                            msg["_decrypted"] = False
                            stats["failed"] += 1
                    else:
                        msg["_decrypted"] = False
                else:
                    stats["plaintext"] += 1
                    msg["_encrypted"] = False
                    msg["_decrypted"] = True
                
                processed_messages.append(msg)
            except Exception as e:
                Logger.error("Erreur traitement message", e)
                processed_messages.append(msg)
                stats["failed"] += 1
        
        processed_messages.reverse()
        
        return {
            "messages": processed_messages,
            "metadata": {
                "conversation_id": conversation_id,
                "count": len(processed_messages),
                "stats": stats,
                "decryption_enabled": decrypt,
                "encryption_available": encryption.initialized
            }
        }
        
    except Exception as e:
        Logger.error("Erreur get_messages", e)
        return JSONResponse(status_code=500, content={"error": f"Erreur: {str(e)[:100]}"})

@app.post("/api/decrypt_message")
async def decrypt_single_message(payload: DecryptPayload):
    if not encryption.initialized:
        return {"decrypted": "[CHIFFREMENT DÉSACTIVÉ]", "success": False}
    
    if not payload.content:
        return {"decrypted": "", "success": False}
    
    decrypted, success = encryption.decrypt(payload.content)
    
    return {
        "decrypted": decrypted,
        "success": success,
        "was_encrypted": encryption.is_likely_fernet(payload.content),
        "timestamp": generate_timestamp()
    }

@app.post("/api/translate")
async def translate_text(payload: TranslationPayload):
    try:
        translator = GoogleTranslator(source='auto', target=payload.target_lang)
        translated = translator.translate(payload.text)
        return {"status": "success", "translated": translated}
    except Exception as e:
        Logger.error("Erreur traduction", e)
        return {"status": "error", "detail": str(e)}

# ============================================================================
# ROUTES POUR LES APPELS
# ============================================================================

@app.post("/api/calls/create")
async def create_call(payload: CallCreatePayload):
    try:
        if not supabase:
            return {"status": "success", "call_id": f"demo_call_{int(time.time())}", "simulated": True}
        
        call_data = {
            "caller_id": payload.caller_id,
            "receiver_id": payload.receiver_id,
            "call_type": payload.call_type,
            "status": "calling",
            "started_at": generate_timestamp()
        }
        
        response = supabase.table("calls").insert(call_data).execute()
        
        if not response.data:
            raise HTTPException(status_code=500, detail="Failed to create call")
        
        return {"status": "success", "call_id": response.data[0]['id']}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/calls/update")
async def update_call(payload: CallUpdatePayload):
    try:
        if not supabase:
            return {"status": "success", "simulated": True}
        
        update_data = {"status": payload.status, "updated_at": generate_timestamp()}
        if payload.status == "ended" and payload.ended_at:
            update_data["ended_at"] = payload.ended_at
        
        supabase.table("calls").update(update_data).eq("id", payload.call_id).execute()
        return {"status": "success", "message": f"Call updated to {payload.status}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/calls/history/{user_id}")
async def get_call_history(user_id: str, limit: int = 50):
    try:
        if not supabase:
            return {"calls": [], "simulated": True}
        
        response = supabase.table("calls") \
            .select("*") \
            .or_(f"caller_id.eq.{user_id},receiver_id.eq.{user_id}") \
            .order("created_at", desc=True) \
            .limit(limit) \
            .execute()
        
        return {"calls": response.data or [], "count": len(response.data or [])}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ============================================================================
# WEBSOCKET ENDPOINT - HEARTBEAT / PRÉSENCE (DOIT ÊTRE AVANT /ws/{user_id})
# ============================================================================

# Dictionnaire pour stocker la présence des utilisateurs
user_presence: Dict[str, Dict] = {}

@app.websocket("/ws/heartbeat")
async def websocket_heartbeat(websocket: WebSocket):
    """
    WebSocket pour les heartbeats depuis le navigateur.
    Gère la présence des utilisateurs (en ligne/hors ligne).
    IMPORTANT: Cet endpoint DOIT être défini AVANT /ws/{user_id}
    """
    await websocket.accept()
    user_id = None
    Logger.info("Heartbeat WebSocket connecté")
    
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
                        "last_seen": generate_timestamp(),
                        "protocol": "WebSocket"
                    }
                    
                    Logger.info(f"💓 Heartbeat reçu de {user_id}: {status}")
                    
                    # Confirmer la réception
                    await websocket.send_json({
                        "type": "presence_ack",
                        "user_id": user_id,
                        "status": status,
                        "timestamp": time.time()
                    })
                    
            except json.JSONDecodeError:
                # Format simple: "USER_ID:STATUS"
                if ":" in data:
                    parts = data.split(":", 1)
                    user_id = parts[0]
                    status = parts[1] if len(parts) > 1 else "online"
                    
                    user_presence[user_id] = {
                        "status": status,
                        "last_seen": generate_timestamp(),
                        "protocol": "WebSocket"
                    }
                    
    except WebSocketDisconnect:
        if user_id:
            user_presence[user_id] = {
                "status": "offline",
                "last_seen": generate_timestamp(),
                "protocol": "WebSocket"
            }
        Logger.info(f"💓 Heartbeat déconnecté: {user_id}")
    except Exception as e:
        Logger.error(f"Erreur Heartbeat pour {user_id}", e)

@app.get("/api/presence/{user_id}")
async def get_user_presence(user_id: str):
    """Récupère le statut de présence d'un utilisateur."""
    if user_id in user_presence:
        return user_presence[user_id]
    return {"status": "offline", "last_seen": None}

@app.get("/api/presence")
async def get_all_presence():
    """Récupère la présence de tous les utilisateurs."""
    return {"users": user_presence, "count": len(user_presence)}

# ============================================================================
# WEBSOCKET ENDPOINT - SIGNALING WEBRTC (CORRIGÉ)
# ============================================================================

@app.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: str):
    """
    Endpoint WebSocket principal pour la signalisation WebRTC.
    
    CORRECTIFS V4.0.1:
    - Support ping/pong pour heartbeat frontend (toutes les 20s)
    - Utilise "payload" au lieu de "data" pour compatibilité frontend
    - Erreurs structurées avec target_id et available_users
    """
    
    if not user_id or user_id.lower() in ["undefined", "null", ""]:
        Logger.warning(f"Rejet connexion WS: user_id invalide ({user_id})")
        await websocket.close(code=1008, reason="Invalid user ID")
        return
    
    user_id = user_id.strip()
    
    connection_id, connect_success = await ws_manager.connect(websocket, user_id)
    if not connect_success:
        await websocket.close(code=1011, reason="Connection failed")
        return
    
    Logger.success(f"WebSocket connecté: {user_id} ({connection_id})")
    
    try:
        while True:
            data = await websocket.receive_json()
            
            await ws_manager.update_ping(user_id)
            
            msg_type = data.get("type")
            
            # === SUPPORT PING/PONG ===
            if msg_type == "ping":
                await websocket.send_json({
                    "type": "pong",
                    "timestamp": time.time(),
                    "server_time": generate_timestamp()
                })
                continue
            
            target_id = data.get("target_id")
            
            # === COMPATIBILITÉ: Accepte "payload" OU "data" ===
            payload_data = data.get("payload")
            if payload_data is None:
                payload_data = data.get("data", {})
            
            Logger.info(f"📨 WS {user_id} -> {target_id}: {msg_type}")
            
            # Validation
            if not target_id:
                await websocket.send_json(format_error_response(
                    "VALIDATION_ERROR",
                    "target_id requis",
                    sender_id=user_id
                ))
                continue
            
            # Vérification que la cible est connectée
            target_connected = await ws_manager.is_user_connected(target_id)
            if not target_connected:
                await websocket.send_json(format_error_response(
                    "TARGET_NOT_CONNECTED",
                    f"L'utilisateur {target_id} n'est pas connecté",
                    sender_id=user_id,
                    target_id=target_id,
                    available_users=await ws_manager.get_connected_users()
                ))
                continue
            
            # === CONSTRUCTION DU MESSAGE DE RELAIS ===
            # IMPORTANT: Utiliser "payload" (le frontend attend "payload", pas "data")
            relay_message = {
                "type": msg_type,
                "sender_id": user_id,
                "target_id": target_id,
                "timestamp": time.time(),
                "payload": payload_data  # <-- CORRIGÉ: "payload" au lieu de "data"
            }
            
            # Envoi du message à la cible
            send_success = await ws_manager.send_to_user(target_id, relay_message)
            
            if not send_success:
                await websocket.send_json(format_error_response(
                    "SEND_FAILED",
                    f"Échec d'envoi à {target_id}",
                    sender_id=user_id,
                    target_id=target_id
                ))
            else:
                Logger.success(f"✅ {msg_type} relayé: {user_id} → {target_id}")
                
                # Confirmation pour les messages importants
                if msg_type in ["call", "offer"]:
                    await websocket.send_json({
                        "type": f"{msg_type}-sent",
                        "target_id": target_id,
                        "status": "delivered",
                        "timestamp": time.time()
                    })
    
    except WebSocketDisconnect:
        Logger.info(f"WebSocket déconnecté: {user_id}")
    except json.JSONDecodeError as e:
        Logger.error(f"JSON invalide de {user_id}", e)
    except Exception as e:
        Logger.error(f"Erreur WebSocket pour {user_id}", e)
    finally:
        await ws_manager.disconnect(user_id, connection_id)

# ============================================================================
# BACKGROUND TASKS
# ============================================================================

async def maintenance_task():
    while True:
        await asyncio.sleep(Config.WS_CLEANUP_INTERVAL)
        
        try:
            now = time.time()
            inactive_users = []
            
            for user_id, conn_data in list(ws_manager.active_connections.items()):
                inactive_time = now - conn_data['last_ping']
                total_time = now - conn_data['connected_at']
                
                if (inactive_time > Config.WS_INACTIVITY_TIMEOUT or 
                    total_time > Config.WS_CONNECTION_TIMEOUT):
                    inactive_users.append((user_id, conn_data['connection_id']))
            
            for user_id, connection_id in inactive_users:
                Logger.warning(f"Nettoyage connexion inactive: {user_id}")
                await ws_manager.disconnect(user_id, connection_id)
                
        except Exception as e:
            Logger.error("Erreur maintenance", e)

# ============================================================================
# STARTUP & SHUTDOWN
# ============================================================================

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(maintenance_task())
    
    Logger.success("=" * 60)
    Logger.success("🚀 CYBER-CONNECT V4.0.2 - SERVEUR DÉMARRÉ")
    Logger.success("=" * 60)
    Logger.success(f"🔌 WebSocket Signaling: /ws/{{user_id}}")
    Logger.success(f"💓 WebSocket Heartbeat: /ws/heartbeat")
    Logger.success(f"🔐 Chiffrement: {'✅' if encryption.initialized else '❌'}")
    Logger.success(f"🗄️  Base de données: {'✅' if db.connected else '❌'}")
    Logger.success("=" * 60)

@app.on_event("shutdown")
async def shutdown_event():
    Logger.success("🛑 CYBER-CONNECT - ARRÊT DU SERVEUR")

# ============================================================================
# MAIN ENTRY POINT
# ============================================================================

if __name__ == "__main__":
    import uvicorn
    
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 7860)),
        log_level="info" if Config.DEBUG_MODE else "warning",
        access_log=Config.DEBUG_MODE,
        timeout_keep_alive=30,
        limit_concurrency=1000
    )
