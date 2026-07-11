import os
import re
import json
import time
import random
import base64
import hashlib
import threading
import urllib.parse
import ipaddress
import socket
import secrets
from functools import lru_cache
import uuid
import requests
import urllib3
import m3u8
from bs4 import BeautifulSoup
from fastapi import FastAPI, HTTPException, BackgroundTasks, Query
from fastapi.responses import Response, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
import urllib3.util.connection as connection
from concurrent.futures import ThreadPoolExecutor, as_completed

# Disable SSL verification warnings
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# --- DNS-over-HTTPS (DoH) Patching ---
def resolve_doh(host):
    """Resolve `host` via DNS-over-HTTPS, returning ALL A records (so the CDN can
    be load-balanced across its nodes instead of pinning every connection to a
    single IP)."""
    for url, hdrs in (
        (f"https://cloudflare-dns.com/dns-query?name={host}&type=A", {"Accept": "application/dns-json"}),
        (f"https://dns.google/resolve?name={host}&type=A", {}),
    ):
        try:
            r = requests.get(url, headers=hdrs, timeout=3)
            if r.status_code == 200:
                ips = [a.get("data") for a in r.json().get("Answer", []) if a.get("type") == 1 and a.get("data")]
                if ips:
                    return ips
        except Exception:
            pass
    return None

# Cache host -> IP so DoH is resolved ONCE per host, not on every new socket
# (the downloader opens many connections; repeated DoH lookups were a big drag).
_DOH_CACHE = {}

def patched_create_connection(address, *args, **kwargs):
    host, port = address
    if "streamingcommunity" in host or "vixcloud" in host:
        try:
            ips = _DOH_CACHE.get(host)
            if ips is None:
                ips = resolve_doh(host)
                if ips:
                    _DOH_CACHE[host] = ips
                    print(f"[DoH] Resolved {host} -> {len(ips)} IP(s) (cached)")
            if ips:
                # Spread connections across all CDN nodes (round-robin/random)
                chosen = random.choice(ips) if len(ips) > 1 else ips[0]
                return connection.real_create_connection((chosen, port), *args, **kwargs)
        except Exception as e:
            print(f"[DoH] Patched resolution failed for {host}: {e}")
    return connection.real_create_connection(address, *args, **kwargs)

if not hasattr(connection, 'real_create_connection'):
    connection.real_create_connection = connection.create_connection
    connection.create_connection = patched_create_connection
# -------------------------------------

from downloader import (
    start_download_task, active_downloads, download_paths,
    clear_downloads, cancel_download, set_max_concurrent,
)
import vidxgo
import animeworld
import subprocess
import sys

app = FastAPI(title="StreamingCommunity Unofficial Portal")

# CORS: nessun wildcard. Solo le origini locali possono chiamare l'API cross-origin
# (le richieste same-origin del portale non sono comunque soggette a CORS).
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8082", "http://127.0.0.1:8082",
        "http://localhost", "http://127.0.0.1",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)


@app.middleware("http")
async def no_cache_static(request, call_next):
    """Tell the browser to always revalidate the app files, so UI updates take
    effect immediately instead of being served from a stale cache."""
    response = await call_next(request)
    path = request.url.path
    if path == "/" or path.endswith((".js", ".css", ".html")) or path.startswith("/covers/"):
        response.headers["Cache-Control"] = "no-cache, must-revalidate"
    elif path.startswith(("/api/folders", "/api/library", "/api/settings", "/api/downloads", "/api/domains")):
        # dati personali: mai salvati su disco dal browser
        response.headers["Cache-Control"] = "no-store"
    return response


# --------------------------------------------------------------------------- #
#  Sicurezza: header HTTP + protezione DNS-rebinding / CSRF dell'API locale.
#  Non c'e' login, quindi garantiamo che solo chiamanti locali same-origin
#  possano usare le API che modificano dati.
# --------------------------------------------------------------------------- #
_CSP = (
    "default-src 'self'; "
    "script-src 'self'; "                       # niente CDN esterni (no tracking)
    "style-src 'self' 'unsafe-inline'; "        # niente Google Fonts
    "font-src 'self'; "
    "img-src 'self' data:; "                    # locandine SOLO via proxy locale
    "media-src 'self' blob: https:; "           # stream/mp4 remoti
    "connect-src 'self' https:; "
    "worker-src 'self' blob:; "
    "frame-src https:; "
    "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'"
)


def _host_allowed(host_header):
    """Consente solo host di loopback o LAN privata. Blocca il DNS-rebinding in
    cui un dominio pubblico malevolo risolve a 127.0.0.1."""
    if not host_header:
        return False
    h = host_header.split(":", 1)[0].strip().strip("[]").lower()
    if h in ("localhost", "127.0.0.1", "::1", "0.0.0.0"):
        return True
    try:
        ip = ipaddress.ip_address(h)
        return ip.is_loopback or ip.is_private
    except ValueError:
        return False  # rifiuta nomi di dominio arbitrari


@lru_cache(maxsize=1024)
def _host_is_public(host, port):
    """True se TUTTI gli IP a cui risolve `host` sono pubblici. Cache per non
    rifare la risoluzione DNS a ogni segmento."""
    try:
        infos = socket.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)
    except Exception:
        return False
    if not infos:
        return False
    for info in infos:
        ip = info[4][0]
        try:
            addr = ipaddress.ip_address(ip)
        except ValueError:
            return False
        if (addr.is_private or addr.is_loopback or addr.is_link_local
                or addr.is_reserved or addr.is_multicast or addr.is_unspecified):
            return False
    return True


def _is_safe_remote_url(url):
    """Anti-SSRF: consente SOLO http/https verso host che risolvono a IP
    PUBBLICI. Blocca loopback, reti private/LAN, link-local (169.254.x =
    metadati cloud) e nomi ovviamente interni. Usato dai proxy di streaming e
    dal download, che scaricano URL potenzialmente forniti dall'esterno."""
    try:
        pr = urllib.parse.urlparse(url or "")
    except Exception:
        return False
    if pr.scheme not in ("http", "https"):
        return False
    host = pr.hostname
    if not host:
        return False
    low = host.lower().rstrip(".")
    if low == "localhost" or low.endswith((".localhost", ".local", ".internal", ".lan", ".home")):
        return False
    try:
        port = pr.port or (443 if pr.scheme == "https" else 80)
    except ValueError:
        return False
    return _host_is_public(low, port)


def _same_origin(request):
    """Blocca le richieste cross-site che modificano dati (CSRF): l'host di
    Origin/Referer deve combaciare con l'Host del portale."""
    host = (request.headers.get("host") or "").lower()
    origin = request.headers.get("origin") or request.headers.get("referer") or ""
    if not origin:
        return True  # niente contesto cross-site
    try:
        return urllib.parse.urlparse(origin).netloc.lower() == host
    except Exception:
        return False


def _client_is_local(request):
    """True se la richiesta arriva da QUESTO PC (loopback). I client della rete
    locale (telefono/tablet) NON sono locali e devono fornire il token."""
    c = getattr(request, "client", None)
    h = (c.host if c else "") or ""
    if not h:
        return True  # sconosciuto: non bloccare questo PC
    h = h.strip("[]")
    try:
        return ipaddress.ip_address(h).is_loopback
    except ValueError:
        return h == "localhost"


def _token_ok(request):
    tok = (SETTINGS.get("access_token") or "").strip()
    if not tok:
        return False
    given = (request.query_params.get("t")
             or request.cookies.get("sc_token")
             or request.headers.get("x-sc-token") or "")
    return bool(given) and secrets.compare_digest(str(given), tok)


def _is_public_asset(path):
    """Risorse non sensibili raggiungibili SENZA token: icone app, favicon,
    manifest PWA, sonda ping e service worker. Servono perche' iOS/Android, al
    momento di 'Aggiungi a Home', scaricano icona e manifest SENZA inviare il
    cookie del token; se le bloccassimo, il sistema mostrerebbe la lettera del
    nome app (una 'S'/'T') invece dell'icona."""
    p = (path or "").lower()
    if p in ("/favicon.ico", "/sw.js", "/api/pwa/manifest", "/api/ping"):
        return True
    if p.startswith("/icon-") and p.endswith(".png"):
        return True
    if p.startswith("/apple-touch"):
        return True
    return False


@app.middleware("http")
async def security_headers(request, call_next):
    if not _host_allowed(request.headers.get("host", "")):
        return Response("Host non consentito", status_code=400)
    # Accesso da rete locale (telefono/tablet): serve il token. Questo PC (loopback) e' esente.
    if not _client_is_local(request) and not _token_ok(request) and not _is_public_asset(request.url.path):
        return Response("Accesso non autorizzato: apri il link/QR con il codice.", status_code=403)
    if request.method in ("POST", "PUT", "PATCH", "DELETE") and not _same_origin(request):
        return Response("Richiesta cross-origin non consentita", status_code=403)
    response = await call_next(request)
    # Se il token e' arrivato via ?t=, salvalo in un cookie per le richieste successive.
    _qtok = request.query_params.get("t")
    if _qtok and (SETTINGS.get("access_token") or "") and secrets.compare_digest(str(_qtok), SETTINGS["access_token"]):
        try:
            response.set_cookie("sc_token", _qtok, max_age=30 * 24 * 3600, samesite="lax", httponly=False)
        except Exception:
            pass
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    response.headers["Content-Security-Policy"] = _CSP
    response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
    response.headers["Cross-Origin-Resource-Policy"] = "same-origin"
    return response

if getattr(sys, "frozen", False):
    # Running as a PyInstaller .exe: keep user data (settings/library/covers/
    # downloads) NEXT TO the executable, but read bundled resources (static) from
    # the temporary extraction dir.
    PROJECT_DIR = os.path.dirname(sys.executable)
    RES_DIR = getattr(sys, "_MEIPASS", PROJECT_DIR)
else:
    PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
    RES_DIR = PROJECT_DIR
SETTINGS_FILE = os.path.join(PROJECT_DIR, "settings.json")
SETTINGS_TEMPLATE_FILE = os.path.join(PROJECT_DIR, "settings.template.json")
DOWNLOADS_DIR = os.path.join(PROJECT_DIR, "downloads")
LIBRARY_FILE = os.path.join(PROJECT_DIR, "library.json")
COVERS_DIR = os.path.join(PROJECT_DIR, "covers")
os.makedirs(COVERS_DIR, exist_ok=True)

# Global session with SSL verification disabled
session = requests.Session()
session.verify = False

# cloudscraper: sessione "browser-like" per superare la protezione Cloudflare del
# player (Vixcloud/vixsrc), che risponde 403 alle richieste normali di requests.
# Facoltativa: se non installata, si continua senza (con degrado noto).
try:
    import cloudscraper
    _cf_scraper = cloudscraper.create_scraper(
        browser={"browser": "chrome", "platform": "windows", "mobile": False})
    _cf_scraper.verify = False
except Exception as _e:
    _cf_scraper = None
    print(f"[cf] cloudscraper non disponibile: {_e}")


def _fetch_maybe_cloudflare(url, headers=None, timeout=15, proxies=None):
    """GET che, se prende 403/503 (tipico di Cloudflare), riprova con cloudscraper
    per risolvere la challenge JS. Ritorna la Response migliore ottenuta."""
    try:
        r = session.get(url, headers=headers, timeout=timeout, proxies=proxies, verify=False)
    except Exception:
        r = None
    if r is not None and r.status_code == 200:
        return r
    if _cf_scraper is not None:
        try:
            r2 = _cf_scraper.get(url, headers=headers, timeout=max(timeout, 25), proxies=proxies)
            if r2 is not None and (r is None or r2.status_code == 200 or r2.status_code < r.status_code):
                return r2
        except Exception as e:
            print(f"[cf] cloudscraper GET fallita: {e}")
    return r


def _browser_get_html(url, referer=None, timeout_ms=45000):
    """Ultima spiaggia contro Cloudflare "managed": apre l'URL in Chromium headless
    (Playwright), che supera la challenge come un vero browser, e ritorna l'HTML con
    le variabili del player. Richiede playwright + chromium (installati da start.py).
    Ritorna None se Playwright/Chromium non sono disponibili o falliscono."""
    try:
        from playwright.sync_api import sync_playwright
    except Exception as e:
        print(f"[browser] Playwright non disponibile: {e}")
        return None
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, args=[
                "--no-sandbox", "--disable-dev-shm-usage",
                "--disable-blink-features=AutomationControlled"])
            ctx = browser.new_context(
                user_agent=get_headers().get("User-Agent"),
                ignore_https_errors=True,
                extra_http_headers=({"Referer": referer} if referer else {}))
            page = ctx.new_page()
            page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
            # attende che la challenge Cloudflare passi e il player si carichi
            try:
                page.wait_for_function(
                    "() => document.documentElement.outerHTML.indexOf('window.video') !== -1"
                    " || document.documentElement.outerHTML.indexOf('window.streams') !== -1"
                    " || document.querySelector('video') !== null",
                    timeout=timeout_ms)
            except Exception:
                pass
            html = page.content()
            try: browser.close()
            except Exception: pass
            return html
    except Exception as e:
        print(f"[browser] errore Playwright: {e}")
        return None

# Load Settings
def normalize_domain(value):
    """Accept a suffix, a full host or a pasted URL and return a canonical host.

    Old settings stored values like "computer"; newer rotating domains may be
    full hosts such as "streamingcommunityz.tech". Keeping a single canonical
    shape lets the rest of the app switch domains without user cleanup.
    """
    value = (value or "").strip()
    if not value:
        return ""
    if "://" not in value:
        value = "https://" + value
    parsed = urllib.parse.urlparse(value)
    host = (parsed.netloc or parsed.path).split("/")[0].lower()
    if "@" in host:
        host = host.rsplit("@", 1)[1]
    if ":" in host:
        host = host.split(":", 1)[0]
    host = host.strip().strip(".")
    if host.startswith("www."):
        host = host[4:]
    return host if "." in host else f"streamingcommunity.{host}"


