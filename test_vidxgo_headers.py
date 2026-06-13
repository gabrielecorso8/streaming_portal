import requests

def test_request(headers, label):
    try:
        resp = requests.get("https://v.vidxgo.co/0944947", headers=headers, timeout=5)
        print(f"[{label}] Status: {resp.status_code}, Length: {len(resp.text)}")
        if resp.status_code == 200:
            print(f"    Success! Found: {'.m3u8' in resp.text}")
    except Exception as e:
        print(f"[{label}] Error: {e}")

# Test 1: Chrome headers
chrome_headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://streaming-community.watch/"
}
test_request(chrome_headers, "Chrome Headers - watch domain Referer")

# Test 2: No Referer
test_request({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}, "No Referer")

# Test 3: Referer is vidxgo itself
test_request({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://v.vidxgo.co/"
}, "Referer vidxgo")

# Test 4: Minimal headers
test_request({}, "No headers")
