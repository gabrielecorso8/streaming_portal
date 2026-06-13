import requests
import json
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

url = "https://streamingcommunity.co/api/search?q=trono%20di%20spade"
headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

try:
    print(f"[*] Searching on streamingcommunity.co...")
    resp = requests.get(url, headers=headers, timeout=10, verify=False)
    print(f"[+] Status code: {resp.status_code}")
    if resp.status_code == 200:
        data = resp.json().get("data", [])
        for item in data[:5]:
            print(f"  - ID: {item.get('id')}, Name: {item.get('name')}, Slug: {item.get('slug')}, Type: {item.get('type')}")
    else:
        print(f"[-] Search failed: {resp.text}")
except Exception as e:
    print("[-] Exception occurred:")
    import traceback
    traceback.print_exc()
