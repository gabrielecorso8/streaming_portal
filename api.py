import os
import re
import json
import urllib.parse
import uuid
import requests
import urllib3
from bs4 import BeautifulSoup
from fastapi import FastAPI, HTTPException, BackgroundTasks, Query
from fastapi.responses import Response, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import urllib3.util.connection as connection
from concurrent.futures import ThreadPoolExecutor, as_completed

# Disable SSL verification warnings
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# --- DNS-over-HTTPS (DoH) Patching ---
def resolve_doh(host):
    # Cloudflare DoH
    try:
        url = f"https://cloudflare-dns.com/dns-query?name={host}&type=A"
        r = requests.get(url, headers={"Accept": "application/dns-json"}, timeout=3)
        if r.status_code == 200:
            answers = r.json().get("Answer", [])
            for ans in answers:
                if ans.get("type") == 1:
                    return ans.get("data")
    except Exception:
        pass
        
    # Google DoH fallback
    try:
        url = f"https://dns.google/resolve?name={host}&type=A"
        r = requests.get(url, timeout=3)
        if r.status_code == 200:
            answers = r.json().get("Answer", [])
            for ans in answers:
                if ans.get("type") == 1:
                    return ans.get("data")
    except Exception:
        pass
    return None

def patched_create_connection(address, *args, **kwargs):
    host, port = address
    if "streamingcommunity" in host or "vixcloud" in host:
        try:
            resolved_ip = resolve_doh(host)
            if resolved_ip:
                print(f"[DoH] Patched {host} -> {resolved_ip}")
                return connection.real_create_connection((resolved_ip, port), *args, **kwargs)
        except Exception as e:
            print(f"[DoH] Patched resolution failed for {host}: {e}")
    return connection.real_create_connection(address, *args, **kwargs)

if not hasattr(connection, 'real_create_connection'):
    connection.real_create_connection = connection.create_connection
    connection.create_connection = patched_create_connection
# -------------------------------------

from downloader import start_download_task, active_downloads, download_paths
import vidxgo
import subprocess
import sys

app = FastAPI(title="StreamingCommunity Unofficial Portal")

# CORS Setup
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
SETTINGS_FILE = os.path.join(PROJECT_DIR, "settings.json")
DOWNLOADS_DIR = os.path.join(PROJECT_DIR, "downloads")

# Global session with SSL verification disabled
session = requests.Session()
session.verify = False

# Load Settings
def load_settings():
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, "r") as f:
                return json.load(f)
        except Exception:
            pass
    return {"domain": "computer"}

def save_settings(settings):
    with open(SETTINGS_FILE, "w") as f:
        json.dump(settings, f, indent=4)

def detect_active_domain():
    # StreamingCommunity rotates its TLD frequently and individual domains get
    # seized (AGCOM / Piracy Shield) or parked. We probe a broad list of known
    # suffixes and only accept one that actually serves the working JSON API.
    suffixes = [
        "computer", "broker", "vet", "fun", "rocks", "care", "vip", "cfd", "co",
        "ink", "party", "club", "watch", "live", "blog", "art", "best", "one",
        "forum", "store", "photos", "buzz", "bar", "boats", "build", "cab",
        "cyou", "icu", "wiki", "world", "today", "site", "online", "space",
    ]
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }

    # Markers of a seized / blocked / parked page (case-insensitive).
    block_markers = ("avviso", "agcom", "sequestro", "guardia di finanza",
                     "polizia", "redirect_link", "fingerprintjs", "expireddomains")

    def test_suffix(suffix):
        domain = f"streamingcommunity.{suffix}"
        base = f"https://{domain}"
        try:
            # The definitive test: does the real Inertia API answer with JSON?
            resp = requests.get(f"{base}/api/search?q=a", headers=headers,
                                timeout=6, verify=False)
            if resp.status_code != 200:
                return None
            text_low = resp.text.lower()
            if any(m in text_low for m in block_markers):
                return None
            data = resp.json()  # raises if the page is HTML (block/park page)
            if isinstance(data, dict) and "data" in data:
                return suffix
        except Exception:
            pass
        return None

    print("[*] Detecting active StreamingCommunity domain suffix (verifying live API)...")
    found = []
    with ThreadPoolExecutor(max_workers=min(16, len(suffixes))) as executor:
        futures = {executor.submit(test_suffix, s): s for s in suffixes}
        for future in as_completed(futures):
            res = future.result()
            if res:
                print(f"[+] Verified working domain suffix: .{res}")
                found.append(res)
    if found:
        # Prefer the suffix that currently holds the live API.
        return found[0]
    print("[!] No working StreamingCommunity domain found (all seized/parked). "
          "Paste a working title URL to set the domain manually.")
    return None

