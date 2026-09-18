import os
import sys
import json
import asyncio

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
from datetime import datetime
from typing import List, Optional
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from meesho_bot import bot_instance
from scheduler import scheduler

app = FastAPI(
    title="Meesho Order Manager",
    description="Automated pending order management, date-wise acceptance, and auto-scheduler for Meesho sellers",
    version="1.1.0"
)

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
TEMPLATES_DIR = os.path.join(BASE_DIR, "templates")

os.makedirs(STATIC_DIR, exist_ok=True)
os.makedirs(TEMPLATES_DIR, exist_ok=True)
os.makedirs(os.path.join(STATIC_DIR, "css"), exist_ok=True)
os.makedirs(os.path.join(STATIC_DIR, "js"), exist_ok=True)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# Request Models
class LoginRequest(BaseModel):
    email_or_phone: Optional[str] = ""
    password: Optional[str] = ""

class AcceptOrdersRequest(BaseModel):
    accept_all: bool = False
    order_ids: Optional[List[str]] = []

class AutoAcceptToggleRequest(BaseModel):
    enabled: bool
    interval_minutes: int = 30

def is_bot_logged_in() -> bool:
    has_auth = os.path.exists(bot_instance.auth_file)
    has_acc = bool(bot_instance.current_email) or bool(bot_instance.workspace_hash)
    return bool(has_auth or has_acc)

def get_safe_store_name() -> str:
    if bot_instance.store_name and bot_instance.store_name != "Not Logged In":
        return bot_instance.store_name
    if bot_instance.current_email:
        prefix = bot_instance.current_email.split('@')[0].replace('.', ' ').title()
        if bot_instance.workspace_hash:
            return f"{prefix} ({bot_instance.workspace_hash})"
        return prefix
    return "Meesho Seller"

@app.on_event("startup")
async def on_startup():
    cfg = bot_instance.load_config()
    meesho_cfg = cfg.get("meesho", {})
    if meesho_cfg.get("email_or_phone"):
        bot_instance.current_email = meesho_cfg.get("email_or_phone")
    if meesho_cfg.get("workspace_hash"):
        bot_instance.workspace_hash = meesho_cfg.get("workspace_hash")
    if meesho_cfg.get("store_name") and meesho_cfg.get("store_name") != "Not Logged In":
        bot_instance.store_name = meesho_cfg.get("store_name")
    elif is_bot_logged_in():
        bot_instance.store_name = get_safe_store_name()

    auto_cfg = cfg.get("auto_accept", {})
    if auto_cfg.get("enabled", False):
        interval = auto_cfg.get("interval_minutes", 30)
        scheduler.start(interval_minutes=interval)
        bot_instance.log(f"Resumed Auto-Accept scheduler on startup (Every {interval} mins).", level="info")

@app.get("/", response_class=HTMLResponse)
async def serve_index():
    index_file = os.path.join(TEMPLATES_DIR, "index.html")
    if os.path.exists(index_file):
        with open(index_file, "r", encoding="utf-8") as f:
            return f.read()
    return "<h1>Meesho Order Manager Dashboard Loading...</h1>"

@app.get("/api/status")
async def get_status():
    """Get current status of bot, active store account, orders count, and auto-accept scheduler."""
    is_logged_in = is_bot_logged_in()
    s_name = get_safe_store_name() if is_logged_in else ""
    cached_orders = bot_instance.get_cached_orders() if is_logged_in else []
    cached_otps = bot_instance.get_cached_otps() if is_logged_in else []
    return {
        "is_busy": bot_instance.is_busy,
        "logged_in": is_logged_in,
        "orders_count": len(cached_orders),
        "return_otps_count": len(cached_otps),
        "user_data_exists": is_logged_in,
        "recent_logs_count": len(bot_instance.logs_buffer),
        "store_name": s_name,
        "email": bot_instance.current_email if is_logged_in else "",
        "workspace_hash": bot_instance.workspace_hash if is_logged_in else "",
        "auto_accept": scheduler.get_status()
    }

@app.get("/api/returns/otp")
async def get_return_otps(sync: bool = False):
    """Fetch Courier Partner Return Delivery OTPs from Meesho fulfillment panel."""
    is_logged_in = is_bot_logged_in()
    if not is_logged_in:
        return {
            "status": "unauthorized",
            "logged_in": False,
            "otps": [],
            "count": 0,
            "last_updated": "Never",
            "message": "Please log in to view Return Delivery OTPs."
        }

    if sync:
        if bot_instance.is_busy:
            return JSONResponse(status_code=400, content={"message": "Bot is currently busy with another operation."})
        
        # SYNCHRONOUS: await the actual fetch so we return real data
        fetched_otps = await bot_instance.fetch_courier_return_otps()
        return {
            "status": "success",
            "message": f"Fetched {len(fetched_otps)} Courier Return OTP(s) from Meesho.",
            "otps": fetched_otps,
            "count": len(fetched_otps),
            "last_updated": datetime.now().strftime("%H:%M:%S")
        }

    otps = bot_instance.get_cached_otps()
    return {
        "status": "success",
        "logged_in": True,
        "otps": otps,
        "count": len(otps),
        "last_updated": datetime.now().strftime("%H:%M:%S")
    }