def _salvage_settings(txt):
    """Recover domain/domains/folders from a truncated/corrupted settings.json
    instead of losing them all (the folders array can be large and is the most
    painful thing to lose)."""
    out = {}
    m = re.search(r'"domain"\s*:\s*"([^"]*)"', txt)
    if m:
        out["domain"] = m.group(1)
    md = re.search(r'"domains"\s*:\s*(\[.*?\])', txt, re.S)
    if md:
        try:
            out["domains"] = [x for x in json.loads(md.group(1)) if isinstance(x, str)]
        except Exception:
            pass
    folders = []
    dec = json.JSONDecoder()
    fi = txt.find('"folders"')
    if fi != -1:
        i = txt.find("{", fi)
        while i != -1 and i < len(txt):
            try:
                obj, end = dec.raw_decode(txt, i)
                if isinstance(obj, dict) and "id" in obj and "name" in obj:
                    obj.setdefault("items", [])
                    obj.setdefault("kind", obj.get("kind", ""))
                    obj.setdefault("parent", obj.get("parent", ""))
                    obj.setdefault("cover", obj.get("cover", ""))
                    folders.append(obj)
                i = txt.find("{", end)
            except Exception:
                i = txt.find("{", i + 1)
    if folders:
        out["folders"] = folders
    return out


def load_settings():
    data = {}
    # Primo avvio / clone pulito: se manca settings.json (gitignorato perche'
    # contiene il token), parti dal template pubblico settings.template.json, che
    # porta cartelle, domini e fonti (senza token, generato dopo per-installazione).
    _src = SETTINGS_FILE if os.path.exists(SETTINGS_FILE) else SETTINGS_TEMPLATE_FILE
    if os.path.exists(_src):
        try:
            with open(_src, "r", encoding="utf-8") as f:
                txt = f.read()
        except Exception:
            txt = ""
        try:
            data = json.loads(txt)
        except Exception:
            data = _salvage_settings(txt)
            if data.get("folders"):
                print(f"[!] settings.json corrotto: recuperate {len(data['folders'])} cartelle (salvage).")
    raw_domains = list(data.get("domains") or [])
    data["domain"] = normalize_domain(data.get("domain") or "streamingcommunityz.tech")
    # Persistent list of domains the user has used. Remembered across sessions
    # and health-checked at every startup so the user never has to re-enter the
    # same domain twice.
    data["domains"] = []
    for d in raw_domains:
        nd = normalize_domain(d)
        if nd and nd not in data["domains"]:
            data["domains"].append(nd)
    # Make sure the current domain is part of the remembered list.
    if data["domain"] and data["domain"] not in data["domains"]:
        data["domains"].append(data["domain"])
    data["source_domains"] = [normalize_source_domain(d) for d in data.get("source_domains", []) if normalize_source_domain(d)]
    data["custom_filters"] = []
    for x in data.get("custom_filters", []):
        nm = normalize_filter_name(x)
        if nm and nm not in data["custom_filters"]:
            data["custom_filters"].append(nm)
    return data

def save_settings(settings):
    tmp = SETTINGS_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(settings, f, indent=4)
    os.replace(tmp, SETTINGS_FILE)


def remember_domain(domain):
    """Add a domain to the persistent remembered list (deduplicated)."""
    domain = normalize_domain(domain)
    if not domain:
        return
    lst = SETTINGS.setdefault("domains", [])
    if domain not in lst:
        lst.append(domain)


def normalize_filter_name(value):
    name = re.sub(r"\s+", " ", str(value or "").strip().lower())[:40]
    if not name or re.search(r"[\x00-\x1f<>]", name):
        return ""
    return name


def normalize_source_domain(value):
    """Domains for compatible/backup catalogues, kept separate from the active
    StreamingCommunity host so changing SC never damages the user's library."""
    value = (value or "").strip()
    if not value:
        return ""
    if "://" in value:
        value = urllib.parse.urlparse(value).netloc or value
    return value.strip().strip("/").lower()


def refresh_library_urls_for_domain():
    """Persist fresh URLs for native SC titles after every domain change.
    The stable key remains the source of truth, so this is a safety sync for
    stored JSON and old UI reads, not a destructive migration."""
    changed = False
    base = get_base_url()
    for e in LIBRARY:
        key = e.get("key") or ""
        if re.match(r"^\d+-[\w-]+$", key):
            fresh = f"{base}/it/titles/{key}"
            if e.get("url") != fresh:
                e["url"] = fresh
                changed = True
    if changed:
        save_library(LIBRARY)
    return changed


# In-memory liveness status of remembered domains: {domain: bool}. Refreshed at
# startup and whenever the domains are tested.
DOMAIN_STATUS = {}

# Markers of a seized / blocked / parked StreamingCommunity page.
BLOCK_MARKERS = ("avviso", "agcom", "sequestro", "guardia di finanza",
                 "polizia", "redirect_link", "fingerprintjs", "expireddomains")


def _domain_to_base(domain):
    return normalize_domain(domain)


def test_domain_alive(domain):
    """True if `domain` currently serves the real StreamingCommunity JSON API
    (i.e. it is not seized/parked/dead)."""
    base = _domain_to_base(domain)
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    try:
        resp = requests.get(f"https://{base}/it/search?q=a", headers=headers,
                            timeout=6, verify=False)
        if resp.status_code != 200:
            return False
        if any(m in resp.text.lower() for m in BLOCK_MARKERS):
            return False
        if "data-page" in resp.text:
            return True
        try:
            data = resp.json()
            return isinstance(data, dict) and ("data" in data or "titles" in data)
        except ValueError:
            return False
    except Exception:
        return False


def health_check_domains(auto_discover=False):
    """Test every remembered domain, update DOMAIN_STATUS, and select the first
    active one as the current domain. Does NOT invent new domains — if none of
    the remembered ones is alive the user is asked to update the domain."""
    _DOH_CACHE.clear()  # always re-resolve hosts fresh when (re)checking domains
    domains = list(SETTINGS.get("domains") or [])
    statuses = {}
    active = None
    for d in domains:
        ok = test_domain_alive(d)
        statuses[d] = ok
        if ok and active is None:
            active = d
    DOMAIN_STATUS.clear()
    DOMAIN_STATUS.update(statuses)
    if active:
        SETTINGS["domain"] = active
        save_settings(SETTINGS)
        refresh_library_urls_for_domain()
        print(f"[+] Remembered domain attivo: {active}")
    elif auto_discover:
        discovered = detect_active_domain()
        if discovered:
            active = discovered
            remember_domain(discovered)
            DOMAIN_STATUS[discovered] = True
            SETTINGS["domain"] = discovered
            save_settings(SETTINGS)
            refresh_library_urls_for_domain()
            print(f"[+] Dominio auto-rilevato: {discovered}")
        else:
            print("[!] Nessun dominio attivo trovato automaticamente.")
    else:
        print("[!] Nessun dominio ricordato è attivo: l'utente deve aggiornarlo.")
    return active


# --------------------------------------------------------------------------- #
#  Library (saved / recent titles)
# --------------------------------------------------------------------------- #
# A persistent, clickable list of titles. Each entry stores the FULL original
# link it was opened with ("domain per title"), so a saved title can be
# reopened later without re-pasting. Entries are added automatically when a
# title is opened or downloaded, and can be pinned as favourites.
_library_lock = threading.Lock()


LIBRARY_STATE_FILE = os.path.join(PROJECT_DIR, "library_state.json")


def load_library_state():
    """Cronologia di visione (key -> last_opened) tenuta in un file SEPARATO e
    NON versionato: cosi' library.json (condiviso su GitHub) contiene solo titoli
    e locandine, non quando li hai aperti."""
    try:
        with open(LIBRARY_STATE_FILE, "r", encoding="utf-8") as f:
            d = json.load(f)
        return {k: v for k, v in d.items() if isinstance(v, (int, float))} if isinstance(d, dict) else {}
    except Exception:
        return {}


def save_library_state():
    try:
        tmp = LIBRARY_STATE_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(LIB_STATE, f, ensure_ascii=False)
        os.replace(tmp, LIBRARY_STATE_FILE)
    except Exception:
        pass


def load_library():
    if not os.path.exists(LIBRARY_FILE):
        return []
    try:
        with open(LIBRARY_FILE, "r", encoding="utf-8") as f:
            txt = f.read()
    except Exception:
        return []
    try:
        data = json.loads(txt)
        if isinstance(data, list):
            return data
    except Exception:
        pass  # (il salvage sotto gestisce i file troncati)
    # Salvage: if the file is truncated/corrupted, recover as many complete
    # title objects as possible instead of losing the whole library.
    salvaged = []
    dec = json.JSONDecoder()
    i = txt.find("{")
    while i != -1 and i < len(txt):
        try:
            obj, end = dec.raw_decode(txt, i)
            if isinstance(obj, dict) and obj.get("key"):
                salvaged.append(obj)
            nxt = txt.find("{", end)
            i = nxt
        except Exception:
            i = txt.find("{", i + 1)
    if salvaged:
        print(f"[!] library.json corrotto: recuperati {len(salvaged)} titoli (salvage).")
    return salvaged


def save_library(entries):
    with _library_lock:
        tmp = LIBRARY_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(entries, f, ensure_ascii=False, indent=2)
        os.replace(tmp, LIBRARY_FILE)


def _sorted_library(entries):
    # Favourites first, then most-recently-opened first.
    return sorted(
        entries,
        key=lambda e: (0 if e.get("favorite") else 1, -(LIB_STATE.get(e.get("key")) or 0)),
    )


LIB_STATE = load_library_state()
LIBRARY = load_library()
# Migrazione una-tantum: sposta i timestamp storici nel file di stato separato e
# li RIMUOVE da library.json (che verra' riscritto senza cronologia personale).
_migrated = False
for _e in LIBRARY:
    _k = _e.get("key")
    _lo = _e.pop("last_opened", None)
    _e.pop("added_at", None)
    if _k and isinstance(_lo, (int, float)) and _k not in LIB_STATE:
        LIB_STATE[_k] = _lo
    if _lo is not None:
        _migrated = True
if _migrated:
    try:
        save_library(LIBRARY)
        save_library_state()
    except Exception:
        pass

def detect_active_domain():
    # StreamingCommunity now rotates both TLDs and hostnames (for example
    # streamingcommunityz.tech). Probe remembered hosts first, then likely
    # current patterns, and only accept one that serves the working JSON API.
    suffixes = [
        "tech", "computer", "broker", "vet", "fun", "rocks", "care", "vip",
        "cfd", "co", "ink", "party", "club", "watch", "live", "blog", "art",
        "best", "one", "forum", "store", "photos", "buzz", "bar", "boats",
        "build", "cab", "cyou", "icu", "wiki", "world", "today", "site",
        "online", "space",
    ]
    candidate_hosts = []

    def add_candidate(value):
        host = normalize_domain(value)
        if host and host not in candidate_hosts:
            candidate_hosts.append(host)

    for d in [SETTINGS.get("domain")] + list(SETTINGS.get("domains") or []):
        add_candidate(d)
    add_candidate("streamingcommunityz.tech")
    for ch in "zyxwvutsrqponmlkjihgfedcba":
        add_candidate(f"streamingcommunity{ch}.tech")
    for suffix in suffixes:
        add_candidate(f"streamingcommunity.{suffix}")
        add_candidate(f"streamingcommunityz.{suffix}")

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }

    # Markers of a seized / blocked / parked page (case-insensitive).
    block_markers = ("avviso", "agcom", "sequestro", "guardia di finanza",
                     "polizia", "redirect_link", "fingerprintjs", "expireddomains")

    def test_host(host):
        base = f"https://{host}"
        try:
            # The definitive test: does the real Inertia API answer with JSON?
            resp = requests.get(f"{base}/it/search?q=a", headers=headers,
                                timeout=6, verify=False)
            if resp.status_code != 200:
                return None
            text_low = resp.text.lower()
            if any(m in text_low for m in block_markers):
                return None
            if "data-page" in resp.text:
                return host
            data = resp.json()  # raises if the page is HTML (block/park page)
            if isinstance(data, dict) and ("data" in data or "titles" in data):
                return host
        except Exception:
            pass
        return None

    _DOH_CACHE.clear()
    print("[*] Detecting active StreamingCommunity domain (verifying live API)...")
    found = []
    with ThreadPoolExecutor(max_workers=min(20, len(candidate_hosts))) as executor:
        futures = {executor.submit(test_host, h): h for h in candidate_hosts}
        for future in as_completed(futures):
            res = future.result()
            if res:
                print(f"[+] Verified working domain: {res}")
                found.append(res)
    if found:
        found_set = set(found)
        return next((h for h in candidate_hosts if h in found_set), found[0])
    print("[!] No working StreamingCommunity domain found (all seized/parked). "
          "Paste a working title URL to set the domain manually.")
    return None

SETTINGS = load_settings()
# Token d'accesso per l'uso da telefono/tablet in rete locale (mai nel repo:
# settings.json e' gitignorato). Generato una volta e persistito.
if not (SETTINGS.get("access_token") or "").strip():
    SETTINGS["access_token"] = secrets.token_urlsafe(18)
    try:
        save_settings(SETTINGS)
    except Exception:
        pass
SETTINGS.setdefault("lan_enabled", False)


def _prune_library():
    """Mantiene in libreria SOLO i titoli preferiti o presenti in una cartella;
    quelli semplicemente aperti non vengono ricordati tra le sessioni."""
    global LIBRARY
    folder_keys = set()
    for f in SETTINGS.get("folders", []):
        for k in f.get("items", []):
            folder_keys.add(k)
    kept = [e for e in LIBRARY if e.get("favorite") or e.get("key") in folder_keys]
    if len(kept) != len(LIBRARY):
        removed = len(LIBRARY) - len(kept)
        LIBRARY = kept
        save_library(LIBRARY)
        print(f"[i] Libreria: dimenticati {removed} titoli non salvati (solo preferiti/cartelle restano).")


_prune_library()


@app.on_event("startup")
def startup_event():
    # Honour settings.json "proxy" / SC_PROXY before serving any request.
    apply_proxies()

    # Configure the download queue concurrency, then restore any queued/
    # interrupted/finished downloads from the previous session.
    try:
        set_max_concurrent(int(SETTINGS.get("max_concurrent", 2)))
    except (TypeError, ValueError):
        set_max_concurrent(2)
    # The download list is NOT remembered across sessions: each session starts
    # empty. Only the library/favourites persist (library.json).
    clear_downloads()

    # Health-check the user's REMEMBERED domains at every startup (in a thread
    # so booting stays instant). We do NOT auto-switch to a random freshly
    # detected domain here: if none of the remembered domains is alive the user
    # updates it explicitly (button / per-title prompt).
    def run_startup_check():
        print("[*] Testing remembered domains…")
        health_check_domains(auto_discover=True)

    thread = threading.Thread(target=run_startup_check, daemon=True)
    thread.start()

