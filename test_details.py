import requests
from bs4 import BeautifulSoup
import traceback

url = "https://streaming-community.watch/titles/24932-guarda-visualizza-game-of-thrones-il-trono-di-spade-5/watching.html"
headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

try:
    print(f"[*] Requesting {url}...")
    resp = requests.get(url, headers=headers, timeout=10)
    
    soup = BeautifulSoup(resp.text, "lxml")
    iframe = soup.find("iframe")
    if iframe:
        print(f"[+] Found iframe: {iframe.attrs}")
    else:
        print("[-] No iframe found directly.")
        
    scripts = soup.find_all("script")
    print(f"[+] Found {len(scripts)} scripts.")
    for i, scr in enumerate(scripts):
        src = scr.get("src")
        if src:
            print(f"  Script {i} src: {src}")
        else:
            text = scr.text
            if "video" in text or "player" in text or "vix" in text:
                print(f"  Script {i} snippet (has video/player/vix):\n{text[:500]}")
                
except Exception as e:
    print("[-] Exception occurred:")
    traceback.print_exc()
