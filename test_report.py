import requests
from bs4 import BeautifulSoup
import traceback

url = "https://streamingcommunity.report"
headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

try:
    print(f"[*] Requesting {url}...")
    resp = requests.get(url, headers=headers, timeout=10, verify=False)
    print(f"[+] Status code: {resp.status_code}")
    print(f"[+] Final URL: {resp.url}")
except Exception as e:
    print("[-] Exception occurred:")
    traceback.print_exc()
