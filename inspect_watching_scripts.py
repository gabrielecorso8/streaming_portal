import requests
from bs4 import BeautifulSoup
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

url = "https://streaming-community.watch/titles/24932-guarda-visualizza-game-of-thrones-il-trono-di-spade-5/watching.html"
headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

try:
    print(f"[*] Requesting {url}...")
    resp = requests.get(url, headers=headers, timeout=10, verify=False)
    
    soup = BeautifulSoup(resp.text, "lxml")
    scripts = soup.find_all("script")
    print(f"[+] Found {len(scripts)} scripts.")
    for i, scr in enumerate(scripts):
        if not scr.get("src"):
            text = scr.text
            print(f"--- Script {i} (length: {len(text)}) ---")
            print(text[:1000].strip())
            print("-----------------------------------")
            
except Exception as e:
    print("[-] Exception occurred:")
    import traceback
    traceback.print_exc()