def get_base_url():
    return f"https://{normalize_domain(SETTINGS['domain'])}"

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


def get_cdn_url(page_data=None):
    if page_data:
        cdn = (page_data.get("props", {}) or {}).get("cdn_url")
        if cdn:
            return cdn.rstrip("/")
    host = normalize_domain(SETTINGS.get("domain"))
    if host.startswith("streamingcommunity"):
        return f"https://cdn.{host}"
    return get_base_url()


def cover_out(url):
    """Fa passare le locandine REMOTE dal proxy locale /api/img, cosi' il browser
    non contatta le CDN dei poster (niente esposizione dell'IP a terzi)."""
    if not url or not isinstance(url, str):
        return url or ""
    if url.startswith("/") or url.startswith("data:"):
        return url  # gia' locale (/covers/...) o inline
    if url.startswith("http://") or url.startswith("https://"):
        return "/api/img?u=" + urllib.parse.quote(url, safe="")
    return url


def image_url(images, preferred=("poster", "cover"), cdn_url=None):
    return cover_out(_raw_image_url(images, preferred=preferred, cdn_url=cdn_url))


def _raw_image_url(images, preferred=("poster", "cover"), cdn_url=None):
    """Extract an image URL from both old dict and new list image shapes."""
    if not images:
        return ""
    if isinstance(images, dict):
        return images.get("poster") or images.get("cover") or images.get("url") or ""
    if not isinstance(images, list):
        return ""
    selected = None
    for wanted in preferred:
        selected = next((img for img in images if isinstance(img, dict) and img.get("type") == wanted), None)
        if selected:
            break
    if not selected:
        selected = next((img for img in images if isinstance(img, dict)), None)
    if not selected:
        return ""
    direct = selected.get("url") or selected.get("original_url") or selected.get("original_url_field")
    if direct:
        return direct
    filename = selected.get("filename")
    if filename:
        return f"{(cdn_url or get_cdn_url()).rstrip('/')}/images/{filename}"
    return ""


def _domain_error(extra=""):
    """Structured 503 the frontend recognises (detail.domain_error == True) to
    offer the user a one-click domain refresh / prompt to paste a fresh URL."""
    msg = "Il dominio StreamingCommunity non è più raggiungibile (cambia spesso per via dei sequestri AGCOM/Piracy Shield)."
    if extra:
        msg += f" {extra}"
    return HTTPException(status_code=503, detail={
        "domain_error": True,
        "domain": SETTINGS.get("domain"),
        "message": msg,
    })


def sc_get(url, headers=None, timeout=10):
    """GET against the active StreamingCommunity domain. Connection-level
    failures (DNS, refused, timeout) mean the domain is dead/blocked, so they
    are surfaced as a domain_error 503 instead of a generic 500."""
    def retry_with_discovered_domain():
        if not health_check_domains(auto_discover=True):
            return None
        old_host = urllib.parse.urlparse(url).netloc
        new_host = normalize_domain(SETTINGS["domain"])
        new_url = url.replace(old_host, new_host, 1)
        retry_headers = dict(headers or get_headers())
        if retry_headers.get("Referer"):
            retry_headers["Referer"] = retry_headers["Referer"].replace(old_host, new_host, 1)
        return session.get(new_url, headers=retry_headers, timeout=timeout)

    try:
        resp = session.get(url, headers=headers or get_headers(), timeout=timeout)
        if resp.status_code in (403, 410, 451, 502, 503, 504):
            retry = retry_with_discovered_domain()
            if retry is not None:
                return retry
        return resp
    except requests.exceptions.RequestException as e:
        try:
            retry = retry_with_discovered_domain()
            if retry is not None:
                return retry
        except requests.exceptions.RequestException:
            pass
        raise _domain_error(f"({type(e).__name__})")


def sc_get_first(paths, headers=None, timeout=10):
    """Try StreamingCommunity paths in order and return the first useful page."""
    base_url = get_base_url()
    last_resp = None
    for path in paths:
        url = f"{base_url}{path}"
        resp = sc_get(url, headers=headers or get_headers(), timeout=timeout)
        last_resp = resp
        if resp.status_code == 200:
            return resp, url
    return last_resp, f"{base_url}{paths[-1]}"

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
    sc_id: Optional[int] = None        # StreamingCommunity title id (for token refresh)
    episode_id: Optional[int] = None
    lib_key: Optional[str] = ""        # library key (per collegare il file al titolo)
    cover: Optional[str] = ""          # cover remota/proxy da congelare in /covers

@app.get("/api/settings")
def get_settings():
    return SETTINGS


@app.get("/api/img")
def proxy_image(u: str):
    """Scarica una locandina REMOTA lato server e la restituisce da localhost,
    cosi' il browser non contatta le CDN dei poster. Protetto anti-SSRF."""
    if not _is_safe_remote_url(u):
        raise HTTPException(status_code=400, detail="URL non consentito")
    try:
        r = session.get(u, headers=get_headers(), timeout=12, verify=False, proxies=get_proxies())
    except Exception:
        raise HTTPException(status_code=502, detail="Immagine non disponibile")
    if r.status_code != 200:
        raise HTTPException(status_code=r.status_code, detail="Immagine non disponibile")
    if len(r.content) > 15 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Immagine troppo grande")
    ct = r.headers.get("content-type", "")
    if not ct.startswith("image/"):
        ct = "image/jpeg"
    return Response(content=r.content, media_type=ct,
                    headers={"Cache-Control": "public, max-age=86400"})


def _remote_cover_url(url: str) -> str:
    """Accetta sia URL remoti sia il proxy locale /api/img?u=... e restituisce
    l'URL remoto originale. Le cover locali restano locali."""
    url = (url or "").strip()
    if not url or url.startswith("/covers/") or url.startswith("data:"):
        return ""
    if url.startswith("/api/img?"):
        try:
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
            return (qs.get("u") or [""])[0]
        except Exception:
            return ""
    if url.startswith("http://") or url.startswith("https://"):
        return url
    return ""


def cache_cover_local(key: str, cover_url: str) -> str:
    """Scarica una locandina remota in /covers e ritorna il path locale.
    Viene chiamata durante le fasi online/download, quindi usa la stessa VPN/
    proxy configurata dell'app. In riproduzione LAN poi basta servire /covers."""
    key = (key or "").strip()
    remote = _remote_cover_url(cover_url)
    if not key or not remote or not _is_safe_remote_url(remote):
        return ""
    h = hashlib.md5(key.encode("utf-8")).hexdigest()[:12]
    try:
        for fn in os.listdir(COVERS_DIR):
            if fn.startswith("lib_" + h + "."):
                return "/covers/" + fn
    except OSError:
        pass
    try:
        r = session.get(remote, headers=get_headers(), timeout=12, verify=False, proxies=get_proxies())
    except Exception:
        return ""
    if r.status_code != 200 or len(r.content) > 8 * 1024 * 1024:
        return ""
    ct = (r.headers.get("content-type") or "").lower()
    ext = ".jpg"
    if "png" in ct:
        ext = ".png"
    elif "webp" in ct:
        ext = ".webp"
    elif "gif" in ct:
        ext = ".gif"
    else:
        path_ext = os.path.splitext(urllib.parse.urlparse(remote).path)[1].lower()
        if path_ext in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
            ext = path_ext
    fname = f"lib_{h}{ext}"
    try:
        with open(os.path.join(COVERS_DIR, fname), "wb") as fh:
            fh.write(r.content)
        return f"/covers/{fname}"
    except OSError:
        return ""


@app.get("/api/ip-check")
def ip_check():
    """IP pubblico e paese che i SITI vedono davvero (la richiesta esce dalla
    stessa connessione dell'app: se hai una VPN/WARP di sistema attiva, qui vedi
    l'IP di uscita della VPN). Cloudflare 'trace' riporta anche lo stato WARP."""
    try:
        r = session.get("https://www.cloudflare.com/cdn-cgi/trace",
                        headers=get_headers(), timeout=8, verify=False, proxies=get_proxies())
        if r.status_code == 200 and "ip=" in (r.text or ""):
            d = {}
            for line in r.text.splitlines():
                if "=" in line:
                    k, v = line.split("=", 1)
                    d[k.strip()] = v.strip()
            return {"ip": d.get("ip", ""), "country": d.get("loc", ""),
                    "warp": d.get("warp", ""), "colo": d.get("colo", "")}
    except Exception:
        pass
    # fallback: solo IP
    try:
        r = session.get("https://api.ipify.org?format=json",
                        headers=get_headers(), timeout=8, verify=False, proxies=get_proxies())
        j = r.json()
        if j.get("ip"):
            return {"ip": j["ip"], "country": "", "warp": "", "colo": ""}
    except Exception:
        pass
    raise HTTPException(status_code=502, detail="Impossibile verificare l'IP (sei connesso a Internet?)")


def _lan_ip():
    """IP di questo PC nella rete locale (per farci connettere telefono/tablet)."""
    try:
        sk = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sk.connect(("8.8.8.8", 80))
        ip = sk.getsockname()[0]
        sk.close()
        return ip
    except Exception:
        return "127.0.0.1"


@app.get("/api/cast/info")
def cast_info():
    """Dati per costruire il link/QR verso telefono/tablet."""
    return {"lan_ip": _lan_ip(), "port": 8082,
            "token": SETTINGS.get("access_token", ""),
            "lan_enabled": bool(SETTINGS.get("lan_enabled"))}


class CastEnable(BaseModel):
    enabled: bool = True


@app.post("/api/cast/enable")
def cast_enable(payload: CastEnable):
    """Attiva/disattiva l'accesso dalla rete locale (protetto da token). Richiede
    un riavvio di SC Portal per cambiare l'indirizzo di ascolto del server."""
    SETTINGS["lan_enabled"] = bool(payload.enabled)
    save_settings(SETTINGS)
    return {"ok": True, "lan_enabled": SETTINGS["lan_enabled"], "restart_needed": True}


@app.get("/api/cast/qr")
def cast_qr(data: str):
    """QR (SVG) del link da inquadrare col telefono/tablet."""
    try:
        import qrcode
        import qrcode.image.svg
        import io as _io
        img = qrcode.make(data, image_factory=qrcode.image.svg.SvgImage, box_size=11, border=2)
        buf = _io.BytesIO()
        img.save(buf)
        return Response(content=buf.getvalue(), media_type="image/svg+xml",
                        headers={"Cache-Control": "no-store"})
    except Exception:
        raise HTTPException(status_code=501,
                            detail="Generatore QR non disponibile: chiudi e RIAVVIA SC Portal (installa qrcode).")


@app.get("/api/pwa/manifest")
def pwa_manifest(kind: str = "mobile", t: str = ""):
    """Manifest PWA generato al volo: il token va nello start_url cosi' l'app
    installata in home (anche iOS, che isola i cookie) riparte gia' autenticata
    e ritrova il server sulla stessa Wi-Fi."""
    tq = ("&t=" + urllib.parse.quote(t)) if t else ""
    if kind == "remote":
        m = {
            "name": "SC Telecomando", "short_name": "Telecomando",
            "description": "Telecomando SC Portal: comanda dal telefono il player sul PC/TV.",
            "start_url": "/remote.html?pwa=1" + tq,
            "icons": [
                {"src": "/icon-remote-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable"},
                {"src": "/icon-remote-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable"},
            ],
        }
    else:
        m = {
            "name": "SC Portal", "short_name": "SC Portal",
            "description": "I tuoi download SC Portal, pronti alla riproduzione sul telefono.",
            "start_url": "/?view=downloads&pwa=1" + tq,
            "icons": [
                {"src": "/icon-app-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable"},
                {"src": "/icon-app-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable"},
            ],
        }
    m.update({"scope": "/", "display": "standalone", "orientation": "portrait",
              "background_color": "#0a0a10", "theme_color": "#7c5cff"})
    import json as _json
    return Response(content=_json.dumps(m), media_type="application/manifest+json",
                    headers={"Cache-Control": "no-store"})


@app.get("/api/ping")
def ping():
    """Sonda leggera: le app in home la usano per capire se SC Portal e' acceso."""
    return {"ok": True, "app": "sc-portal"}


# --------------------------------------------------------------------------- #
#  Telecomando: il telefono controlla il player del PC (ponte PC<->TV).
# --------------------------------------------------------------------------- #
_REMOTE = {"state": {}, "seq": 0, "cmd": None}


class RemoteState(BaseModel):
    title: Optional[str] = ""
    playing: bool = False
    time: float = 0
    duration: float = 0
    canPrev: bool = False
    canNext: bool = False
    moreExists: bool = False
    moreLabel: Optional[str] = ""
    muted: bool = False
    volume: float = 1.0


@app.post("/api/remote/state")
def remote_set_state(payload: RemoteState):
    _REMOTE["state"] = payload.dict()
    return {"ok": True}


@app.get("/api/remote/state")
def remote_get_state():
    st = dict(_REMOTE.get("state") or {})
    st["seq"] = _REMOTE["seq"]
    return st


class RemoteCmd(BaseModel):
    action: str
    value: Optional[float] = None
    arg: Optional[str] = None      # es. id del download da riprodurre
    label: Optional[str] = None    # nome leggibile del titolo scelto


@app.post("/api/remote/cmd")
def remote_set_cmd(payload: RemoteCmd):
    _REMOTE["seq"] += 1
    _REMOTE["cmd"] = {"seq": _REMOTE["seq"], "action": payload.action,
                      "value": payload.value, "arg": payload.arg, "label": payload.label}
    return {"ok": True, "seq": _REMOTE["seq"]}


@app.get("/api/remote/cmd")
def remote_poll(since: int = 0):
    c = _REMOTE.get("cmd")
    if c and c["seq"] > since:
        return c
    return {"seq": _REMOTE["seq"], "action": None, "value": None, "arg": None, "label": None}