SETTINGS = load_settings()

@app.on_event("startup")
def startup_event():
    # Honour settings.json "proxy" / SC_PROXY before serving any request.
    apply_proxies()

    def run_detection():
        global SETTINGS
        active_suffix = detect_active_domain()
        if active_suffix:
            SETTINGS["domain"] = active_suffix
            save_settings(SETTINGS)
            print(f"[+] Startup auto-detected active domain: {active_suffix}")
        else:
            print("[!] Startup domain detection finished, using default settings.")
            
    import threading
    thread = threading.Thread(target=run_detection)
    thread.daemon = True
    thread.start()

def get_base_url():
    domain = SETTINGS["domain"]
    if "." in domain:
        return f"https://{domain}"
    else:
        return f"https://streamingcommunity.{domain}"

def get_proxies():
    """Optional proxy for vidxgo/CDN traffic. Read from settings.json ("proxy")
    or the SC_PROXY env var. Needed when a CDN node hosting an episode is
    IP-blocked by the ISP (Piracy Shield / AGCOM) — the IP is alive worldwide
    but dropped on the local connection, so the download times out. Routing
    those fetches through a proxy/VPN restores reachability.
    Accepts e.g. 'socks5://127.0.0.1:1080' or 'http://user:pass@host:port'.
    Returns a requests-style proxies dict, or None for a direct connection."""
    proxy = (SETTINGS.get("proxy") or os.environ.get("SC_PROXY") or "").strip()
    if not proxy:
        return None
    return {"http": proxy, "https": proxy}

def apply_proxies():
    """Push the current proxy config into the vidxgo resolver module."""
    vidxgo.set_proxies(get_proxies())

def get_headers():
    return {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }

# JS Object parser helper
def clean_js_to_json(js_str):
    # Remove comments
    js_str = re.sub(r'//.*', '', js_str)
    js_str = re.sub(r'/\*[\s\S]*?\*/', '', js_str)
    
    # Replace single quotes with double quotes
    js_str = js_str.replace("'", '"')
    
    # Quote unquoted keys
    js_str = re.sub(r'([{,]\s*)([a-zA-Z0-9_]+)(\s*):', r'\1"\2"\3:', js_str)
    
    # Remove trailing commas
    js_str = re.sub(r',\s*}', '}', js_str)
    js_str = re.sub(r',\s*\]', ']', js_str)
    
    try:
        return json.loads(js_str)
    except Exception:
        return None

def extract_js_object(text, keyword):
    idx = text.find(keyword)
    if idx == -1:
        return None
    brace_idx = text.find('{', idx)
    if brace_idx == -1:
        return None
    
    brace_count = 1
    for i in range(brace_idx + 1, len(text)):
        if text[i] == '{':
            brace_count += 1
        elif text[i] == '}':
            brace_count -= 1
            if brace_count == 0:
                return text[brace_idx:i+1]
    return None

class SettingsUpdate(BaseModel):
    # Omit (or leave empty) to keep the current domain unchanged.
    domain: Optional[str] = None
    # Optional proxy (e.g. "socks5://127.0.0.1:1080") to reach CDN nodes blocked
    # by the ISP. Empty string clears it. Omit to leave the current value as-is.
    proxy: Optional[str] = None

class ResolveUrlRequest(BaseModel):
    url: str

