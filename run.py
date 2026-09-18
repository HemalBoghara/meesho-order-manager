import uvicorn
import os
import sys
import webbrowser
import threading
import time

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

def open_browser(port: int):
    time.sleep(1.5)
    webbrowser.open(f"http://127.0.0.1:{port}")

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    host = "0.0.0.0"
    
    print("\n" + "="*60)
    print(" 🚀 Meesho Order Manager Starting...")
    print(f" 🌐 Host: {host} | Port: {port}")
    print(f" 🌐 Local URL: http://127.0.0.1:{port}")
    print("="*60 + "\n")
    
    # Auto-open browser tab only if running locally on desktop
    if sys.platform == "win32" and not os.environ.get("RENDER"):
        threading.Thread(target=open_browser, args=(port,), daemon=True).start()
    
    # Run FastAPI server
    uvicorn.run("app:app", host=host, port=port, reload=False)