@app.post("/api/save")
def save_all():
    """Force a VERIFIED persist of the current library + settings (folders,
    domains, types). Re-reads each file afterwards to confirm it is intact, so
    the user gets a real confirmation that everything is saved."""
    errors = []
    try:
        save_library(LIBRARY)
        with open(LIBRARY_FILE, "r", encoding="utf-8") as f:
            json.load(f)
    except Exception as e:
        errors.append(f"libreria ({e})")
    try:
        save_settings(SETTINGS)
        with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
            json.load(f)
    except Exception as e:
        errors.append(f"impostazioni ({e})")
    if errors:
        raise HTTPException(status_code=500,
                            detail="Salvataggio non verificato: " + "; ".join(errors))
    return {
        "ok": True,
        "titles": len(LIBRARY),
        "folders": len(SETTINGS.get("folders", [])),
        "favorites": sum(1 for e in LIBRARY if e.get("favorite")),
    }


@app.post("/api/settings")
def update_settings(payload: SettingsUpdate):
    if payload.domain is not None and payload.domain.strip():
        d = normalize_domain(payload.domain)
        SETTINGS["domain"] = d
        remember_domain(d)
        DOMAIN_STATUS[d] = test_domain_alive(d)
        refresh_library_urls_for_domain()
    if payload.proxy is not None:
        SETTINGS["proxy"] = payload.proxy.strip()
        apply_proxies()
    save_settings(SETTINGS)
    return SETTINGS


class DomainPayload(BaseModel):
    domain: str


class CustomFilterPayload(BaseModel):
    name: str


class CustomFilterRenamePayload(BaseModel):
    old: str
    name: str


@app.get("/api/domains")
def list_domains():
    """The remembered domains with their last-known liveness status."""
    domains = list(SETTINGS.get("domains") or [])
    return {
        "current": SETTINGS.get("domain"),
        "domains": [{"domain": d, "active": DOMAIN_STATUS.get(d)} for d in domains],
    }


@app.post("/api/domains/test")
def test_domains():
    """Re-test every remembered domain now and select the first active one."""
    health_check_domains(auto_discover=True)
    return list_domains()


@app.post("/api/domains/add")
def add_domain(payload: DomainPayload):
    d = normalize_domain(payload.domain)
    if not d:
        raise HTTPException(status_code=400, detail="Dominio vuoto")
    remember_domain(d)
    alive = test_domain_alive(d)
    DOMAIN_STATUS[d] = alive
    if alive:
        SETTINGS["domain"] = d  # switch to it if it works
        refresh_library_urls_for_domain()
    save_settings(SETTINGS)
    return list_domains()


@app.post("/api/domains/remove")
def remove_domain(payload: DomainPayload):
    d = normalize_domain(payload.domain)
    SETTINGS["domains"] = [x for x in SETTINGS.get("domains", []) if x != d]
    DOMAIN_STATUS.pop(d, None)
    # If we removed the current domain, fall back to the first remaining active one.
    if SETTINGS.get("domain") == d:
        nxt = next((x for x in SETTINGS["domains"] if DOMAIN_STATUS.get(x)), None) \
            or (SETTINGS["domains"][0] if SETTINGS["domains"] else "")
        SETTINGS["domain"] = nxt
        refresh_library_urls_for_domain()
    save_settings(SETTINGS)
    return list_domains()


@app.get("/api/source-domains")
def list_source_domains():
    """Extra compatible catalogues used for missing titles/anime.
    They do not replace the active StreamingCommunity domain."""
    domains = list(SETTINGS.get("source_domains") or [])
    return {"domains": domains}


@app.post("/api/source-domains/add")
def add_source_domain(payload: DomainPayload):
    d = normalize_source_domain(payload.domain)
    if not d:
        raise HTTPException(status_code=400, detail="Dominio vuoto")
    lst = SETTINGS.setdefault("source_domains", [])
    if d not in lst:
        lst.append(d)
        save_settings(SETTINGS)
    return list_source_domains()


@app.post("/api/source-domains/remove")
def remove_source_domain(payload: DomainPayload):
    d = normalize_source_domain(payload.domain)
    SETTINGS["source_domains"] = [x for x in SETTINGS.get("source_domains", []) if x != d]
    save_settings(SETTINGS)
    return list_source_domains()


@app.post("/api/filters/create")
def create_custom_filter(payload: CustomFilterPayload):
    name = normalize_filter_name(payload.name)
    if not name:
        raise HTTPException(status_code=400, detail="Filtro non valido")
    if name in ("saga", "regista", "genere"):
        return _folders_payload()
    lst = SETTINGS.setdefault("custom_filters", [])
    if name not in lst:
        lst.append(name)
        save_settings(SETTINGS)
    return _folders_payload()


@app.post("/api/filters/rename")
def rename_custom_filter(payload: CustomFilterRenamePayload):
    old = normalize_filter_name(payload.old)
    name = normalize_filter_name(payload.name)
    builtin = {"saga", "regista", "genere"}
    if not old or not name:
        raise HTTPException(status_code=400, detail="Filtro non valido")
    if old in builtin or name in builtin:
        raise HTTPException(status_code=400, detail="Filtro riservato")
    filters = SETTINGS.setdefault("custom_filters", [])
    if old not in filters and not any((f.get("kind") or "") == old for f in _folders()):
        raise HTTPException(status_code=404, detail="Filtro non trovato")
    SETTINGS["custom_filters"] = [x for x in filters if x != old and x != name]
    if name not in SETTINGS["custom_filters"]:
        SETTINGS["custom_filters"].append(name)
    for f in _folders():
        if (f.get("kind") or "") == old:
            f["kind"] = name
    fc = SETTINGS.setdefault("filter_covers", {})
    if old in fc:
        fc[name] = fc.pop(old)
    save_settings(SETTINGS)
    return _folders_payload()


@app.post("/api/filters/delete")
def delete_custom_filter(payload: CustomFilterPayload):
    """Elimina un filtro personalizzato. Le cartelle che lo usavano NON vengono
    perse: tornano semplicemente senza tipologia (finiscono in 'Altre cartelle')."""
    name = normalize_filter_name(payload.name)
    if name in ("saga", "regista", "genere"):
        raise HTTPException(status_code=400, detail="Filtro riservato")
    filters = SETTINGS.setdefault("custom_filters", [])
    SETTINGS["custom_filters"] = [x for x in filters if x != name]
    for f in _folders():
        if (f.get("kind") or "") == name:
            f["kind"] = ""
    fc = SETTINGS.setdefault("filter_covers", {})
    old_cover = fc.pop(name, None)
    if isinstance(old_cover, str) and old_cover.startswith("/covers/filter_"):
        try:
            os.remove(os.path.join(COVERS_DIR, os.path.basename(old_cover)))
        except OSError:
            pass
    save_settings(SETTINGS)
    return _folders_payload()


class FilterCover(BaseModel):
    name: str                # nome del filtro personalizzato (kind)
    filename: Optional[str] = ""
    data: str                # base64 (a "data:" prefix is accepted and stripped)


@app.post("/api/filters/cover")
def set_custom_filter_cover(payload: FilterCover):
    """Imposta/cambia la locandina di un filtro personalizzato (come le cartelle)."""
    name = normalize_filter_name(payload.name)
    if not name or name in ("saga", "regista", "genere"):
        raise HTTPException(status_code=400, detail="Filtro non valido")
    raw = payload.data or ""
    if raw.strip().startswith("data:") and "," in raw:
        raw = raw.split(",", 1)[1]
    try:
        blob = base64.b64decode(raw)
    except Exception:
        raise HTTPException(status_code=400, detail="Immagine non valida")
    if not blob:
        raise HTTPException(status_code=400, detail="Immagine vuota")
    if len(blob) > 8 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Immagine troppo grande (max 8MB)")
    ext = os.path.splitext(payload.filename or "")[1].lower()
    if ext not in (".png", ".jpg", ".jpeg", ".webp", ".gif"):
        ext = ".png"
    h = hashlib.md5(name.encode("utf-8")).hexdigest()[:12]
    fc = SETTINGS.setdefault("filter_covers", {})
    old = fc.get(name, "")
    if isinstance(old, str) and old.startswith("/covers/filter_" + h):
        try:
            os.remove(os.path.join(COVERS_DIR, os.path.basename(old)))
        except OSError:
            pass
    fname = f"filter_{h}{ext}"
    with open(os.path.join(COVERS_DIR, fname), "wb") as fh:
        fh.write(blob)
    fc[name] = f"/covers/{fname}"
    save_settings(SETTINGS)
    return _folders_payload()


@app.post("/api/domain/refresh")
def refresh_domain():
    """Probe known suffixes for a brand-new live StreamingCommunity domain and
    adopt it. Used when none of the remembered domains is alive anymore. The
    found domain is added to the remembered list."""
    global SETTINGS
    domain = detect_active_domain()
    if domain:
        SETTINGS["domain"] = domain
        remember_domain(domain)
        DOMAIN_STATUS[domain] = True
        save_settings(SETTINGS)
        refresh_library_urls_for_domain()
        return {"found": True, "domain": domain}
    return {"found": False, "domain": SETTINGS.get("domain")}


@app.post("/api/shutdown")
def shutdown_server():
    """Spegne il server (usato dal pulsante 'Spegni' dell'interfaccia, cosi'
    l'utente non deve toccare il terminale)."""
    def _stop():
        time.sleep(0.4)
        os._exit(0)
    threading.Thread(target=_stop, daemon=True).start()
    return {"ok": True}

# --------------------------------------------------------------------------- #
#  Content folders (playlists of LIBRARY titles, each with a cover image)
# --------------------------------------------------------------------------- #
class FolderCreate(BaseModel):
    name: str
    kind: Optional[str] = ""
    parent: Optional[str] = ""


class FolderRename(BaseModel):
    id: str
    name: str


class FolderId(BaseModel):
    id: str


class FolderAssign(BaseModel):
    id: Optional[str] = ""   # empty => move the title out of every folder
    key: str                 # library key of the title


class FolderSet(BaseModel):
    id: str
    items: List[str] = []    # library keys to place in the folder


class FolderCover(BaseModel):
    id: str
    filename: Optional[str] = ""
    data: str                # base64 (a "data:" prefix is accepted and stripped)



def _folders():
    return SETTINGS.setdefault("folders", [])


def _library_map():
    return {e.get("key"): e for e in LIBRARY if e.get("key")}


def _title_view(e):
    url = e.get("url", "")
    key = e.get("key") or ""
    if re.match(r"^\d+-[\w-]+$", key):
        url = f"{get_base_url()}/it/titles/{key}"
    return {
        "key": e.get("key"),
        "name": e.get("name") or "Senza titolo",
        "cover": cover_out(e.get("cover", "")),
        "type": e.get("type", ""),
        "release_date": e.get("release_date", ""),
        "is_clone": bool(e.get("is_clone", False)),
        "url": url,
        "favorite": bool(e.get("favorite", False)),
    }


def _folders_payload():
    """Folders (playlists of library titles) plus the titles in no folder."""
    libmap = _library_map()
    assigned = set()
    folders_out = []
    for f in _folders():
        items = []
        names = f.get("names", {})
        for k in f.get("items", []):
            e = libmap.get(k)
            if e:
                tv = _title_view(e)
                if names.get(k):
                    tv["name"] = names[k]   # nome specifico per QUESTA cartella
                items.append(tv)
                assigned.add(k)
        cover = f.get("cover", "")
        if not cover and items:
            dated = [it for it in items if (it.get("release_date") or "").strip() and it.get("cover")]
            if dated:
                cover = min(dated, key=lambda it: it.get("release_date")).get("cover", "")
            else:
                cover = next((it.get("cover") for it in items if it.get("cover")), "")
        folders_out.append({
            "id": f["id"], "name": f.get("name", ""), "cover": cover_out(cover),
            "kind": f.get("kind", ""), "parent": f.get("parent", ""),
            "favorite": bool(f.get("favorite", False)),
            "order": list(f.get("order", [])), "items": items,
        })
    unassigned = [_title_view(e) for e in _sorted_library(LIBRARY)
                  if e.get("key") and e["key"] not in assigned]
    return {"folders": folders_out, "unassigned": unassigned,
            "custom_filters": list(SETTINGS.get("custom_filters") or []),
            "filter_covers": dict(SETTINGS.get("filter_covers") or {})}


@app.get("/api/folders")
def get_folders():
    return _folders_payload()


@app.post("/api/folders/create")
def create_folder(payload: FolderCreate):
    name = (payload.name or "").strip() or "Nuova cartella"
    kind = normalize_filter_name(payload.kind)
    parent = (payload.parent or "").strip()
    if parent and not any(x["id"] == parent for x in _folders()):
        parent = ""
    _folders().append({"id": uuid.uuid4().hex[:8], "name": name, "kind": kind,
                       "parent": parent, "cover": "", "items": []})
    save_settings(SETTINGS)
    return _folders_payload()


@app.post("/api/folders/rename")
def rename_folder(payload: FolderRename):
    f = next((x for x in _folders() if x["id"] == payload.id), None)
    if not f:
        raise HTTPException(status_code=404, detail="Cartella non trovata")
    f["name"] = (payload.name or "").strip() or f["name"]
    save_settings(SETTINGS)
    return _folders_payload()


@app.post("/api/folders/remove")
def remove_folder(payload: FolderId):
    f = next((x for x in _folders() if x["id"] == payload.id), None)
    if f:
        cover = f.get("cover", "")
        if cover.startswith("/covers/"):
            try:
                os.remove(os.path.join(COVERS_DIR, os.path.basename(cover)))
            except OSError:
                pass
        # re-parent any subfolders to the removed folder's parent (don't orphan)
        gp = f.get("parent", "")
        for child in _folders():
            if child.get("parent") == f["id"]:
                child["parent"] = gp
    SETTINGS["folders"] = [x for x in _folders() if x["id"] != payload.id]
    save_settings(SETTINGS)
    return _folders_payload()


@app.post("/api/folders/assign")
def assign_title(payload: FolderAssign):
    k = payload.key
    if payload.id:
        # Add to this folder, keeping the title in any other folder (multi-membership)
        f = next((x for x in _folders() if x["id"] == payload.id), None)
        if not f:
            raise HTTPException(status_code=404, detail="Cartella non trovata")
        if k not in f.setdefault("items", []):
            f["items"].append(k)
    else:
        # empty id => remove the title from every folder
        for f in _folders():
            if k in f.get("items", []):
                f["items"].remove(k)
    save_settings(SETTINGS)
    return _folders_payload()


class FolderItems(BaseModel):
    id: str
    keys: List[str] = []