@app.post("/api/login")
async def login(req: LoginRequest):
    """Start login process in browser with ID and Password and wait for completion."""
    if bot_instance.is_busy:
        return JSONResponse(status_code=400, content={"message": "Bot is currently busy with another operation."})
    
    if req.email_or_phone:
        bot_instance.config.setdefault("meesho", {})["email_or_phone"] = req.email_or_phone
    if req.password:
        bot_instance.config.setdefault("meesho", {})["password"] = req.password
    bot_instance.save_config(bot_instance.config)

    res = await bot_instance.login(
        email_or_phone=req.email_or_phone or bot_instance.config.get("meesho", {}).get("email_or_phone", ""),
        password=req.password or bot_instance.config.get("meesho", {}).get("password", "")
    )
    
    if res.get("success"):
        return {
            "status": "success",
            "logged_in": True,
            "store_name": bot_instance.store_name,
            "email": bot_instance.current_email,
            "workspace_hash": bot_instance.workspace_hash,
            "orders_count": len(bot_instance.get_cached_orders()),
            "return_otps_count": len(bot_instance.get_cached_otps()),
            "message": f"Logged in as {bot_instance.store_name}"
        }
    else:
        return JSONResponse(status_code=401, content={
            "status": "error",
            "message": res.get("message", "Login failed. Please check credentials.")
        })

@app.get("/api/check-session")
async def check_session():
    """Verify if user is actively logged into Meesho."""
    res = await bot_instance.check_login_status()
    return res

@app.get("/api/orders/pending")
async def get_pending_orders(sync: bool = False):
    """Fetch pending orders list. If sync=true, triggers live fetch across all pages."""
    is_logged_in = is_bot_logged_in()
    if not is_logged_in:
        return {
            "status": "unauthorized",
            "logged_in": False,
            "count": 0,
            "orders": [],
            "message": "Please log in to view pending orders."
        }

    if sync:
        if bot_instance.is_busy:
            return JSONResponse(status_code=400, content={"message": "Bot is currently busy with another operation."})
        
        # SYNCHRONOUS: await the actual fetch so we return real data
        fetched_orders = await bot_instance.fetch_pending_orders()
        return {
            "status": "success",
            "message": f"Fetched {len(fetched_orders)} pending orders from Meesho.",
            "orders": fetched_orders,
            "count": len(fetched_orders)
        }
    
    orders = bot_instance.get_cached_orders()
    return {
        "status": "success",
        "logged_in": True,
        "count": len(orders),
        "orders": orders
    }

@app.post("/api/orders/accept")
async def accept_orders(req: AcceptOrdersRequest):
    """Accept selected, date-grouped, or all pending orders on Meesho."""
    if bot_instance.is_busy:
        return JSONResponse(status_code=400, content={"message": "Bot is currently busy with another operation."})

    res = await bot_instance.accept_orders(
        order_ids=req.order_ids,
        accept_all=req.accept_all
    )
    
    acc_count = res.get("accepted_count", 0)
    success = bool(res.get("success") and acc_count > 0)
    return {
        "status": "success" if success else "error",
        "message": res.get("message"),
        "accepted_count": acc_count,
        "remaining_orders": bot_instance.get_cached_orders()
    }

@app.get("/api/auto-accept/status")
async def auto_accept_status():
    """Get status of auto-accept scheduler."""
    return scheduler.get_status()

@app.post("/api/auto-accept/toggle")
async def auto_accept_toggle(req: AutoAcceptToggleRequest):
    """Toggle auto-accept on/off and configure interval (15, 30, 45, 60 mins)."""
    if req.enabled:
        scheduler.start(interval_minutes=req.interval_minutes)
        msg = f"Auto-Accept scheduled: Runs every {req.interval_minutes} minutes."
    else:
        scheduler.stop()
        msg = "Auto-Accept has been turned off."
        
    return {
        "status": "success",
        "message": msg,
        "scheduler": scheduler.get_status()
    }

@app.get("/api/logs")
async def get_logs():
    """Retrieve execution logs for live terminal view."""
    return {
        "logs": bot_instance.logs_buffer,
        "is_busy": bot_instance.is_busy
    }

@app.post("/api/logs/clear")
async def clear_logs():
    bot_instance.logs_buffer.clear()
    return {"status": "cleared"}

@app.get("/api/config")
async def get_config():
    cfg = bot_instance.load_config()
    safe_meesho = cfg.get("meesho", {}).copy()
    if "password" in safe_meesho and safe_meesho["password"]:
        safe_meesho["password"] = "••••••••"
    return {
        "meesho": safe_meesho,
        "app": cfg.get("app", {}),
        "auto_accept": cfg.get("auto_accept", {})
    }

@app.post("/api/logout")
async def logout():
    """Clear session and log out."""
    await bot_instance.logout()
    return {"status": "success", "message": "Logged out successfully from Meesho."}

@app.post("/api/browser/close")
async def close_browser():
    await bot_instance.close()
    return {"status": "closed", "message": "Browser session closed."}

if __name__ == "__main__":
    import uvicorn
    cfg = bot_instance.load_config()
    port = cfg.get("app", {}).get("port", 8000)
    host = cfg.get("app", {}).get("host", "127.0.0.1")
    print(f"\n✨ Meesho Order Manager starting on http://{host}:{port} ✨\n")
    uvicorn.run("app:app", host=host, port=port, reload=False)
