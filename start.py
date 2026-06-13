import os
import sys
import subprocess
import urllib.request
import zipfile
import shutil

PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
VENV_DIR = os.path.join(PROJECT_DIR, "venv")
BIN_DIR = os.path.join(PROJECT_DIR, "bin")

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

def start_server():
    """Starts the FastAPI application using uvicorn."""
    # Add bin/ directory to PATH so subprocesses can find ffmpeg
    if os.path.exists(BIN_DIR):
        os.environ["PATH"] = BIN_DIR + os.pathsep + os.environ.get("PATH", "")
        print(f"[+] Added local bin/ directory to PATH: {BIN_DIR}")
        
    # Test if ffmpeg is now executable
    try:
        subprocess.run(["ffmpeg", "-version"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print("[+] FFmpeg verified and ready.")
    except FileNotFoundError:
        print("[!] Warning: FFmpeg could not be found. Downloads will fail unless FFmpeg is installed globally.")

    print("[*] Launching FastAPI local server...")
    import uvicorn
    # Start the server (api.py contains the FastAPI application 'app')
    uvicorn.run("api:app", host="127.0.0.1", port=8082, reload=True)

if __name__ == "__main__":
    if not check_venv():
        bootstrap_venv()
    else:
        install_dependencies()
        download_ffmpeg()
        start_server()
