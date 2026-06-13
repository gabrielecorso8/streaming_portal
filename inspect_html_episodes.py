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
    
    # Search for all tags with data-episode or data-season or play2
    elements = soup.find_all(attrs={"data-episode": True})
    print(f"[+] Found {len(elements)} elements with data-episode attribute.")
    for i, el in enumerate(elements[:15]):
        print(f"  El {i}: tag={el.name}, class={el.get('class')}, season={el.get('data-season')}, ep={el.get('data-episode')}, text={el.text.strip()[:100]}")
        
    play2_elements = soup.find_all(class_=lambda x: x and "play2" in x)
    print(f"[+] Found {len(play2_elements)} elements with 'play2' in class.")
    for i, el in enumerate(play2_elements[:15]):
        print(f"  El {i}: tag={el.name}, class={el.get('class')}, attrs={el.attrs}, text={el.text.strip()[:100]}")
        
except Exception as e:
    print("[-] Exception occurred:")
    import traceback
    traceback.print_exc()