@app.post("/api/folders/add-items")
def add_items_to_folder(payload: FolderItems):
    """Add several library titles to a folder at once (multi-select). Existing
    membership in other folders is left untouched (multi-membership)."""
    f = next((x for x in _folders() if x["id"] == payload.id), None)
    if not f:
        raise HTTPException(status_code=404, detail="Cartella non trovata")
    libkeys = set(_library_map().keys())
    items = f.setdefault("items", [])
    for k in payload.keys:
        if k in libkeys and k not in items:
            items.append(k)
    save_settings(SETTINGS)
    return _folders_payload()


class FolderItemName(BaseModel):
    id: str
    key: str
    name: Optional[str] = ""


class FolderReorder(BaseModel):
    id: str
    before: str   # id della cartella prima della quale posizionare


class FolderOrder(BaseModel):
    id: str
    order: List[str] = []   # token: chiave titolo oppure "f:<id_sottocartella>"


@app.post("/api/folders/order")
def set_folder_order(payload: FolderOrder):
    """Salva l'ordine manuale combinato (titoli + sottocartelle) dentro una
    cartella. I token sono le chiavi dei titoli o 'f:<id>' per le sottocartelle."""
    f = next((x for x in _folders() if x["id"] == payload.id), None)
    if not f:
        raise HTTPException(status_code=404, detail="Cartella non trovata")
    f["order"] = [t for t in payload.order if isinstance(t, str)]
    save_settings(SETTINGS)
    return _folders_payload()


@app.post("/api/folders/reorder")
def reorder_folders(payload: FolderReorder):
    """Riordina le cartelle: sposta `id` subito PRIMA di `before` rendendole
    sorelle (stesso genitore). Usato dal drag&drop tra cartelle dello stesso
    livello."""
    folders = _folders()
    src = next((x for x in folders if x["id"] == payload.id), None)
    if not src:
        raise HTTPException(status_code=404, detail="Cartella non trovata")
    tgt = next((x for x in folders if x["id"] == payload.before), None)
    if tgt is None:
        # before vuoto/non trovato: sposta in fondo mantenendo il genitore
        folders.remove(src)
        folders.append(src)
        save_settings(SETTINGS)
        return _folders_payload()
    if src is tgt:
        return _folders_payload()
    src["parent"] = tgt.get("parent", "")   # stesso livello del target
    folders.remove(src)
    idx = folders.index(tgt)
    folders.insert(idx, src)
    save_settings(SETTINGS)
    return _folders_payload()


@app.post("/api/folders/rename-item")
def rename_folder_item(payload: FolderItemName):
    """Nome del titolo SPECIFICO per questa cartella (override locale). Vuoto =
    ripristina il nome di libreria. Lo stesso titolo puo' avere nomi diversi in
    cartelle diverse."""
    f = next((x for x in _folders() if x["id"] == payload.id), None)
    if not f:
        raise HTTPException(status_code=404, detail="Cartella non trovata")
    names = f.setdefault("names", {})
    nm = (payload.name or "").strip()
    if nm:
        names[payload.key] = nm
    else:
        names.pop(payload.key, None)
    save_settings(SETTINGS)
    return _folders_payload()


@app.post("/api/folders/favorite")
def toggle_folder_favorite(payload: FolderId):
    """Segna/desegna una cartella come preferita (mostrata in cima alla libreria)."""
    f = next((x for x in _folders() if x["id"] == payload.id), None)
    if not f:
        raise HTTPException(status_code=404, detail="Cartella non trovata")
    f["favorite"] = not f.get("favorite", False)
    save_settings(SETTINGS)
    return _folders_payload()


@app.post("/api/folders/toggle")
def toggle_title_in_folder(payload: FolderAssign):
    """Add the title to the folder if absent, remove it if present (used by the
    per-title 'add to folders' control). Multi-membership: other folders are
    left untouched."""
    f = next((x for x in _folders() if x["id"] == payload.id), None)
    if not f:
        raise HTTPException(status_code=404, detail="Cartella non trovata")
    items = f.setdefault("items", [])
    if payload.key in items:
        items.remove(payload.key)
        present = False
    else:
        items.append(payload.key)
        present = True
    save_settings(SETTINGS)
    return {"present": present, **_folders_payload()}


@app.post("/api/folders/set")
def set_folder_items(payload: FolderSet):
    """Set exactly which library titles belong to THIS folder (multi-select from
    the picker). Titles may belong to several folders at once, so other folders
    are left untouched."""
    f = next((x for x in _folders() if x["id"] == payload.id), None)
    if not f:
        raise HTTPException(status_code=404, detail="Cartella non trovata")
    libkeys = set(_library_map().keys())
    f["items"] = [k for k in payload.items if k in libkeys]
    save_settings(SETTINGS)
    return _folders_payload()


class FolderParent(BaseModel):
    id: str
    parent: Optional[str] = ""


@app.post("/api/folders/parent")
def set_folder_parent(payload: FolderParent):
    f = next((x for x in _folders() if x["id"] == payload.id), None)
    if not f:
        raise HTTPException(status_code=404, detail="Cartella non trovata")
    parent = (payload.parent or "").strip()
    if parent:
        by_id = {x["id"]: x for x in _folders()}
        if parent not in by_id:
            raise HTTPException(status_code=404, detail="Cartella genitore non trovata")
        # prevent cycles: walking up from `parent` must never reach this folder
        cur = parent
        while cur:
            if cur == payload.id:
                raise HTTPException(status_code=400, detail="Spostamento non valido (ciclo)")
            cur = by_id.get(cur, {}).get("parent", "")
    f["parent"] = parent
    save_settings(SETTINGS)
    return _folders_payload()


class FolderKind(BaseModel):
    id: str
    kind: str  # empty, built-in kind, or a custom user filter


@app.post("/api/folders/kind")
def set_folder_kind(payload: FolderKind):
    f = next((x for x in _folders() if x["id"] == payload.id), None)
    if not f:
        raise HTTPException(status_code=404, detail="Cartella non trovata")
    kind = normalize_filter_name(payload.kind)
    if (payload.kind or "").strip() and not kind:
        raise HTTPException(status_code=400, detail="Tipologia non valida")
    f["kind"] = kind
    save_settings(SETTINGS)
    return _folders_payload()


@app.post("/api/folders/cover")
def set_folder_cover(payload: FolderCover):
    f = next((x for x in _folders() if x["id"] == payload.id), None)
    if not f:
        raise HTTPException(status_code=404, detail="Cartella non trovata")
    raw = (payload.data or "").strip()
    if raw.startswith("data:") and "," in raw:
        raw = raw.split(",", 1)[1]
    try:
        blob = base64.b64decode(raw)
    except Exception:
        raise HTTPException(status_code=400, detail="Immagine non valida")
    if not blob:
        raise HTTPException(status_code=400, detail="Immagine vuota")
    if len(blob) > 8 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Immagine troppo grande (max 8MB)")
    ext = os.path.splitext(payload.filename or "")[1].lower()
    if ext not in (".png", ".jpg", ".jpeg", ".webp", ".gif"):
        ext = ".png"
    old = f.get("cover", "")
    if old.startswith("/covers/"):
        try:
            os.remove(os.path.join(COVERS_DIR, os.path.basename(old)))
        except OSError:
            pass
    fname = f"{payload.id}{ext}"
    with open(os.path.join(COVERS_DIR, fname), "wb") as fh:
        fh.write(blob)
    f["cover"] = f"/covers/{fname}"
    save_settings(SETTINGS)
    return _folders_payload()



@app.get("/api/search-legacy")
def search_legacy(q: str):
    base_url = get_base_url()
    url = f"{base_url}/api/search?q={urllib.parse.quote(q)}"
    try:
        resp = sc_get(url, headers=get_headers(), timeout=10)
        if resp.status_code == 200:
            try:
                data = resp.json().get("data", [])
            except ValueError:
                # 200 but not JSON => parked/block page on a dead domain.
                raise _domain_error("La risposta non è valida (pagina di blocco o dominio parcheggiato).")
            # Map search results and truncate to 20 items
            results = []
            for item in data[:20]:
                results.append({
                    "id": item.get("id"),
                    "name": item.get("name"),
                    "slug": item.get("slug"),
                    "type": item.get("type"),
                    "cover": image_url(item.get("images"))
                })
            return results
        else:
            raise HTTPException(status_code=resp.status_code, detail="Failed search request")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="Errore interno del server")


def search_source_domain(domain, q, limit=12):
    """Best-effort HTML search for compatible clone catalogues.
    It is intentionally generic: users can add a domain for anime/missing films
    without coupling it to the rotating StreamingCommunity host."""
    host = normalize_source_domain(domain)
    if not host:
        return []
    host_base = host.removeprefix("www.")
    query = urllib.parse.quote(q)
    candidates = [
        f"https://{host}/?s={query}",
        f"https://{host}/search?q={query}",
        f"https://{host}/search/{query}",
        f"https://{host}/?search={query}",
        f"https://{host}/?story={query}&do=search&subaction=search",
    ]
    out, seen = [], set()
    for url in candidates:
        try:
            resp = session.get(url, headers=get_headers(), timeout=8, verify=False)
            if resp.status_code != 200 or any(m in resp.text.lower() for m in BLOCK_MARKERS):
                continue
            soup = BeautifulSoup(resp.text, "lxml")
            for a in soup.find_all("a", href=True):
                href = urllib.parse.urljoin(url, a.get("href"))
                href_host = normalize_source_domain(urllib.parse.urlparse(href).netloc).removeprefix("www.")
                if not (href_host == host_base or href_host.endswith("." + host_base)):
                    continue
                if not re.search(r"(title|film|serie|anime|stream|guarda|watch|\.html)", href, re.I):
                    continue
                name = " ".join(a.get_text(" ", strip=True).split())
                if len(name) < 2 or len(name) > 90:
                    title_attr = a.get("title") or ""
                    name = " ".join(title_attr.split())
                if not name or href in seen:
                    continue
                img = a.find("img")
                cover = ""
                if img:
                    cover = img.get("data-src") or img.get("src") or ""
                    if cover:
                        cover = urllib.parse.urljoin(url, cover)
                seen.add(href)
                out.append({
                    "id": "",
                    "name": name,
                    "slug": "",
                    "id_and_slug": f"clone-{hashlib.md5(href.encode('utf-8')).hexdigest()[:12]}",
                    "type": "",
                    "score": None,
                    "release_date": "",
                    "genres": [],
                    "cover": cover_out(cover),
                    "url": href,
                    "is_clone": True,
                    "source": host,
                })
                if len(out) >= limit:
                    return out
        except Exception:
            continue
    return out


@app.get("/api/search")
def search(q: str, sort: Optional[str] = None, genre: Optional[str] = None,
           type: Optional[str] = None, sources: Optional[str] = None):
    base_url = get_base_url()
    query = urllib.parse.quote(q)
    # Fonti attive: "sc" = StreamingCommunity, "aw" = AnimeWorld/fonti extra.
    # Default = entrambe. La UI passa le spunte selezionate dall'utente.
    srcs = {x.strip().lower() for x in (sources or "sc,aw").split(",") if x.strip()} or {"sc", "aw"}
    wanted_type = (type or "").strip().lower()
    wanted_genre = (genre or "").strip().lower()
    results = []
    try:
        if "sc" in srcs:
            resp, url = sc_get_first(
                [f"/it/search?q={query}", f"/search?q={query}", f"/api/search?q={query}"],
                headers=get_headers(),
                timeout=10,
            )
            if resp.status_code != 200:
                raise HTTPException(status_code=resp.status_code, detail="Failed search request")

            content_type = resp.headers.get("content-type", "")
            if "application/json" in content_type:
                try:
                    data = resp.json().get("data", [])
                except ValueError:
                    raise _domain_error("La risposta non e valida.")
                cdn_url = None
            else:
                soup = BeautifulSoup(resp.text, "lxml")
                app_div = soup.find("div", {"id": "app"})
                if not app_div:
                    raise HTTPException(status_code=500, detail="Unable to extract search results")
                page_data = json.loads(app_div.get("data-page"))
                data = page_data.get("props", {}).get("titles", [])
                cdn_url = get_cdn_url(page_data)

            for item in data:
                if not isinstance(item, dict):
                    continue
                title_id = item.get("id")
                slug = item.get("slug")
                id_and_slug = f"{title_id}-{slug}" if title_id and slug else ""
                results.append({
                    "id": title_id,
                    "name": item.get("name") or item.get("title") or "Senza titolo",
                    "slug": slug,
                    "id_and_slug": id_and_slug,
                    "type": item.get("type") or "",
                    "score": item.get("score"),
                    "release_date": item.get("last_air_date_it") or item.get("last_air_date") or item.get("release_date"),
                    "genres": [],
                    "cover": image_url(item.get("images"), cdn_url=cdn_url),
                    "url": f"{base_url}/it/titles/{id_and_slug}" if id_and_slug else "",
                })

            if wanted_type in ("movie", "tv"):
                results = [r for r in results if (r.get("type") or "") == wanted_type]

            if wanted_genre:
                filtered = []
                for item in results:
                    if not item.get("id_and_slug"):
                        continue
                    try:
                        details = get_details(item["id_and_slug"])
                        item["genres"] = details.get("genres", [])
                        if any(wanted_genre in (g or "").lower() for g in item["genres"]):
                            filtered.append(item)
                    except Exception:
                        pass
                results = filtered

            if sort == "score":
                results.sort(key=lambda x: float(x.get("score") or 0), reverse=True)
            elif sort == "recent":
                results.sort(key=lambda x: x.get("release_date") or "", reverse=True)
            elif sort == "oldest":
                results.sort(key=lambda x: x.get("release_date") or "9999")

        # Fonti EXTRA (AnimeWorld ecc.): gia' filtrate per rilevanza -> messe IN CIMA.
        extra = []
        # AnimeWorld/fonti extra: sono SERIE (anime). Le includiamo solo se l'utente
        # non ha filtrato per "film" e non per genere, cosi' non inquinano le liste
        # di film. Vengono aggiunte DOPO i risultati SC (primari).
        if "aw" in srcs and not wanted_genre and wanted_type != "movie":
            for d in SETTINGS.get("source_domains", []):
                if "animeworld" in (d or "").lower():
                    try:
                        for it in animeworld.search(q, host=normalize_source_domain(d) or "www.animeworld.ac", proxies=get_proxies()):
                            extra.append({
                                "id": "", "name": it["title"], "slug": "",
                                "id_and_slug": it["key"], "type": "tv", "score": None,
                                "release_date": "", "genres": [], "cover": cover_out(it["cover"]),
                                "url": it["url"], "is_clone": True, "is_animeworld": True,
                                "source": "animeworld",
                            })
                    except Exception as _e:
                        print(f"[animeworld] search merge failed: {_e}")
                else:
                    extra.extend(search_source_domain(d, q))
        return results + extra
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="Errore interno del server")

