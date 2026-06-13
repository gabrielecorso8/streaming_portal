import requests
from bs4 import BeautifulSoup
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

url = "https://streaming-community.watch/titles/24932-guarda-visualizza-game-of-thrones-il-trono-di-spade-5.html"
headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

try:
    print(f"[*] Requesting {url}...")
    resp = requests.get(url, headers=headers, timeout=10, verify=False)
    
    soup = BeautifulSoup(resp.text, "lxml")
    
    # Let's search for season buttons or dropdowns
    seasons = soup.find_all(class_=lambda x: x and ("season" in x or "stagion" in x))
    print(f"[+] Found {len(seasons)} elements related to seasons.")
    for i, s in enumerate(seasons[:10]):
        print(f"  Season element {i}: tag={s.name}, class={s.get('class')}, text={s.text.strip()}")
        
    # Let's search for links containing "watching.html" or "episode" or "watch"
    links = soup.find_all("a")
    watching_links = [l for l in links if l.get("href") and "watching" in l.get("href")]
    print(f"[+] Found {len(watching_links)} links containing 'watching'.")
    for i, l in enumerate(watching_links[:10]):
        print(f"  Link {i}: href={l.get('href')}, text={l.text.strip()}")
        
except Exception as e:
    print("[-] Exception occurred:")
    import traceback
    traceback.print_exc()
