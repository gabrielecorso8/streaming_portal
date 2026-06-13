import requests
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

suffixes = ["broker", "fun", "rocks", "care", "vip", "cfd", "ink"]
headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

for s in suffixes:
    url = f"https://streamingcommunity.{s}/api/search?q=trono%20di%20spade"
    try:
        resp = requests.get(url, headers=headers, timeout=5, verify=False)
        print(f"[*] Suffix: .{s} -> Status: {resp.status_code}")
        # Check if it has FingerprintJS or if it is a clean search result
        if resp.status_code == 200:
            if "fingerprint" in resp.text:
                print("  [-] Has FingerprintJS protection.")
            elif "data" in resp.json():
                print(f"  [+] Clean Search API works! Results count: {len(resp.json().get('data', []))}")
            else:
                print("  [-] Unknown JSON structure.")
        else:
            # Check if it's the AGCOM block (which is status 200 or 404/403 depending on ISP, usually 200 or redirect)
            print(f"  [-] Response content snippet: {resp.text[:150].strip()}")
    except Exception as e:
        print(f"[*] Suffix: .{s} -> Failed: {e}")