class DownloadRequest(BaseModel):
    title: str
    m3u8_video: str
    m3u8_audio: Optional[str] = None
    key_info: Optional[dict] = None
    stream_headers: Optional[dict] = None
    vidxgo: Optional[dict] = None

@app.get("/api/settings")
def get_settings():
    return SETTINGS

@app.post("/api/settings")
def update_settings(payload: SettingsUpdate):
    if payload.domain is not None and payload.domain.strip():
        SETTINGS["domain"] = payload.domain.strip().strip(".")
    if payload.proxy is not None:
        SETTINGS["proxy"] = payload.proxy.strip()
        apply_proxies()
    save_settings(SETTINGS)
    return SETTINGS

@app.get("/api/search")
def search(q: str):
    base_url = get_base_url()
    url = f"{base_url}/api/search?q={urllib.parse.quote(q)}"
    try:
        resp = session.get(url, headers=get_headers(), timeout=10)
        if resp.status_code == 200:
            data = resp.json().get("data", [])
            # Map search results and truncate to 20 items
            results = []
            for item in data[:20]:
                results.append({
                    "id": item.get("id"),
                    "name": item.get("name"),
                    "slug": item.get("slug"),
                    "type": item.get("type"),
                    "cover": item.get("images", {}).get("poster") or item.get("images", {}).get("cover")
                })
            return results
        else:
            raise HTTPException(status_code=resp.status_code, detail="Failed search request")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/details/{id_and_slug}")
def get_details(id_and_slug: str):
    if id_and_slug.startswith("clone-"):
        # For clone contents, details are loaded directly during URL resolution
        raise HTTPException(status_code=400, detail="Cannot load details directly for clone titles")
        
    base_url = get_base_url()
    url = f"{base_url}/titles/{id_and_slug}"
    try:
        resp = session.get(url, headers=get_headers(), timeout=10)
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail="Content not found")
        
        soup = BeautifulSoup(resp.text, "lxml")
        app_div = soup.find("div", {"id": "app"})
        if not app_div:
            raise HTTPException(status_code=500, detail="Unable to extract page state")
            
        page_data = json.loads(app_div.get("data-page"))
        title_info = page_data.get("props", {}).get("title", {})
        
        # Format general metadata
        details = {
            "id": title_info.get("id"),
            "name": title_info.get("name"),
            "slug": title_info.get("slug"),
            "type": title_info.get("type"),
            "plot": title_info.get("plot"),
            "score": title_info.get("score"),
            "release_date": title_info.get("release_date"),
            "runtime": title_info.get("runtime"),
            "genres": [g.get("name") for g in title_info.get("genres", [])],
            "cover": title_info.get("images", {}).get("poster") or title_info.get("images", {}).get("cover"),
            "seasons": [],
            "version": page_data.get("version")
        }
        
        if details["type"] == "tv":
            details["seasons"] = [
                {"number": s.get("number"), "episodes_count": s.get("episodes_count")}
                for s in title_info.get("seasons", [])
            ]
            
        return details
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/details/{id_and_slug}/season/{season_number}")
def get_season_episodes(id_and_slug: str, season_number: int, version: str):
    base_url = get_base_url()
    url = f"{base_url}/titles/{id_and_slug}/stagione-{season_number}"
    
    headers = get_headers()
    headers.update({
        'X-Inertia': 'true',
        'X-Inertia-Version': version,
    })
    
    try:
        resp = session.get(url, headers=headers, timeout=10)
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail="Season not found")
            
        data = resp.json()
        episodes = data.get("props", {}).get("loadedSeason", {}).get("episodes", [])
        
        results = []
        for ep in episodes:
            results.append({
                "id": ep.get("id"),
                "number": ep.get("number"),
                "name": ep.get("name"),
                "plot": ep.get("plot"),
                "duration": ep.get("duration"),
                "cover": ep.get("images", {}).get("poster") or ep.get("images", {}).get("cover")
            })
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

