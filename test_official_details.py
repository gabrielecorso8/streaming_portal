import requests
from bs4 import BeautifulSoup
import traceback
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

url = "https://streamingcommunity.report/titles/24932"
headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

try:
    print(f"[*] Requesting {url}...")
    resp = requests.get(url, headers=headers, timeout=10, verify=False)
    print(f"[+] Status code: {resp.status_code}")
    print(f"[+] Final URL: {resp.url}")
    
    soup = BeautifulSoup(resp.text, "lxml")
    app_div = soup.find("div", {"id": "app"})
    if app_div:
        print("[+] Found app div on official site!")
        import json
        page_data = json.loads(app_div.get("data-page"))
        title_info = page_data.get("props", {}).get("title", {})
        print(f"[+] Title: {title_info.get('name')}")
        print(f"[+] Slug: {title_info.get('slug')}")
        print(f"[+] Type: {title_info.get('type')}")
        print(f"[+] Seasons Count: {title_info.get('seasons_count')}")
    else:
        print("[-] App div not found on official site!")
        
except Exception as e:
    print("[-] Exception occurred:")
    traceback.print_exc()
