"""Entry point per l'eseguibile standalone (.exe) di SC Portal.

Avvia il server FastAPI, scarica FFmpeg al primo avvio se manca e apre il
browser. I dati (libreria, impostazioni, copertine, download) vengono salvati
ACCANTO all'eseguibile, cosi' restano persistenti tra gli avvii.
"""
import os
import sys
import time
import threading
import webbrowser
import json

BASE = os.path.dirname(sys.executable) if getattr(sys, "frozen", False) \
    else os.path.dirname(os.path.abspath(__file__))


def ensure_ffmpeg():
    """Garantisce che ffmpeg sia disponibile (lo scarica una volta sola)."""
    bin_dir = os.path.join(BASE, "bin")
    ffmpeg_exe = os.path.join(bin_dir, "ffmpeg.exe")
    if not os.path.exists(ffmpeg_exe):
        try:
            import urllib.request
            import zipfile
            os.makedirs(bin_dir, exist_ok=True)
            url = ("https://github.com/ffbinaries/ffbinaries-prebuilt/releases/"
                   "download/v6.1/ffmpeg-6.1-win-64.zip")
            zip_path = os.path.join(bin_dir, "ffmpeg.zip")
            print("[*] Scarico FFmpeg (solo al primo avvio)...")
            urllib.request.urlretrieve(url, zip_path)
            with zipfile.ZipFile(zip_path, "r") as z:
                z.extractall(bin_dir)
            os.remove(zip_path)
            print("[+] FFmpeg pronto.")
        except Exception as e:
            print("[!] Impossibile scaricare FFmpeg automaticamente:", e)
    os.environ["PATH"] = bin_dir + os.pathsep + os.environ.get("PATH", "")


def open_browser():
    time.sleep(2.5)
    try:
        webbrowser.open("http://localhost:8082")
    except Exception:
        pass


def ensure_streams():
    """L'.exe windowed (console=False) ha sys.stdout/stderr None: senza questo
    il primo print() farebbe crashare l'avvio in silenzio."""
    if sys.stdout is not None and sys.stderr is not None:
        return
    try:
        f = open(os.path.join(BASE, "server.log"), "a", buffering=1,
                 encoding="utf-8", errors="replace")
    except Exception:
        f = open(os.devnull, "w")
    if sys.stdout is None:
        sys.stdout = f
    if sys.stderr is None:
        sys.stderr = f


def main():
    ensure_streams()
    os.chdir(BASE)
    ensure_ffmpeg()
    threading.Thread(target=open_browser, daemon=True).start()
    print("=" * 52)
    print("   SC Portal e' attivo:  http://localhost:8082")
    print("   Si aprira' da solo nel browser.")
    print("   Per CHIUDERE l'app: chiudi questa finestra.")
    print("=" * 52)
    import uvicorn
    import api
    bind_host = "127.0.0.1"
    try:
        with open(os.path.join(BASE, "settings.json"), "r", encoding="utf-8") as f:
            if json.load(f).get("lan_enabled"):
                bind_host = "0.0.0.0"
    except Exception:
        pass
    if os.environ.get("SC_LAN") == "1":
        bind_host = "0.0.0.0"
    uvicorn.run(api.app, host=bind_host, port=8082, reload=False)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        import traceback
        try:
            with open(os.path.join(BASE, "server.log"), "a", encoding="utf-8") as lf:
                lf.write("\n[CRASH avvio exe]\n")
                traceback.print_exc(file=lf)
        except Exception:
            pass
