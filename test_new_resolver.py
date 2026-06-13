import requests

base_url = "http://127.0.0.1:8082"

def test_resolve(url, description):
    print(f"\n--- Testing: {description} ---")
    print(f"URL: {url}")
    try:
        resp = requests.post(f"{base_url}/api/resolve-url", json={"url": url}, timeout=10)
        print(f"Status: {resp.status_code}")
        if resp.status_code == 200:
            print("Response JSON:")
            import pprint
            pprint.pprint(resp.json())
        else:
            print(f"Error: {resp.text}")
    except Exception as e:
        print(f"Exception: {e}")

# Test 1: Direct stream URL
test_resolve(
    "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
    "Direct HLS Stream (.m3u8)"
)

# Test 2: VidxGo URL
test_resolve(
    "https://v.vidxgo.co/0944947",
    "VidxGo URL"
)

# Test 3: Clone site watching URL
test_resolve(
    "https://streaming-community.watch/titles/24932-guarda-visualizza-game-of-thrones-il-trono-di-spade-5/watching.html",
    "Clone Site URL"
)