@app.get("/api/search/list")
def search_list(q: str, sources: Optional[str] = "sc"):
    """Ricerca a LISTA: piu' titoli separati da ';' (per importare al volo intere
    saghe/collezioni). Ritorna il miglior risultato per ciascun titolo.
    Di default cerca SOLO su StreamingCommunity ("sc"): l'import a lista serve per
    film/serie e includere AnimeWorld farebbe finire anime a caso al posto dei film
    che SC non trova esattamente."""
    terms = [t.strip() for t in (q or "").split(";") if t.strip()][:60]
    if not terms:
        return []

    dom_err = {"exc": None}

    def one(term):
        try:
            r = search(term, sources=sources)
            if r:
                item = dict(r[0])
                item["_term"] = term
                item["_found"] = True
                return item
        except HTTPException as he:
            if isinstance(he.detail, dict) and he.detail.get("domain_error"):
                dom_err["exc"] = he
        except Exception:
            pass
        return {"name": term, "_term": term, "_found": False, "id_and_slug": ""}

    with ThreadPoolExecutor(max_workers=8) as ex:
        results = list(ex.map(one, terms))

    # Se nulla e' stato trovato per colpa del dominio non raggiungibile, segnalalo
    # esplicitamente (503) cosi' il frontend mostra il prompt "aggiorna dominio".
    if dom_err["exc"] is not None and not any(r.get("_found") for r in results):
        raise dom_err["exc"]
    return results


@app.get("/api/details/{id_and_slug}")
def get_details(id_and_slug: str):
    if id_and_slug.startswith("clone-"):
        # For clone contents, details are loaded directly during URL resolution
        raise HTTPException(status_code=400, detail="Cannot load details directly for clone titles")

    try:
        resp, url = sc_get_first(
            [f"/it/titles/{id_and_slug}", f"/titles/{id_and_slug}"],
            headers=get_headers(),
            timeout=10,
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail="Content not found")
        
        soup = BeautifulSoup(resp.text, "lxml")
        app_div = soup.find("div", {"id": "app"})
        if not app_div:
            raise HTTPException(status_code=500, detail="Unable to extract page state")
            
        page_data = json.loads(app_div.get("data-page"))
        title_info = page_data.get("props", {}).get("title", {})
        cdn_url = get_cdn_url(page_data)
        
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
            "cover": image_url(title_info.get("images"), cdn_url=cdn_url),
            "seasons": [],
            "version": page_data.get("version")
        }
        
        if details["type"] == "tv":
            details["seasons"] = [
                {"number": s.get("number"), "episodes_count": s.get("episodes_count")}
                for s in title_info.get("seasons", [])
            ]

        return details
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="Errore interno del server")

@app.get("/api/details/{id_and_slug}/season/{season_number}")
def get_season_episodes(id_and_slug: str, season_number: int, version: str):
    headers = get_headers()
    headers.update({
        'X-Inertia': 'true',
        'X-Inertia-Version': version,
    })
    
    try:
        resp, url = sc_get_first(
            [
                f"/it/titles/{id_and_slug}/season-{season_number}",
                f"/it/titles/{id_and_slug}/stagione-{season_number}",
                f"/titles/{id_and_slug}/season-{season_number}",
                f"/titles/{id_and_slug}/stagione-{season_number}",
            ],
            headers=headers,
            timeout=10,
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail="Season not found")

        try:
            data = resp.json()
        except ValueError:
            raise _domain_error("La risposta della stagione non è valida (dominio non più attivo).")
        cdn_url = get_cdn_url(data)
        episodes = data.get("props", {}).get("loadedSeason", {}).get("episodes", [])

        results = []
        for ep in episodes:
            results.append({
                "id": ep.get("id"),
                "number": ep.get("number"),
                "name": ep.get("name"),
                "plot": ep.get("plot"),
                "duration": ep.get("duration"),
                "cover": image_url(ep.get("images"), cdn_url=cdn_url)
            })
        return results
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="Errore interno del server")

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
    lib_key: Optional[str] = ""
    cover: Optional[str] = ""


class AWEpisode(BaseModel):
    url: Optional[str] = ""
    id: Optional[str] = ""
    host: Optional[str] = "www.animeworld.ac"
    title: Optional[str] = ""
    lib_key: Optional[str] = ""
    cover: Optional[str] = ""


def _aw_resolve_mp4(url="", ep_id="", host="www.animeworld.ac"):
    info = animeworld.resolve_episode(url=url or None, episode_id=ep_id or None,
                                      host=host or "www.animeworld.ac", proxies=get_proxies())
    mp4 = info.get("mp4_url", "")
    if not mp4 or not _is_safe_remote_url(mp4):
        raise HTTPException(status_code=502, detail="Flusso AnimeWorld non disponibile")
    return info, mp4


@app.get("/api/animeworld/resolve")
def animeworld_resolve(url: str):
    """Serie AnimeWorld con la lista episodi (per il frontend)."""
    try:
        return animeworld.get_series(url, proxies=get_proxies())
    except Exception as e:
        raise HTTPException(status_code=502, detail="Errore interno del server")


@app.get("/api/animeworld/stream")
def animeworld_stream(url: Optional[str] = "", id: Optional[str] = "", host: Optional[str] = "www.animeworld.ac"):
    """Risolve un episodio AnimeWorld nell'mp4 diretto (per la riproduzione)."""
    info, mp4 = _aw_resolve_mp4(url or "", id or "", host or "www.animeworld.ac")
    return {"stream_url": mp4, "title": info.get("title", ""), "cover": info.get("cover", "")}


@app.post("/api/animeworld/download")
def animeworld_download(payload: AWEpisode):
    """Risolve un episodio AnimeWorld e ne avvia il download (mp4 diretto)."""
    info, mp4 = _aw_resolve_mp4(payload.url or "", payload.id or "", payload.host or "www.animeworld.ac")
    download_id = str(uuid.uuid4())
    if payload.lib_key:
        DOWNLOAD_KEYS[download_id] = payload.lib_key
        local_cover = cache_cover_local(payload.lib_key, payload.cover or info.get("cover", ""))
        if local_cover:
            e = next((x for x in LIBRARY if x.get("key") == payload.lib_key), None)
            if e and e.get("cover") != local_cover:
                e["cover"] = local_cover
                save_library(LIBRARY)
    start_download_task(
        download_id=download_id,
        title=payload.title or info.get("title") or "AnimeWorld",
        m3u8_video=mp4,
        m3u8_audio=None,
        key_info=None,
        extra_headers={"Referer": f"https://{payload.host or 'www.animeworld.ac'}/"},
        vidxgo_meta=None,
        proxies=get_proxies(),
    )
    return {"download_id": download_id}


@app.get("/api/clone/episodes")
def clone_episodes(tmdb_tv_id: int, season: int, iframe_url: str):
    """List episodes (names/plots) for a vidxgo series season."""
    try:
        return vidxgo.list_episodes(tmdb_tv_id, season, iframe_url)
    except Exception as e:
        raise HTTPException(status_code=500, detail="Errore interno del server")


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
    if payload.lib_key:
        DOWNLOAD_KEYS[download_id] = payload.lib_key
        local_cover = cache_cover_local(payload.lib_key, payload.cover or "")
        if local_cover:
            e = next((x for x in LIBRARY if x.get("key") == payload.lib_key), None)
            if e and e.get("cover") != local_cover:
                e["cover"] = local_cover
                save_library(LIBRARY)
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

    # 1b. AnimeWorld (player/grabber proprio, non Vixcloud)
    if animeworld.is_animeworld_url(url):
        try:
            info = animeworld.get_series(url, proxies=get_proxies())
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"AnimeWorld non raggiungibile: {e}")
        return {
            "is_clone": True,
            "is_animeworld": True,
            "title": info.get("title") or "AnimeWorld",
            "cover": cover_out(info.get("cover", "")),
            "plot": info.get("plot", ""),
            "iframe_url": "",
            "stream_url": "",
            "host": info.get("host", ""),
            "episodes": info.get("episodes", []),
            "id_and_slug": animeworld._key_for(url),
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
        resp_obj["id_and_slug"] = f"vidxgo-{hashlib.md5(url.encode('utf-8')).hexdigest()[:12]}"
        return resp_obj

    # Parse query parameters to extract episode_id
    query_params = urllib.parse.parse_qs(parsed.query)
    episode_id = query_params.get("e", [None])[0] or query_params.get("episode_id", [None])[0]
    if episode_id:
        try:
            episode_id = int(episode_id)
        except ValueError:
            episode_id = None
            
    source_hosts = {normalize_source_domain(d).removeprefix("www.") for d in SETTINGS.get("source_domains", [])}
    cur_host = normalize_source_domain(netloc).removeprefix("www.")
    is_extra_source = any(cur_host == h or cur_host.endswith("." + h) for h in source_hosts if h)
    if "streaming" not in netloc and not is_extra_source:
        raise HTTPException(status_code=400, detail="Invalid domain. Must be a StreamingCommunity link, a direct stream (.m3u8/.mp4) or a vidxgo URL.")
        
    # Un link NATIVO StreamingCommunity ha il path /it/titles/{id-slug}. I nuovi
    # domini spesso contengono un trattino: NON deve piu' far scattare la modalita'
    # "clone" (che perde il download automatico Vixcloud). Distinguiamo dal PATH.
    _native_sc_path = bool(re.search(r"/(?:[a-z]{2}/)?titles/\d+", path))
    is_clone = is_extra_source or ("watch" in netloc) or (not _native_sc_path)
    
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
                resp_obj["id_and_slug"] = f"clone-{hashlib.md5(url.encode('utf-8')).hexdigest()[:12]}"
                return resp_obj
        except Exception as e:
            print(f"[-] Error parsing clone: {e}")
            raise HTTPException(status_code=500, detail="Errore nell'analisi del sito clone")
            
    # Automatically update settings domain if user pastes a different active domain!
    pasted_domain = normalize_domain(netloc)
    if pasted_domain != normalize_domain(SETTINGS["domain"]):
        SETTINGS["domain"] = pasted_domain
        remember_domain(pasted_domain)
        DOMAIN_STATUS[pasted_domain] = True  # we just reached it successfully
        save_settings(SETTINGS)
        print(f"[+] Automatically updated active domain to: {pasted_domain}")
        
    # Match: /titles/24932-guarda-visualizza...
    # We want to match: /titles/(\d+)-([^/]+)
    titles_match = re.search(r"(?:/[a-z]{2})?/titles/(\d+)-([^/]+)", path)
    if titles_match:
        slug_part = titles_match.group(2)
        slug_part = slug_part.split("/")[0] # remove trailing parts if any (e.g. /watching.html)
        res = {"id_and_slug": f"{titles_match.group(1)}-{slug_part}"}
        if episode_id:
            res["episode_id"] = episode_id
            res["title_id"] = int(titles_match.group(1))
        return res
        
    # Match: /watch/(\d+)
    watch_match = re.search(r"(?:/[a-z]{2})?/watch/(\d+)", path)
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

def resolve_stream_info(id, episode_id=None):
    base_url = get_base_url()
    
    # 1. Fetch iframe url from streamingcommunity
    iframe_paths = []
    if episode_id:
        iframe_paths = [
            f"/it/iframe/{id}?episode_id={episode_id}&next_episode=1",
            f"/iframe/{id}?episode_id={episode_id}&next_episode=1",
        ]
    else:
        iframe_paths = [f"/it/iframe/{id}", f"/iframe/{id}"]
        
    try:
        headers = get_headers()
        if episode_id:
            headers['Referer'] = f"{base_url}/it/watch/{id}?e={episode_id}"
            
        resp, url = sc_get_first(iframe_paths, headers=headers, timeout=10)
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail="Failed to fetch iframe page")

        soup = BeautifulSoup(resp.text, "lxml")
        iframe = soup.find("iframe")
        if not iframe:
            raise HTTPException(status_code=404, detail="Iframe not found (video might not be available)")
            
        vix_embed_url = iframe.get("src")
        if vix_embed_url and vix_embed_url.startswith("//"):
            vix_embed_url = "https:" + vix_embed_url   # a volte l'src e' protocol-relative

        # 2. Fetch Vixcloud/vixsrc embed page. Il player rifiuta (403) le richieste
        # "nude": va simulato un vero browser che carica l'iframe -> Referer = la
        # pagina iframe di StreamingCommunity, Origin del sito e header Sec-Fetch.
        vix_headers = get_headers()
        vix_headers.update({
            "Referer": url,
            "Origin": base_url.rstrip("/"),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
            "Sec-Fetch-Dest": "iframe",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "cross-site",
            "Upgrade-Insecure-Requests": "1",
        })
        embed_resp = _fetch_maybe_cloudflare(vix_embed_url, headers=vix_headers, timeout=12,
                                             proxies=get_proxies())
        if embed_resp is None or embed_resp.status_code != 200:
            # Secondo tentativo con Referer = home del sito (alcuni mirror lo pretendono cosi').
            vix_headers["Referer"] = f"{base_url}/"
            embed_resp = _fetch_maybe_cloudflare(vix_embed_url, headers=vix_headers, timeout=12,
                                                 proxies=get_proxies())
        if embed_resp is not None and embed_resp.status_code == 200:
            html_content = embed_resp.text
        else:
            # requests/cloudscraper bloccati da Cloudflare: apri l'embed in un vero
            # browser headless (Playwright), che supera la challenge come il tuo browser.
            _host = urllib.parse.urlparse(vix_embed_url).netloc
            print(f"[vix] embed bloccato ({getattr(embed_resp,'status_code','?')}) su {_host}: provo con browser headless…")
            html_content = _browser_get_html(vix_embed_url, referer=url) or ""
            if ("window.video" not in html_content) and ("window.streams" not in html_content):
                _code = getattr(embed_resp, "status_code", 403) or 403
                _has_pw = False
                try:
                    import playwright  # noqa
                    _has_pw = True
                except Exception:
                    _has_pw = False
                if not _has_pw:
                    _detail = (f"Il player {_host} e' protetto da Cloudflare. Serve la modalita' browser: "
                               f"chiudi e RIAVVIA SC Portal per installare il browser headless (una tantum), poi riprova.")
                else:
                    _detail = (f"Il player {_host} e' protetto da Cloudflare e il browser headless non e' riuscito a "
                               f"superare la verifica. Riprova (a volte serve un secondo tentativo) o con la VPN spenta.")
                raise HTTPException(status_code=_code, detail=_detail)
        
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

        # New Vixcloud embeds expose the playable master URL in window.streams
        # (usually /playlist/{id}?ub=1). The old direct playlist URL without
        # ub/h/scz/lang now returns 403, so mirror the official player setup.
        stream_base_url = f"https://vixcloud.co/playlist/{video_id}"
        streams_match = re.search(r"window\.streams\s*=\s*(\[.*?\]);", html_content, re.S)
        if streams_match:
            try:
                streams = json.loads(streams_match.group(1).replace("\\/", "/"))
                active_stream = next((s for s in streams if s.get("active")), streams[0] if streams else None)
                if active_stream and active_stream.get("url"):
                    stream_base_url = active_stream["url"]
            except Exception:
                pass

        master_parts = urllib.parse.urlparse(stream_base_url)
        master_qs = urllib.parse.parse_qs(master_parts.query)
        for k, v in params_json.items():
            if v:
                master_qs[k] = [str(v)]
        embed_qs = urllib.parse.parse_qs(urllib.parse.urlparse(vix_embed_url).query)
        if embed_qs.get("canPlayFHD") or "window.canPlayFHD = true" in html_content:
            master_qs["h"] = ["1"]
        if embed_qs.get("scz"):
            master_qs["scz"] = [embed_qs["scz"][0]]
        if embed_qs.get("lang"):
            master_qs["lang"] = [embed_qs["lang"][0]]
        real_master_url = urllib.parse.urlunparse(master_parts._replace(query=urllib.parse.urlencode(master_qs, doseq=True)))

        download_info = {}
        try:
            master_resp = requests.get(real_master_url, headers=get_headers(), timeout=10, verify=False, proxies=get_proxies())
            if master_resp.status_code == 200:
                master = m3u8.loads(master_resp.text)
                if master.playlists:
                    best = max(master.playlists, key=lambda p: p.stream_info.bandwidth or 0)
                    qualities = []
                    for p in sorted(master.playlists, key=lambda p: p.stream_info.bandwidth or 0, reverse=True):
                        res = p.stream_info.resolution
                        if res and len(res) > 1:
                            q = f"{res[1]}p"
                            if q not in qualities:
                                qualities.append(q)
                    audio = next((m for m in master.media if m.type == "AUDIO" and m.default == "YES" and m.uri), None)
                    if not audio:
                        audio = next((m for m in master.media if m.type == "AUDIO" and m.uri), None)
                    download_info = {
                        "master_url": real_master_url,
                        "video_url": best.absolute_uri or urllib.parse.urljoin(real_master_url, best.uri),
                        "audio_url": (audio.absolute_uri or urllib.parse.urljoin(real_master_url, audio.uri)) if audio else None,
                        "headers": get_headers(),
                    }
        except Exception as e:
            print(f"[-] Could not pre-resolve Vixcloud download playlists: {e}")
        
        # Build master playlist proxy URL
        master_proxy_url = f"/api/stream/master.m3u8?url={urllib.parse.quote(real_master_url, safe='')}"
        
        return {
            "video_id": video_id,
            "title": video_json.get("name") or "video",
            "qualities": qualities,
            "master_url": master_proxy_url,
            "iframe_url": vix_embed_url,
            "params": params_json,
            "download": download_info,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="Errore interno del server")

