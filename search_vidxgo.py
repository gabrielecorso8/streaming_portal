import os

keywords = ["vidxgo", "vixcloud", "aes", "m3u8"]
for root, dirs, files in os.walk("."):
    if "venv" in root or "__pycache__" in root or ".git" in root:
        continue
    for file in files:
        if file.endswith(".py") or file.endswith(".js") or file.endswith(".html"):
            path = os.path.join(root, file)
            try:
                with open(path, "r", encoding="utf-8") as f:
                    content = f.read()
                    for kw in keywords:
                        if kw in content:
                            print(f"[+] Found '{kw}' in {path}")
            except Exception:
                pass
