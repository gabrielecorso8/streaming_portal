import requests
import time

base_url = "http://127.0.0.1:8082"

payload = {
    "title": "TestMuxStream",
    "m3u8_video": "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
    "m3u8_audio": None,
    "key_info": None
}

print("[*] Triggering download task...")
resp = requests.post(f"{base_url}/api/download", json=payload)
print(f"Status: {resp.status_code}")
if resp.status_code == 200:
    data = resp.json()
    download_id = data.get("download_id")
    print(f"[+] Started download: {download_id}")
    
    # Poll status
    for i in range(30):
        time.sleep(2)
        status_resp = requests.get(f"{base_url}/api/download/status")
        if status_resp.status_code == 200:
            tasks = status_resp.json()
            task = next((t for t in tasks if t["id"] == download_id), None)
            if task:
                print(f"[{i}] Status: {task['status']}, Progress: {task['progress']}%, Error: {task['error']}")
                if task["status"] in ["completed", "failed"]:
                    break
            else:
                print(f"[{i}] Task not found in active downloads list")
        else:
            print(f"[{i}] Error fetching status: {status_resp.text}")
else:
    print(f"Error: {resp.text}")
