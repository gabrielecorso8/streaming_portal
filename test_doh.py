import requests
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# 1. Resolve domain using Cloudflare DNS-over-HTTPS (DoH)
domain = "streamingcommunity.co"
doh_url = f"https://cloudflare-dns.com/dns-query?name={domain}&type=A"
headers_doh = {"Accept": "application/dns-json"}

try:
    print(f"[*] Resolving {domain} via DoH...")
    r = requests.get(doh_url, headers=headers_doh, timeout=5)
    dns_data = r.json()
    answers = dns_data.get("Answer", [])
    if not answers:
        print("[-] No DNS records found.")
        exit(0)
        
    real_ip = answers[0].get("data")
    print(f"[+] Real IP of {domain} is: {real_ip}")
    
    # 2. Make request to the real IP with Host header!
    # Disable SSL verification since the certificate is for the domain, not the IP,
    # and requests will raise an error unless we pass the Host header.
    # Note: requests doesn't support SNI with IP out-of-the-box easily,
    # but we can pass verify=False and Host header.
    url = f"https://{real_ip}/"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Host": domain
    }
    
    print(f"[*] Requesting {url} with Host={domain}...")
    resp = requests.get(url, headers=headers, timeout=10, verify=False)
    print(f"[+] Status code: {resp.status_code}")
    print(f"[+] Final URL: {resp.url}")
    print(f"[+] Response length: {len(resp.text)}")
    print(resp.text[:500])
    
except Exception as e:
    print("[-] Exception:")
    import traceback
    traceback.print_exc()
