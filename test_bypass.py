import requests
import re
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

session = requests.Session()
session.verify = False

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

try:
    print("[*] Requesting homepage to get uuid...")
    resp = session.get("https://streamingcommunity.computer", headers=headers, timeout=10)
    print(f"[+] Status code: {resp.status_code}")
    
    # Try to extract the redirect link
    match = re.search(r"var redirect_link = '([^']+)';", resp.text)
    if match:
        redirect_url = match.group(1)
        print(f"[+] Found redirect link: {redirect_url}")
        
        # Call the redirect URL with a dummy fp value
        full_redirect = redirect_url + "fp=1234567890abcdef"
        print(f"[*] Requesting redirect: {full_redirect}...")
        resp2 = session.get(full_redirect, headers=headers, timeout=10)
        print(f"[+] Redirect status: {resp2.status_code}")
        print(f"[+] Final redirect URL: {resp2.url}")
        print(f"[+] Session cookies: {session.cookies.get_dict()}")
        
        # Now try to call the search API!
        search_url = "https://streamingcommunity.computer/api/search?q=trono%20di%20spade"
        print(f"[*] Requesting search: {search_url}...")
        resp_search = session.get(search_url, headers=headers, timeout=10)
        print(f"[+] Search status: {resp_search.status_code}")
        if resp_search.status_code == 200:
            print("[+] Search succeeded! Results:")
            print(resp_search.json().get("data", [])[:2])
        else:
            print(f"[-] Search failed: {resp_search.text[:500]}")
            
    else:
        print("[-] Redirect link not found.")
        print(resp.text[:500])
        
except Exception as e:
    print("[-] Exception:")
    import traceback
    traceback.print_exc()
