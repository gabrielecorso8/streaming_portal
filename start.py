import os
import sys
import subprocess
import urllib.request
import zipfile
import shutil

PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
VENV_DIR = os.path.join(PROJECT_DIR, "venv")
BIN_DIR = os.path.join(PROJECT_DIR, "bin")
LOG_FILE = os.path.join(PROJECT_DIR, "server.log")


def _ensure_streams():
    """Avviato con pythonw.exe (senza console) sys.stdout/stderr sono None:
    qualsiasi print() o il logging di uvicorn farebbe CRASHARE l'avvio. Qui li
    reindirizziamo su un file di log, cosi' il riavvio nascosto funziona sempre."""
    needs = (sys.stdout is None) or (sys.stderr is None) or \
            (getattr(sys.stdout, "fileno", None) is None)
    try:
        if sys.stdout is not None:
            sys.stdout.fileno()
    except Exception:
        needs = True
    if not needs:
        return
    try:
        f = open(LOG_FILE, "a", buffering=1, encoding="utf-8", errors="replace")
    except Exception:
        f = open(os.devnull, "w")
    if sys.stdout is None or _broken(sys.stdout):
        sys.stdout = f
    if sys.stderr is None or _broken(sys.stderr):
        sys.stderr = f


def _broken(stream):
    try:
        stream.fileno()
        return False
    except Exception:
        return True

def check_venv():
    """Returns True if running inside a virtual environment."""
    return sys.prefix != sys.base_prefix

def bootstrap_venv():
    """Creates a virtual environment and restarts the script using it."""
    if not os.path.exists(VENV_DIR):
        print(f"[*] Creating virtual environment in {VENV_DIR}...")
        subprocess.check_call([sys.executable, "-m", "venv", VENV_DIR])
        print("[+] Virtual environment created successfully.")
    
    # Locate virtual environment Python executable
    if os.name == "nt":
        python_bin = os.path.join(VENV_DIR, "Scripts", "python.exe")
    else:
        python_bin = os.path.join(VENV_DIR, "bin", "python")
        
    print("[*] Restarting script inside virtual environment...")
    
    # Run the script again using the venv python interpreter
    args = [python_bin] + sys.argv
    sys.exit(subprocess.call(args))

def install_dependencies():
    """Installs required packages from requirements.txt."""
    requirements_path = os.path.join(PROJECT_DIR, "requirements.txt")
    if not os.path.exists(requirements_path):
        print("[-] requirements.txt not found. Skipping dependency installation.")
        return
    
    print("[*] Installing/updating dependencies...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", requirements_path])
    print("[+] Dependencies installed successfully.")

def download_ffmpeg():
    """Downloads FFmpeg binary for Windows if not present."""
    if os.name != "nt":
        print("[*] Non-Windows OS detected. Please ensure 'ffmpeg' is installed via your package manager.")
        return
        
    ffmpeg_exe = os.path.join(BIN_DIR, "ffmpeg.exe")
    if os.path.exists(ffmpeg_exe):
        print("[+] FFmpeg binary already present in bin/")
        return
        
    os.makedirs(BIN_DIR, exist_ok=True)
    
    ffmpeg_zip_url = "https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v6.1/ffmpeg-6.1-win-64.zip"
    zip_path = os.path.join(BIN_DIR, "ffmpeg.zip")
    
    print(f"[*] Downloading FFmpeg from {ffmpeg_zip_url}...")
    try:
        urllib.request.urlretrieve(ffmpeg_zip_url, zip_path)
        print("[*] Extracting FFmpeg...")
        with zipfile.ZipFile(zip_path, "r") as zip_ref:
            zip_ref.extractall(BIN_DIR)
        os.remove(zip_path)
        print("[+] FFmpeg extracted to bin/ directory.")
    except Exception as e:
        print(f"[-] Failed to download FFmpeg: {e}")
        print("[-] Make sure you have an active internet connection or install FFmpeg manually.")

def download_hls():
    """Scarica hls.js UNA VOLTA in static/ (self-hosting), cosi' la pagina non
    contatta piu' una CDN esterna a ogni apertura (privacy: nessun tracker)."""
    dest = os.path.join(PROJECT_DIR, "static", "hls.min.js")
    try:
        if os.path.exists(dest) and os.path.getsize(dest) > 50000:
            return
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        url = "https://cdn.jsdelivr.net/npm/hls.js@1.5.8/dist/hls.min.js"
        print("[*] Scarico hls.js in locale (una volta sola)...")
        urllib.request.urlretrieve(url, dest)
        print("[+] hls.js self-hosted: nessun caricamento da CDN a runtime.")
    except Exception as e:
        print(f"[!] Impossibile scaricare hls.js ora: {e}")