@app.get("/api/stream/master.m3u8")
def get_master_playlist(url: Optional[str] = None, video_id: Optional[int] = None,
                        token: Optional[str] = None, expires: Optional[str] = None,
                        t: Optional[str] = None):
    if not url:
        if not video_id or not token or not expires:
            raise HTTPException(status_code=400, detail="Playlist URL mancante")
        url = f"https://vixcloud.co/playlist/{video_id}?token={token}&expires={expires}"
    if not video_id:
        m = re.search(r"/playlist/(\d+)", url)
        if m:
            video_id = int(m.group(1))
    if not _is_safe_remote_url(url):
        raise HTTPException(status_code=400, detail="URL non consentito")
    try:
        resp = requests.get(url, headers=get_headers(), timeout=10, verify=False, proxies=get_proxies())
        if resp.status_code != 200:
            return Response(status_code=resp.status_code, content="Master playlist request failed")
            
        content = resp.text
        lines = content.splitlines()
        rewritten_lines = []
        _tq = ("&t=" + urllib.parse.quote(t)) if t else ""  # propaga il token LAN

        for line in lines:
            line = line.strip()
            if not line:
                rewritten_lines.append(line)
            elif line.startswith("#"):
                # EXT-X-MEDIA (audio/sottotitoli): riscrive l'URI (assoluto O relativo)
                if 'URI="' in line:
                    uri_match = re.search(r'URI="([^"]+)"', line)
                    if uri_match:
                        abs_uri = urllib.parse.urljoin(url, uri_match.group(1))
                        encoded_url = urllib.parse.quote(abs_uri, safe="")
                        rewritten_uri = f"/api/stream/subplaylist.m3u8?url={encoded_url}&video_id={video_id or 0}{_tq}"
                        line = line.replace(uri_match.group(1), rewritten_uri)
                rewritten_lines.append(line)
            else:
                # URI della variante video: puo' essere ASSOLUTO o RELATIVO -> risolvi e proxa
                abs_url = urllib.parse.urljoin(url, line)
                encoded_url = urllib.parse.quote(abs_url, safe="")
                rewritten_lines.append(f"/api/stream/subplaylist.m3u8?url={encoded_url}&video_id={video_id or 0}{_tq}")
                
        return Response(content="\n".join(rewritten_lines), media_type="application/vnd.apple.mpegurl")
    except Exception as e:
        raise HTTPException(status_code=500, detail="Errore interno del server")

@app.get("/api/stream/subplaylist.m3u8")
def get_sub_playlist(url: str, video_id: int, t: Optional[str] = None):
    if not _is_safe_remote_url(url):
        raise HTTPException(status_code=400, detail="URL non consentito")
    try:
        resp = requests.get(url, headers=get_headers(), timeout=10, verify=False, proxies=get_proxies())
        if resp.status_code != 200:
            return Response(status_code=resp.status_code, content="Sub-playlist request failed")
            
        content = resp.text
        lines = content.splitlines()
        rewritten_lines = []
        _tq = ("&t=" + urllib.parse.quote(t)) if t else ""  # propaga il token LAN

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
                    encoded_key_url = urllib.parse.quote(orig_key_url, safe="")
                    encoded_referer = urllib.parse.quote(referer, safe="")
                    
                    local_key_url = f"/api/stream/key?url={encoded_key_url}&referer={encoded_referer}{_tq}"
                    line = line.replace(orig_key_url, local_key_url)
                rewritten_lines.append(line)
            elif line.startswith("#") or not line:
                rewritten_lines.append(line)
            else:
                # Segment files are proxied locally too. This avoids browser CORS
                # failures and keeps the same referer/proxy behaviour as keys.
                absolute_ts_url = urllib.parse.urljoin(url, line)
                referer = f"https://vixcloud.co/embed/{video_id}?token={token_render}&referer=1&expires={expires}"
                encoded_seg_url = urllib.parse.quote(absolute_ts_url, safe="")
                encoded_referer = urllib.parse.quote(referer, safe="")
                rewritten_lines.append(f"/api/stream/segment?url={encoded_seg_url}&referer={encoded_referer}{_tq}")
                
        return Response(content="\n".join(rewritten_lines), media_type="application/vnd.apple.mpegurl")
    except Exception as e:
        raise HTTPException(status_code=500, detail="Errore interno del server")

@app.get("/api/stream/segment")
def get_stream_segment(url: str, referer: str):
    if not _is_safe_remote_url(url):
        raise HTTPException(status_code=400, detail="URL non consentito")
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": referer,
    }
    try:
        resp = requests.get(url, headers=headers, timeout=20, verify=False, proxies=get_proxies())
        if resp.status_code != 200:
            return Response(status_code=resp.status_code, content="Segment request failed")
        content_type = resp.headers.get("content-type") or "video/mp2t"
        return Response(content=resp.content, media_type=content_type)
    except Exception as e:
        raise HTTPException(status_code=500, detail="Errore interno del server")

@app.get("/api/stream/key")
def get_stream_key(url: str, referer: str):
    if not _is_safe_remote_url(url):
        raise HTTPException(status_code=400, detail="URL non consentito")
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": referer
    }
    try:
        resp = requests.get(url, headers=headers, timeout=10, verify=False, proxies=get_proxies())
        if resp.status_code == 200:
            return Response(content=resp.content, media_type="application/octet-stream")
        else:
            raise HTTPException(status_code=resp.status_code, detail="Failed to fetch key")
    except Exception as e:
        raise HTTPException(status_code=500, detail="Errore interno del server")

@app.post("/api/download")
def download_media(payload: DownloadRequest):
    for _u in (payload.m3u8_video, payload.m3u8_audio):
        if _u and not _is_safe_remote_url(_u):
            raise HTTPException(status_code=400, detail="URL di download non consentito")
    download_id = str(uuid.uuid4())
    
    vixcloud_meta = {"sc_id": payload.sc_id, "episode_id": payload.episode_id} if payload.sc_id else None
    if payload.lib_key:
        DOWNLOAD_KEYS[download_id] = payload.lib_key
        cover = payload.cover or ""
        if not cover:
            e = next((x for x in LIBRARY if x.get("key") == payload.lib_key), None)
            cover = (e or {}).get("cover", "")
        local_cover = cache_cover_local(payload.lib_key, cover)
        if local_cover:
            e = next((x for x in LIBRARY if x.get("key") == payload.lib_key), None)
            if e and e.get("cover") != local_cover:
                e["cover"] = local_cover
                save_library(LIBRARY)
    start_download_task(
        download_id=download_id,
        title=payload.title,
        m3u8_video=payload.m3u8_video,
        m3u8_audio=payload.m3u8_audio,
        key_info=payload.key_info,
        extra_headers=payload.stream_headers,
        vidxgo_meta=payload.vidxgo,
        vixcloud_meta=vixcloud_meta,
        proxies=get_proxies(),
    )

    return {"download_id": download_id}


class DownloadTitle(BaseModel):
    id: int                              # StreamingCommunity title id
    episode_id: Optional[int] = None
    title: str = "Video"
    key: Optional[str] = ""              # library key


@app.post("/api/download/title")
def download_title(payload: DownloadTitle):
    """Risolve lo stream e avvia il download di un titolo della libreria (usato
    dal player per scaricare i titoli connessi: precedente/successivo)."""
    info = resolve_stream_info(payload.id, payload.episode_id)
    dl = info.get("download") or {}
    if not dl.get("video_url"):
        raise HTTPException(status_code=400, detail="Stream non disponibile per il download")
    download_id = str(uuid.uuid4())
    if payload.key:
        DOWNLOAD_KEYS[download_id] = payload.key
    vixcloud_meta = {"sc_id": payload.id, "episode_id": payload.episode_id}
    start_download_task(
        download_id=download_id,
        title=payload.title or info.get("title") or "Video",
        m3u8_video=dl["video_url"],
        m3u8_audio=dl.get("audio_url"),
        key_info=None,
        extra_headers=dl.get("headers"),
        vidxgo_meta=None,
        vixcloud_meta=vixcloud_meta,
        proxies=get_proxies(),
    )
    return {"download_id": download_id}


class NextEpisode(BaseModel):
    series: str
    season: int
    episode: int
    direction: Optional[str] = "next"


@app.post("/api/download/next-episode")
def download_next_episode(payload: NextEpisode):
    """Scarica la puntata SUCCESSIVA a quella indicata (ep+1 stessa stagione, o
    prima della stagione dopo). Risolve online serie/episodio a partire dal nome."""
    q = (payload.series or "").strip()
    if not q:
        raise HTTPException(status_code=400, detail="Serie non specificata")
    results = search(q)
    match = next((r for r in results if r.get("type") == "tv" and r.get("id_and_slug")), None) \
        or next((r for r in results if r.get("id_and_slug")), None)
    if not match:
        raise HTTPException(status_code=404, detail=f"Serie '{q}' non trovata")
    id_and_slug = match["id_and_slug"]
    details = get_details(id_and_slug)
    version = details.get("version")
    seasons = {s.get("number"): s.get("episodes_count") for s in details.get("seasons", [])}
    direction = (payload.direction or "next").lower()
    if direction == "prev":
        next_season, next_ep = payload.season, payload.episode - 1
        if next_ep < 1:
            next_season = payload.season - 1
            if next_season < 1 or (seasons and next_season not in seasons):
                raise HTTPException(status_code=404, detail="Nessun episodio precedente")
            cnt = seasons.get(next_season)
            if not cnt:
                prev_eps = get_season_episodes(id_and_slug, next_season, version)
                cnt = max((e.get("number") or 0 for e in prev_eps), default=0)
            if not cnt:
                raise HTTPException(status_code=404, detail="Nessun episodio precedente")
            next_ep = cnt
    else:
        next_season, next_ep = payload.season, payload.episode + 1
        cur_count = seasons.get(payload.season)
        if cur_count and next_ep > cur_count:
            next_season, next_ep = payload.season + 1, 1
        if seasons and next_season not in seasons:
            raise HTTPException(status_code=404, detail="Non ci sono altri episodi (serie terminata)")
    eps = get_season_episodes(id_and_slug, next_season, version)
    epobj = next((e for e in eps if e.get("number") == next_ep), None)
    if not epobj and next_ep == 1 and eps:
        epobj = eps[0]
    if not epobj:
        raise HTTPException(status_code=404, detail=f"Episodio S{next_season}E{next_ep} non trovato")
    try:
        numeric_id = int(match.get("id") or id_and_slug.split("-")[0])
    except Exception:
        numeric_id = match.get("id")
    info = resolve_stream_info(numeric_id, epobj["id"])
    dl = info.get("download") or {}
    if not dl.get("video_url"):
        raise HTTPException(status_code=400, detail="Stream dell'episodio non disponibile")
    label = f"{details.get('name') or q} S{next_season:02d}E{next_ep:02d}"
    download_id = str(uuid.uuid4())
    DOWNLOAD_KEYS[download_id] = id_and_slug
    local_cover = cache_cover_local(id_and_slug, details.get("cover", "") or match.get("cover", ""))
    if local_cover:
        e = next((x for x in LIBRARY if x.get("key") == id_and_slug), None)
        if e and e.get("cover") != local_cover:
            e["cover"] = local_cover
            save_library(LIBRARY)
    start_download_task(
        download_id=download_id, title=label,
        m3u8_video=dl["video_url"], m3u8_audio=dl.get("audio_url"),
        key_info=None, extra_headers=dl.get("headers"), vidxgo_meta=None,
        vixcloud_meta={"sc_id": numeric_id, "episode_id": epobj["id"]},
        proxies=get_proxies(),
    )
    return {"ok": True, "label": label, "season": next_season, "episode": next_ep}


