import requests
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

suffixes = ["computer", "broker", "vet", "fun", "rocks", "care", "vip", "cfd", "co", "ink", "party"]
headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

for s in suffixes:
    url = f"https://streamingcommunity.{s}"
    try:
        resp = requests.get(url, headers=headers, timeout=5, verify=False)
        print(f"[*] Suffix: .{s} -> Status: {resp.status_code}")
        if resp.status_code == 200:
            if "AVVISO" in resp.text or "AGCOM" in resp.text:
                print(f"  [-] Blocked by AGCOM.")
            else:
                print(f"  [+] UNBLOCKED! Title snippet: {resp.text[:100].strip()}")
        else:
            print(f"  [-] Non-200 status.")
    except Exception as e:
        print(f"[*] Suffix: .{s} -> Failed: {e}")
