import requests
from bs4 import BeautifulSoup
import traceback

url = "https://v.vidxgo.co/0944947"
headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://streaming-community.watch/titles/24932-guarda-visualizza-game-of-thrones-il-trono-di-spade-5/watching.html"
}

try:
    print(f"[*] Requesting {url}...")
    resp = requests.get(url, headers=headers, timeout=10)
    print(f"[+] Status code: {resp.status_code}")
    print(f"[+] Final URL: {resp.url}")
    print(f"[+] Content-Type: {resp.headers.get('Content-Type')}")
    
    # print first 1500 chars of HTML
    print(resp.text[:1500])
    
except Exception as e:
    print("[-] Exception occurred:")
    traceback.print_exc()