def build_vidxgo_response(iframe_url, referer, title, cover="", plot=""):
    """Resolve a vidxgo embed into a portal resolve-url response.

    Movies resolve straight to a downloadable stream. Series instead return the
    season catalogue (is_series + seasons) so the UI can present a season/episode
    picker; individual episodes are resolved later via /api/clone/download.
    """
    resolved_title = title
    base = {
        "is_clone": True,
        "title": resolved_title,
        "cover": cover,
        "plot": plot,
        "iframe_url": iframe_url,
        "stream_url": "",
        "stream_headers": {},
        "vidxgo": None,
        "is_series": False,
        "seasons": [],
    }
    try:
        print(f"[*] Resolving vidxgo embed: {iframe_url} ...")
        info = vidxgo.resolve_stream(iframe_url, referer)
        if not info:
            print("[-] vidxgo resolver returned nothing.")
            return base

        if info.get("title"):
            base["title"] = info["title"]
        if info.get("poster") and not cover:
            base["cover"] = info["poster"]

        if info["mode"] == "tv":
            base["is_series"] = True
            base["seasons"] = info.get("seasons", [])
            base["vidxgo"] = {
                "id": info["id"],
                "mode": "tv",
                "iframe_url": iframe_url,
                "tmdb_tv_id": info.get("tmdb_tv_id"),
            }
            print(f"[+] vidxgo series resolved -> {len(base['seasons'])} seasons")
        else:
            base["stream_url"] = info.get("variant_url") or ""
            base["stream_headers"] = info.get("headers", {})
            base["vidxgo"] = {
                "id": info["id"],
                "mode": info["mode"],
                "season": None,
                "episode": None,
                "iframe_url": iframe_url,
            }
            print(f"[+] vidxgo movie resolved -> {base['stream_url'][:80]}...")
    except Exception as e:
        print(f"[-] vidxgo resolution failed: {e}")
    return base


class CloneDownloadRequest(BaseModel):
    id: str
    iframe_url: str
    season: int
    episode: int
    title: Optional[str] = None
    mode: str = "tv"


@app.get("/api/clone/episodes")
def clone_episodes(tmdb_tv_id: int, season: int, iframe_url: str):
    """List episodes (names/plots) for a vidxgo series season."""
    try:
        return vidxgo.list_episodes(tmdb_tv_id, season, iframe_url)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/clone/download")