def start_server():
    """Starts the FastAPI application using uvicorn."""
    # Add bin/ directory to PATH so subprocesses can find ffmpeg
    if os.path.exists(BIN_DIR):
        os.environ["PATH"] = BIN_DIR + os.pathsep + os.environ.get("PATH", "")
        print(f"[+] Added local bin/ directory to PATH: {BIN_DIR}")
        
    # Test if ffmpeg is now executable
    try:
        _cf = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000) if os.name == "nt" else 0
        subprocess.run(["ffmpeg", "-version"], stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL, creationflags=_cf)
        print("[+] FFmpeg verified and ready.")
    except FileNotFoundError:
        print("[!] Warning: FFmpeg could not be found. Downloads will fail unless FFmpeg is installed globally.")

    print("[*] Launching FastAPI local server...")
    import uvicorn
    import threading, webbrowser, time, socket
    dev = os.environ.get("SC_DEV") == "1"
    # SICUREZZA: di default il server ascolta SOLO su questo PC (127.0.0.1), cosi'
    # nessun altro dispositivo in rete puo' raggiungerlo. Per l'accesso da TV/
    # telefono sulla stessa rete, avviare con SC_LAN=1 (meno protetto).
    # Di default il server ascolta SOLO su questo PC (127.0.0.1). Se l'utente ha
    # attivato l'accesso da telefono/tablet (settings.json "lan_enabled") o
    # SC_LAN=1, ascolta su 0.0.0.0 (rete locale) — protetto da token.
    bind_host = "127.0.0.1"
    try:
        import json as _json
        with open(os.path.join(PROJECT_DIR, "settings.json"), "r", encoding="utf-8") as _f:
            if _json.load(_f).get("lan_enabled"):
                bind_host = "0.0.0.0"
    except Exception:
        pass
    if os.environ.get("SC_LAN") == "1":
        bind_host = "0.0.0.0"
    url = "http://localhost:8082"

    # If a previous instance is still listening, just open the browser instead of
    # failing to bind (so re-launching the shortcut never gets "stuck").
    def _port_in_use(port):
        sk = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            sk.settimeout(0.5)
            return sk.connect_ex(("127.0.0.1", port)) == 0
        except Exception:
            return False
        finally:
            sk.close()

    if _port_in_use(8082):
        print("[i] SC Portal risulta gia' attivo: apro il browser.")
        try:
            webbrowser.open(url)
        except Exception:
            pass
        return

    if not dev:
        def _open_browser():
            time.sleep(2.5)
            try:
                webbrowser.open(url)
            except Exception:
                pass
        threading.Thread(target=_open_browser, daemon=True).start()
    print("\n" + "=" * 50)
    print("  SC Portal e' attivo:  " + url)
    print("  Si aprira' da solo nel browser tra pochi secondi.")
    print("  Per CHIUDERE: usa il pulsante Spegni nella piattaforma.")
    print("=" * 50 + "\n")
    # Start the server (api.py contains the FastAPI 'app'). Auto-reload only in
    # dev mode (set SC_DEV=1); disabled for the normal one-click app launch.
    try:
        uvicorn.run("api:app", host=bind_host, port=8082, reload=dev)
    except OSError as e:
        # Port busy / transient bind error: wait briefly and retry once.
        print(f"[!] Avvio non riuscito ({e}); riprovo tra 2s...")
        time.sleep(2)
        uvicorn.run("api:app", host=bind_host, port=8082, reload=dev)

def deps_ok():
    """True se le dipendenze chiave sono gia' installate (cosi' a ogni riavvio
    NON rilanciamo pip: l'avvio resta veloce e funziona anche offline)."""
    try:
        import uvicorn, fastapi, requests, bs4, m3u8, qrcode  # noqa: F401
        return True
    except Exception:
        return False


if __name__ == "__main__":
    _ensure_streams()
    try:
        if not check_venv():
            bootstrap_venv()
        else:
            # Installazione SOLO se manca qualcosa; mai fatale (con pythonw non
            # c'e' console: un errore non deve impedire l'avvio del server).
            if not deps_ok():
                try:
                    install_dependencies()
                except Exception as e:
                    print(f"[!] Installazione dipendenze non riuscita: {e}")
            try:
                download_ffmpeg()
            except Exception as e:
                print(f"[!] FFmpeg non disponibile ora: {e}")
            try:
                download_hls()
            except Exception as e:
                print(f"[!] hls.js non scaricato ora: {e}")
            start_server()
    except Exception:
        import traceback
        traceback.print_exc()
        try:
            with open(LOG_FILE, "a", encoding="utf-8") as lf:
                lf.write("\n[CRASH avvio]\n")
                traceback.print_exc(file=lf)
        except Exception:
            pass
