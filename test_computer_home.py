import requests
from bs4 import BeautifulSoup
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

url = "https://streamingcommunity.computer"
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
        print("[+] Found app div!")
        data_page = app_div.get("data-page")
        if data_page:
            print(f"[+] data-page length: {len(data_page)}")
            import json
            page_data = json.loads(data_page)
            print(f"[+] Version: {page_data.get('version')}")
    else:
        print("[-] app div not found.")
        print(resp.text[:1000])
        
except Exception as e:
    print("[-] Exception occurred:")
    import traceback
    traceback.print_exc()