def clone_download(payload: CloneDownloadRequest):
    """Resolve a specific vidxgo episode and start its download."""
    try:
        info = vidxgo.resolve_episode(
            payload.id, payload.mode, payload.season, payload.episode, payload.iframe_url
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Risoluzione episodio fallita: {e}")
    if not info or not info.get("variant_url"):
        raise HTTPException(status_code=502, detail="Flusso episodio non disponibile")

    download_id = str(uuid.uuid4())
    title = payload.title or f"Episodio S{payload.season:02d}E{payload.episode:02d}"
    start_download_task(
        download_id=download_id,
        title=title,
        m3u8_video=info["variant_url"],
        m3u8_audio=None,
        key_info=None,
        extra_headers=info["headers"],
        vidxgo_meta={
            "id": payload.id,
            "mode": payload.mode,
            "season": payload.season,
            "episode": payload.episode,
            "iframe_url": payload.iframe_url,
        },
        proxies=get_proxies(),
    )
    return {"download_id": download_id}


@app.post("/api/resolve-url")
def resolve_url(payload: ResolveUrlRequest):
    url = payload.url.strip()
    parsed = urllib.parse.urlparse(url)
    path = parsed.path
    netloc = parsed.netloc.lower()
    
    # 1. Check if it's a direct stream URL (.m3u8, .mp4, .ts)
    is_direct = (
        path.lower().endswith(".m3u8") or 
        path.lower().endswith(".mp4") or 
        path.lower().endswith(".ts") or
        ".m3u8" in path.lower() or 
        ".mp4" in path.lower() or 
        ".ts" in path.lower() or
        ".m3u8" in parsed.query.lower() or 
        ".mp4" in parsed.query.lower() or 
        ".ts" in parsed.query.lower()
    )
    
    if is_direct:
        # Extract title from the path if possible
        title = "Direct Video Stream"
        match = re.search(r"/([^/]+)\.(?:m3u8|mp4|ts)", path)
        if match:
            title = urllib.parse.unquote(match.group(1))
            
        return {
            "is_clone": True,
            "title": title,
            "cover": "",
            "plot": "Flusso video diretto inserito manualmente.",
            "iframe_url": "",
            "stream_url": url,
            "id_and_slug": f"direct-{uuid.uuid4().hex[:8]}"
        }

    # 2. Check if it's a vidxgo URL
    if "vidxgo" in netloc or "vidxgo" in path.lower():
        resp_obj = build_vidxgo_response(
            iframe_url=url,
            referer=url,
            title="VidxGo Video",
            plot=("Video ospitato su VidxGo. Se l'estrazione automatica fallisce, "
                  "puoi incollare direttamente un link .m3u8/.mp4."),
        )
        resp_obj["id_and_slug"] = f"vidxgo-{uuid.uuid4().hex[:8]}"
        return resp_obj

    # Parse query parameters to extract episode_id
    query_params = urllib.parse.parse_qs(parsed.query)
    episode_id = query_params.get("e", [None])[0] or query_params.get("episode_id", [None])[0]
    if episode_id:
        try:
            episode_id = int(episode_id)
        except ValueError:
            episode_id = None
            
    if "streaming" not in netloc:
        raise HTTPException(status_code=400, detail="Invalid domain. Must be a StreamingCommunity link, a direct stream (.m3u8/.mp4) or a vidxgo URL.")
        
    is_clone = "watch" in netloc or "-" in netloc
    
    if is_clone:
        try:
            print(f"[*] Resolving clone site URL: {url}...")
            resp = session.get(url, headers=get_headers(), timeout=10)
            if resp.status_code == 200:
                soup = BeautifulSoup(resp.text, "lxml")
                
                # Extract Title
                title = "Contenuto"
                h1 = soup.find("h1")
                if h1:
                    title = h1.text.strip()
                else:
                    t_tag = soup.find("title")
                    if t_tag:
                        title = t_tag.text.replace("streaming", "").replace("guarda", "").replace("|", "").strip()
                        
                # Extract Cover
                cover = ""
                img = soup.find("img", class_="img-fluid")
                if img:
                    cover = img.get("src")
                    if cover and cover.startswith("/"):
                        cover = f"https://{netloc}{cover}"
                        
                # Extract plot
                plot = ""
                desc_div = soup.find("div", class_="desc")
                if desc_div:
                    plot = desc_div.text.strip()
                if not plot:
                    meta_desc = soup.find("meta", {"name": "description"})
                    if meta_desc:
                        plot = meta_desc.get("content")
                        
                # Scan watching page or current page for vidxgo.co iframe src
                iframe_url = ""
                iframe = soup.find("iframe", id="dle-player")
                if iframe and iframe.get("src"):
                    iframe_url = iframe.get("src")
                    
                if not iframe_url:
                    vidx_match = re.search(r"'(https://v\.vidxgo\.co/\d+)'", resp.text)
                    if vidx_match:
                        iframe_url = vidx_match.group(1)
                    else:
                        imdb_match = re.search(r"tt(\d+)", resp.text)
                        if imdb_match:
                            iframe_url = f"https://v.vidxgo.co/{imdb_match.group(1)}"
                            
                # If still not found and not on watching page, check watching.html
                if not iframe_url and not url.endswith("watching.html"):
                    watch_url = url.replace(".html", "") + "/watching.html"
                    print(f"[*] Checking clone watching page: {watch_url}")
                    watch_resp = session.get(watch_url, headers=get_headers(), timeout=10)
                    if watch_resp.status_code == 200:
                        vidx_match = re.search(r"'(https://v\.vidxgo\.co/\d+)'", watch_resp.text)
                        if vidx_match:
                            iframe_url = vidx_match.group(1)
                        else:
                            imdb_match = re.search(r"tt(\d+)", watch_resp.text)
                            if imdb_match:
                                iframe_url = f"https://v.vidxgo.co/{imdb_match.group(1)}"
                
                # Resolve the playable stream via the vidxgo resolver (handles
                # the obfuscated player + short-lived signed CDN tokens).
                resp_obj = build_vidxgo_response(
                    iframe_url=iframe_url,
                    referer=url,
                    title=title,
                    cover=cover,
                    plot=plot or "Nessuna descrizione disponibile.",
                )
                resp_obj["id_and_slug"] = f"clone-{uuid.uuid4().hex[:8]}"
                return resp_obj
        except Exception as e:
            print(f"[-] Error parsing clone: {e}")
            raise HTTPException(status_code=500, detail="Errore nell'analisi del sito clone")
            
    # Automatically update settings domain if user pastes a different active domain!
    if netloc != get_base_url().replace("https://", ""):
        SETTINGS["domain"] = netloc
        save_settings(SETTINGS)
        print(f"[+] Automatically updated active domain to: {netloc}")
        
    # Match: /titles/24932-guarda-visualizza...
    # We want to match: /titles/(\d+)-([^/]+)
    titles_match = re.search(r"/titles/(\d+)-([^/]+)", path)
    if titles_match:
        slug_part = titles_match.group(2)
        slug_part = slug_part.split("/")[0] # remove trailing parts if any (e.g. /watching.html)
        res = {"id_and_slug": f"{titles_match.group(1)}-{slug_part}"}
        if episode_id:
            res["episode_id"] = episode_id
            res["title_id"] = int(titles_match.group(1))
        return res
        
    # Match: /watch/(\d+)
    watch_match = re.search(r"/watch/(\d+)", path)
    if watch_match:
        title_id = int(watch_match.group(1))
        # Fetch the watch page to extract the title details
        try:
            resp = session.get(payload.url, headers=get_headers(), timeout=10)
            if resp.status_code == 200:
                soup = BeautifulSoup(resp.text, "lxml")
                app_div = soup.find("div", {"id": "app"})
                if app_div:
                    page_data = json.loads(app_div.get("data-page"))
                    title_info = page_data.get("props", {}).get("title", {})
                    slug = title_info.get("slug")
                    if slug:
                        res = {"id_and_slug": f"{title_id}-{slug}"}
                        if episode_id:
                            res["episode_id"] = episode_id
                            res["title_id"] = title_id
                        return res
        except Exception:
            pass
            
    raise HTTPException(status_code=400, detail="Unable to extract movie/series details from URL")

@app.get("/api/stream/url")
def get_stream_details(id: int, episode_id: Optional[int] = None):
    base_url = get_base_url()
    
    # 1. Fetch iframe url from streamingcommunity
    if episode_id:
        url = f"{base_url}/iframe/{id}?episode_id={episode_id}&next_episode=1"
    else:
        url = f"{base_url}/iframe/{id}"
        
    try:
        headers = get_headers()
        if episode_id:
            headers['Referer'] = f"{base_url}/watch/{id}?e={episode_id}"
            
        resp = session.get(url, headers=headers, timeout=10)
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail="Failed to fetch iframe page")
            
        soup = BeautifulSoup(resp.text, "lxml")
        iframe = soup.find("iframe")
        if not iframe:
            raise HTTPException(status_code=404, detail="Iframe not found (video might not be available)")
            
        vix_embed_url = iframe.get("src")
        
        # 2. Fetch Wixcloud/Vixcloud embed page
        vix_headers = get_headers()
        vix_headers["Referer"] = f"{base_url}/"
        embed_resp = session.get(vix_embed_url, headers=vix_headers, timeout=10)
        if embed_resp.status_code != 200:
            raise HTTPException(status_code=embed_resp.status_code, detail="Failed to fetch embed player")
            
        html_content = embed_resp.text
        
        # 3. Extract window.video and params
        video_obj_str = extract_js_object(html_content, "window.video =")
        params_obj_str = extract_js_object(html_content, "params:")
        
        if not video_obj_str or not params_obj_str:
            raise HTTPException(status_code=500, detail="Failed to parse player variables")
            
        video_json = clean_js_to_json(video_obj_str)
        params_json = clean_js_to_json(params_obj_str)
        
        if not video_json or not params_json:
            raise HTTPException(status_code=500, detail="Failed to load player JSON")
            
        # Determine available qualities
        qualities = []
        if params_json.get("token1080p"): qualities.append("1080p")
        if params_json.get("token720p"): qualities.append("720p")
        if params_json.get("token480p"): qualities.append("480p")
        if params_json.get("token360p"): qualities.append("360p")
        
        if not qualities:
            qualities = ["360p"] # Fallback
            
        video_id = video_json.get("id")
        token = params_json.get("token")
        expires = params_json.get("expires")
        
        # Build master playlist proxy URL
        master_proxy_url = f"/api/stream/master.m3u8?video_id={video_id}&token={token}&expires={expires}"
        
        return {
            "video_id": video_id,
            "title": video_json.get("name") or "video",
            "qualities": qualities,
            "master_url": master_proxy_url,
            "params": params_json
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/stream/master.m3u8")
def get_master_playlist(video_id: int, token: str, expires: str):
    # Wixcloud Master playlist url
    url = f"https://vixcloud.co/playlist/{video_id}?token={token}&expires={expires}"
    
    try:
        resp = requests.get(url, headers=get_headers(), timeout=10)
        if resp.status_code != 200:
            return Response(status_code=resp.status_code, content="Master playlist request failed")
            
        content = resp.text
        lines = content.splitlines()
        rewritten_lines = []
        
        for line in lines:
            line = line.strip()
            if line.startswith("https://"):
                # Rewrite sub-playlist URL to point to our proxy
                encoded_url = urllib.parse.quote(line)
                rewritten_url = f"/api/stream/subplaylist.m3u8?url={encoded_url}&video_id={video_id}"
                rewritten_lines.append(rewritten_url)
            elif "URI=\"" in line and "https://" in line:
                # Rewrite subtitles/audio playlists in EXT-X-MEDIA if absolute URLs are present
                uri_match = re.search(r'URI="([^"]+)"', line)
                if uri_match:
                    abs_uri = uri_match.group(1)
                    encoded_url = urllib.parse.quote(abs_uri)
                    rewritten_uri = f"/api/stream/subplaylist.m3u8?url={encoded_url}&video_id={video_id}"
                    line = line.replace(abs_uri, rewritten_uri)
                rewritten_lines.append(line)
            else:
                rewritten_lines.append(line)
                
        return Response(content="\n".join(rewritten_lines), media_type="application/vnd.apple.mpegurl")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/stream/subplaylist.m3u8")
def get_sub_playlist(url: str, video_id: int):
    try:
        resp = requests.get(url, headers=get_headers(), timeout=10)
        if resp.status_code != 200:
            return Response(status_code=resp.status_code, content="Sub-playlist request failed")
            
        content = resp.text
        lines = content.splitlines()
        rewritten_lines = []
        
        # Extract token and expires from original URL to use in key referrer
        parsed_url = urllib.parse.urlparse(url)
        query_params = urllib.parse.parse_qs(parsed_url.query)
        token_render = query_params.get("token", [""])[0]
        expires = query_params.get("expires", [""])[0]
        
        for line in lines:
            line = line.strip()
            if line.startswith("#EXT-X-KEY:"):
                # Rewrite key URI to point to local key proxy
                # Format: #EXT-X-KEY:METHOD=AES-128,URI="https://vixcloud.co/storage/enc.key",IV=0x...
                uri_match = re.search(r'URI="([^"]+)"', line)
                if uri_match:
                    orig_key_url = uri_match.group(1)
                    
                    # Create referer header payload for key proxy
                    referer = f"https://vixcloud.co/embed/{video_id}?token={token_render}&referer=1&expires={expires}"
                    encoded_key_url = urllib.parse.quote(orig_key_url)
                    encoded_referer = urllib.parse.quote(referer)
                    
                    local_key_url = f"/api/stream/key?url={encoded_key_url}&referer={encoded_referer}"
                    line = line.replace(orig_key_url, local_key_url)
                rewritten_lines.append(line)
            elif line.startswith("#") or not line:
                rewritten_lines.append(line)
            else:
                # Segment TS files URL. If relative, make absolute relative to the playlist URL
                absolute_ts_url = urllib.parse.urljoin(url, line)
                rewritten_lines.append(absolute_ts_url)
                
        return Response(content="\n".join(rewritten_lines), media_type="application/vnd.apple.mpegurl")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/stream/key")
def get_stream_key(url: str, referer: str):
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": referer
    }
    try:
        resp = requests.get(url, headers=headers, timeout=10)
        if resp.status_code == 200:
            return Response(content=resp.content, media_type="application/octet-stream")
        else:
            raise HTTPException(status_code=resp.status_code, detail="Failed to fetch key")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/download")
