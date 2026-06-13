import requests
from bs4 import BeautifulSoup
import traceback

url = "https://streaming-community.watch/titles/24932-guarda-visualizza-game-of-thrones-il-trono-di-spade-5.html"
headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

try:
    print(f"[*] Requesting {url}...")
    resp = requests.get(url, headers=headers, timeout=10)
    print(f"[+] Status code: {resp.status_code}")
    
    soup = BeautifulSoup(resp.text, "lxml")
    app_div = soup.find("div", {"id": "app"})
    if app_div:
        print(f"[+] app_div attributes: {app_div.attrs}")
        data_page = app_div.get("data-page")
        if data_page:
            print(f"[+] Found data-page! Length: {len(data_page)}")
            print(data_page[:500])
        else:
            print("[-] No data-page attribute on app_div.")
            # Print first 1000 characters of app_div inner HTML
            print(app_div.encode_contents()[:1000])
            
except Exception as e:
    print("[-] Exception occurred:")
    traceback.print_exc()
