import requests
from bs4 import BeautifulSoup
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

url = "https://streaming-community.watch"
headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

try:
    print(f"[*] Requesting {url}...")
    resp = requests.get(url, headers=headers, timeout=10, verify=False)
    
    soup = BeautifulSoup(resp.text, "lxml")
    
    # Search for form action
    forms = soup.find_all("form")
    print(f"[+] Found {len(forms)} forms.")
    for i, f in enumerate(forms):
        print(f"  Form {i}: action={f.get('action')}, method={f.get('method')}")
        inputs = f.find_all("input")
        for inp in inputs:
            print(f"    Input: name={inp.get('name')}, type={inp.get('type')}, id={inp.get('id')}")
            
except Exception as e:
    print("[-] Exception occurred:")
    import traceback
    traceback.print_exc()