def download_media(payload: DownloadRequest):
    download_id = str(uuid.uuid4())
    
    start_download_task(
        download_id=download_id,
        title=payload.title,
        m3u8_video=payload.m3u8_video,
        m3u8_audio=payload.m3u8_audio,
        key_info=payload.key_info,
        extra_headers=payload.stream_headers,
        vidxgo_meta=payload.vidxgo,
        proxies=get_proxies(),
    )

    return {"download_id": download_id}

@app.get("/api/download/status")
def get_download_status():
    return list(active_downloads.values())


def _resolve_download_path(download_id: str) -> str:
    """Return the validated absolute path of a finished download, or 404/400."""
    path = download_paths.get(download_id)
    if not path or not os.path.exists(path):
        raise HTTPException(status_code=404, detail="File non trovato (download non completato?)")
    # Safety: only ever touch files inside the downloads directory.
    real = os.path.realpath(path)
    if os.path.commonpath([real, os.path.realpath(DOWNLOADS_DIR)]) != os.path.realpath(DOWNLOADS_DIR):
        raise HTTPException(status_code=400, detail="Percorso file non valido")
    return real


def _open_in_os(path: str, reveal: bool = False):
    """Open a file with the default app, or reveal it in the file manager."""
    if sys.platform.startswith("win"):
        if reveal:
            subprocess.Popen(["explorer", "/select,", os.path.normpath(path)])
        else:
            os.startfile(path)  # type: ignore[attr-defined]
    elif sys.platform == "darwin":
        subprocess.Popen(["open", "-R", path] if reveal else ["open", path])
    else:
        target = os.path.dirname(path) if reveal else path
        subprocess.Popen(["xdg-open", target])


@app.post("/api/download/open")
def open_download(payload: dict):
    """Open the finished file with the system default media player."""
    path = _resolve_download_path(payload.get("id", ""))
    try:
        _open_in_os(path, reveal=False)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"ok": True, "path": path}


@app.post("/api/download/reveal")
def reveal_download(payload: dict):
    """Reveal the finished file in the OS file manager (selected)."""
    path = _resolve_download_path(payload.get("id", ""))
    try:
        _open_in_os(path, reveal=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"ok": True, "path": path}


@app.post("/api/downloads/open-folder")
def open_downloads_folder():
    """Open the downloads directory in the OS file manager."""
    os.makedirs(DOWNLOADS_DIR, exist_ok=True)
    try:
        if sys.platform.startswith("win"):
            os.startfile(DOWNLOADS_DIR)  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.Popen(["open", DOWNLOADS_DIR])
        else:
            subprocess.Popen(["xdg-open", DOWNLOADS_DIR])
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"ok": True, "path": DOWNLOADS_DIR}

# Mount static folder
static_path = os.path.join(PROJECT_DIR, "static")
if os.path.exists(static_path):
    app.mount("/", StaticFiles(directory=static_path, html=True), name="static")