@app.get("/api/stream/url")
def get_stream_details(id: int, episode_id: Optional[int] = None):
    return resolve_stream_info(id, episode_id)


# Let the downloader re-resolve fresh Vixcloud tokens when they expire mid-download.
import downloader as _dl
_dl.set_stream_resolver(resolve_stream_info)

DOWNLOAD_KEYS = {}  # download_id -> library key (collega i file ai titoli)


def _norm_title(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (value or "").lower())


def _episode_series_name(title: str) -> str:
    m = re.search(r"(.+?)\s+S\d{1,2}E\d{1,2}\b", title or "", re.I)
    return (m.group(1).strip() if m else "")


def _library_item_for_download(item: dict):
    key = (item or {}).get("key") or ""
    if key:
        found = next((e for e in LIBRARY if e.get("key") == key), None)
        if found:
            return found
    title = (item or {}).get("title") or (item or {}).get("name") or ""
    nt = _norm_title(title)
    if not nt:
        return None
    found = next((e for e in LIBRARY if _norm_title(e.get("name", "")) == nt), None)
    if found:
        return found
    series = _norm_title(_episode_series_name(title))
    if series:
        found = next((e for e in LIBRARY if _norm_title(e.get("name", "")) == series), None)
        if found:
            return found
    return next((e for e in LIBRARY
                 if len(_norm_title(e.get("name", ""))) > 2
                 and (nt in _norm_title(e.get("name", "")) or _norm_title(e.get("name", "")) in nt)), None)


@app.get("/api/download/status")
def get_download_status():
    out = []
    stale = []
    for d in list(active_downloads.values()):
        item = dict(d)
        did = item.get("id")
        item["key"] = DOWNLOAD_KEYS.get(did)
        info = _library_item_for_download(item)
        if info and info.get("cover"):
            item["cover"] = cover_out(info.get("cover", ""))
        # Un download completato il cui file e' stato ELIMINATO dal disco non deve
        # piu' comparire (altrimenti resta una voce "morta" che non si riproduce):
        # lo togliamo dallo stato in memoria cosi' sparisce dalla lista.
        if item.get("status") == "completed":
            path = download_paths.get(did) or item.get("file")
            if not path or not os.path.exists(path):
                stale.append(did)
                continue
        out.append(item)
    for did in stale:
        active_downloads.pop(did, None)
        download_paths.pop(did, None)
        try:
            DOWNLOAD_KEYS.pop(did, None)
        except Exception:
            pass
    return out


@app.post("/api/download/cancel")
def cancel_download_endpoint(payload: dict):
    """Stop a queued or in-progress download and drop its partial files."""
    download_id = payload.get("id", "")
    if not cancel_download(download_id):
        raise HTTPException(status_code=404, detail="Download non trovato")
    return {"ok": True}


# --------------------------------------------------------------------------- #
#  Library endpoints
# --------------------------------------------------------------------------- #
class LibraryEntry(BaseModel):
    # Stable identity used for de-duplication. For native/clone titles this is
    # the resolver's id_and_slug; otherwise the URL itself.
    key: str
    url: str
    name: Optional[str] = ""
    cover: Optional[str] = ""
    type: Optional[str] = ""           # "movie" | "tv" | ""
    release_date: Optional[str] = ""   # year/date of release (for recency sort)
    is_clone: Optional[bool] = False


class LibraryKey(BaseModel):
    key: str


@app.get("/api/library")
def get_library():
    return _sorted_library(LIBRARY)


@app.post("/api/library")
def add_library(entry: LibraryEntry):
    """Add or update a title in the library (called when a title is opened or
    downloaded). De-duplicates on `key`, preserving the favourite flag."""
    global LIBRARY
    key = (entry.key or entry.url or "").strip()
    if not key:
        raise HTTPException(status_code=400, detail="Voce libreria senza chiave/URL")
    now = int(time.time())
    local_cover = cache_cover_local(key, entry.cover or "")
    existing = next((e for e in LIBRARY if e.get("key") == key), None)
    if existing:
        # Re-opening a title must NOT wipe the user's customisations: a renamed
        # title, an uploaded cover and the favourite flag are all preserved.
        existing["url"] = entry.url or existing.get("url")
        if not (existing.get("name") or "").strip():
            existing["name"] = entry.name or existing.get("name")
        cur_cover = existing.get("cover", "")
        if local_cover:
            existing["cover"] = local_cover
        elif not (isinstance(cur_cover, str) and cur_cover.startswith("/covers/")):
            existing["cover"] = entry.cover or cur_cover
        existing["type"] = entry.type or existing.get("type")
        if not (existing.get("release_date") or "").strip():
            existing["release_date"] = entry.release_date or existing.get("release_date", "")
        existing["is_clone"] = bool(entry.is_clone)
    else:
        LIBRARY.append({
            "key": key,
            "url": entry.url,
            "name": entry.name or "Senza titolo",
            "cover": local_cover or entry.cover or "",
            "type": entry.type or "",
            "release_date": entry.release_date or "",
            "is_clone": bool(entry.is_clone),
            "favorite": False,
        })
    LIB_STATE[key] = now          # cronologia nel file di stato separato
    save_library_state()
    save_library(LIBRARY)
    return _sorted_library(LIBRARY)


@app.post("/api/library/favorite")
def toggle_favorite(payload: LibraryKey):
    entry = next((e for e in LIBRARY if e.get("key") == payload.key), None)
    if not entry:
        raise HTTPException(status_code=404, detail="Titolo non trovato in libreria")
    entry["favorite"] = not entry.get("favorite", False)
    save_library(LIBRARY)
    return _sorted_library(LIBRARY)


@app.post("/api/library/remove")
def remove_library(payload: LibraryKey):
    global LIBRARY
    LIBRARY = [e for e in LIBRARY if e.get("key") != payload.key]
    save_library(LIBRARY)
    changed = False
    for f in SETTINGS.get("folders", []):
        if payload.key in f.get("items", []):
            f["items"].remove(payload.key)
            changed = True
    if changed:
        save_settings(SETTINGS)
    return _sorted_library(LIBRARY)


class LibraryRename(BaseModel):
    key: str
    name: str


class LibraryCover(BaseModel):
    key: str
    filename: Optional[str] = ""
    data: str                # base64 (a "data:" prefix is accepted and stripped)


@app.post("/api/library/rename")
def rename_library(payload: LibraryRename):
    e = next((x for x in LIBRARY if x.get("key") == payload.key), None)
    if not e:
        raise HTTPException(status_code=404, detail="Titolo non trovato in libreria")
    name = (payload.name or "").strip()
    if name:
        e["name"] = name
        save_library(LIBRARY)
    return _sorted_library(LIBRARY)


@app.post("/api/library/cover")
def set_library_cover(payload: LibraryCover):
    e = next((x for x in LIBRARY if x.get("key") == payload.key), None)
    if not e:
        raise HTTPException(status_code=404, detail="Titolo non trovato in libreria")
    raw = (payload.data or "").strip()
    if raw.startswith("data:") and "," in raw:
        raw = raw.split(",", 1)[1]
    try:
        blob = base64.b64decode(raw)
    except Exception:
        raise HTTPException(status_code=400, detail="Immagine non valida")
    if not blob:
        raise HTTPException(status_code=400, detail="Immagine vuota")
    if len(blob) > 8 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Immagine troppo grande (max 8MB)")
    ext = os.path.splitext(payload.filename or "")[1].lower()
    if ext not in (".png", ".jpg", ".jpeg", ".webp", ".gif"):
        ext = ".png"
    # stable per-title filename based on the key hash
    h = hashlib.md5(payload.key.encode("utf-8")).hexdigest()[:12]
    # drop any previous local cover for this title
    old = e.get("cover", "")
    if isinstance(old, str) and old.startswith("/covers/lib_" + h):
        try:
            os.remove(os.path.join(COVERS_DIR, os.path.basename(old)))
        except OSError:
            pass
    fname = f"lib_{h}{ext}"
    with open(os.path.join(COVERS_DIR, fname), "wb") as fh:
        fh.write(blob)
    e["cover"] = f"/covers/{fname}"
    save_library(LIBRARY)
    return _sorted_library(LIBRARY)


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
        raise HTTPException(status_code=500, detail="Errore interno del server")
    return {"ok": True, "path": path}


@app.post("/api/download/reveal")
def reveal_download(payload: dict):
    """Reveal the finished file in the OS file manager (selected)."""
    path = _resolve_download_path(payload.get("id", ""))
    try:
        _open_in_os(path, reveal=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail="Errore interno del server")
    return {"ok": True, "path": path}


@app.get("/api/download/play/{download_id}")
def play_download(download_id: str, dl: int = 0):
    """Serve il file scaricato. Con ?dl=1 forza il SALVATAGGIO sul dispositivo
    (Content-Disposition: attachment), cosi' dal telefono lo scarichi e lo guardi
    offline anche fuori casa. Senza dl, riproduzione inline (Range supportate)."""
    path = _resolve_download_path(download_id)
    ext = os.path.splitext(path)[1].lower()
    mt = {".mp4": "video/mp4", ".m4v": "video/mp4", ".mkv": "video/x-matroska",
          ".webm": "video/webm"}.get(ext, "video/mp4")
    if dl:
        return FileResponse(path, media_type=mt, filename=os.path.basename(path))
    return FileResponse(path, media_type=mt, content_disposition_type="inline")


@app.get("/api/downloads/local")
def list_local_downloads():
    """Elenca i file gia' presenti nella cartella /downloads (anche di sessioni
    precedenti) e li registra come riproducibili, cosi' la libreria puo'
    aprirli direttamente."""
    os.makedirs(DOWNLOADS_DIR, exist_ok=True)
    out = []
    for fn in os.listdir(DOWNLOADS_DIR):
        p = os.path.join(DOWNLOADS_DIR, fn)
        if not os.path.isfile(p):
            continue
        ext = os.path.splitext(fn)[1].lower()
        if ext not in (".mp4", ".mkv", ".webm", ".m4v"):
            continue
        did = "local:" + hashlib.md5(fn.encode("utf-8")).hexdigest()[:12]
        download_paths[did] = p   # abilita /api/download/play/{id}
        item = {"id": did, "name": os.path.splitext(fn)[0], "title": os.path.splitext(fn)[0], "file": fn}
        info = _library_item_for_download(item)
        if info:
            item["key"] = info.get("key", "")
            if info.get("cover"):
                item["cover"] = cover_out(info.get("cover", ""))
        out.append(item)
    return out


def _win_explorer_foreground(target):
    """Apre la cartella in Esplora risorse e la porta DAVVERO in primo piano,
    anche quando SC Portal gira in background (pythonw): Windows di norma vieta
    a un processo senza focus di rubare il primo piano, quindi usiamo il trucco
    del tasto ALT (che azzera il timeout del blocco foreground) prima di
    SetForegroundWindow. Gira in un thread per non bloccare la risposta HTTP."""
    import time, ctypes
    from ctypes import wintypes
    try:
        subprocess.Popen(["explorer", target])
    except Exception:
        return
    leaf = (os.path.basename(target.rstrip("\\/")) or target).lower()
    try:
        user32 = ctypes.windll.user32
    except Exception:
        return
    EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)

    def _try_focus():
        found = []

        def cb(hwnd, lparam):
            if not user32.IsWindowVisible(hwnd):
                return True
            cbuf = ctypes.create_unicode_buffer(256)
            user32.GetClassNameW(hwnd, cbuf, 256)
            if cbuf.value in ("CabinetWClass", "ExploreWClass"):
                tbuf = ctypes.create_unicode_buffer(512)
                user32.GetWindowTextW(hwnd, tbuf, 512)
                if leaf in (tbuf.value or "").lower():
                    found.append(hwnd)
            return True

        user32.EnumWindows(EnumWindowsProc(cb), 0)
        if found:
            hwnd = found[-1]
            user32.keybd_event(0x12, 0, 0, 0)   # ALT down
            user32.keybd_event(0x12, 0, 2, 0)   # ALT up -> sblocca il foreground
            user32.ShowWindow(hwnd, 9)          # SW_RESTORE
            user32.SetForegroundWindow(hwnd)
            user32.BringWindowToTop(hwnd)
            return True
        return False

    for _ in range(20):   # riprova ~4s finche' la finestra di explorer compare
        if _try_focus():
            break
        time.sleep(0.2)


@app.post("/api/downloads/open-folder")
def open_downloads_folder():
    """Open the downloads directory in the OS file manager (foreground on Win)."""
    import threading
    os.makedirs(DOWNLOADS_DIR, exist_ok=True)
    target = os.path.normpath(DOWNLOADS_DIR)
    try:
        if sys.platform.startswith("win"):
            threading.Thread(target=_win_explorer_foreground, args=(target,), daemon=True).start()
        elif sys.platform == "darwin":
            subprocess.Popen(["open", target])
        else:
            subprocess.Popen(["xdg-open", target])
    except Exception as e:
        raise HTTPException(status_code=500, detail="Errore interno del server")
    return {"ok": True, "path": DOWNLOADS_DIR}

# Serve uploaded folder cover images
app.mount("/covers", StaticFiles(directory=COVERS_DIR), name="covers")

# Mount static folder
static_path = os.path.join(RES_DIR, "static")
if os.path.exists(static_path):
    app.mount("/", StaticFiles(directory=static_path, html=True), name="static")
