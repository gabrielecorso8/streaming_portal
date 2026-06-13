"""
vidxgo.co resolver.

vidxgo serves the actual video for StreamingCommunity "clone" sites. Its embed
page (https://v.vidxgo.co/<id>) ships an obfuscated player: each <script> is
`(function(){var k='<hexkey>',d=atob('<b64>');... XOR(d,k) ...eval})()`.

Decoding the big script reveals MODE (movie/tv) and the default season/episode.
The stream itself is minted on demand by the `/t/<id>[/<season>/<episode>]`
endpoint, which returns a freshly signed master playlist on a short-lived token
(~180s). Every URL under that asset (master, variant, segments) carries the same
`?t=&e=` signature, so refreshing the token = re-minting and swapping those two
query params.

The CDN (`*.d2b.you`) rejects requests without the right Referer/Origin, so all
playlist/segment fetches must carry the vidxgo headers built by `cdn_headers()`.
"""
import re
import json
import base64
import requests
import urllib3
import urllib.parse as up

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
ORIGIN = "https://v.vidxgo.co"

# Optional proxy for the vidxgo/CDN traffic. Some d2b.you CDN nodes (e.g. the
# one that serves certain episodes) are IP-blocked by Italian ISPs (Piracy
# Shield / AGCOM): the IP is alive worldwide but the user's connection drops it,
# so the download times out. Routing those fetches through a proxy/VPN restores
# reachability. None = direct connection (default, unchanged behaviour).
PROXIES = None


def set_proxies(proxies):
    """Set the proxy dict (e.g. {'http': 'socks5://127.0.0.1:1080', 'https': ...})
    applied to every vidxgo + CDN request. Pass None to go direct."""
    global PROXIES
    PROXIES = proxies or None

_OBF_RE = re.compile(r"var k='([0-9a-fA-F]+)',d=atob\('([^']+)'\)")
_SCRIPT_RE = re.compile(r"<script[^>]*>(.*?)</script>", re.S)


def get_iframe_id(url):
    m = re.search(r"v\.vidxgo\.co/(\d+)", url or "")
    return m.group(1) if m else None


def _deobf(js):
    """Replicate the page's XOR-over-base64 decode for one <script> block."""
    m = _OBF_RE.search(js)
    if not m:
        return None
    key = m.group(1).encode()
    raw = base64.b64decode(m.group(2))
    return bytes(raw[i] ^ key[i % len(key)] for i in range(len(raw))).decode("utf-8", "ignore")


def _decode_player(html):
    """Concatenate every decoded script block from the embed page."""
    parts = []
    for s in _SCRIPT_RE.findall(html):
        if "atob(" in s:
            dec = _deobf(s.strip())
            if dec:
                parts.append(dec)
    return "\n".join(parts)


def iframe_headers(referer):
    return {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
        "Referer": referer or ORIGIN,
        "Sec-Fetch-Dest": "iframe",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "cross-site",
        "Upgrade-Insecure-Requests": "1",
    }


def cdn_headers(iframe_url):
    """Headers the d2b.you CDN requires for playlists and segments."""
    return {
        "User-Agent": UA,
        "Referer": iframe_url,
        "Origin": ORIGIN,
        "Accept": "*/*",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "cross-site",
    }


def mint_token(rid, mode, season, episode, iframe_url, session=None):
    """Ask vidxgo for a freshly signed master playlist URL. Returns (url, expire_ms)."""
    s = session or requests.Session()
    if mode == "tv":
        path = f"/t/{rid}/{int(season)}/{int(episode)}"
    else:
        path = f"/t/{rid}"
    r = s.get(ORIGIN + path, headers={
        "User-Agent": UA,
        "Accept": "application/json, text/plain, */*",
        "Referer": iframe_url,
        "X-Requested-With": "XMLHttpRequest",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
    }, timeout=15, verify=False, proxies=PROXIES)
    if r.status_code != 200:
        raise RuntimeError(f"vidxgo /t token request failed: HTTP {r.status_code}")
    data = r.json()
    return data["url"].replace("\\/", "/"), data.get("expire")


def swap_sig(url, t, e):
    """Replace the t= and e= query params on any asset URL with the current token."""
    parts = up.urlparse(url)
    q = up.parse_qs(parts.query)
    if t is not None:
        q["t"] = [t]
    if e is not None:
        q["e"] = [str(e)]
    new_q = up.urlencode({k: v[0] for k, v in q.items()})
    return up.urlunparse(parts._replace(query=new_q))


def sig_of(url):
    """Extract (t, e) from an asset URL query."""
    q = up.parse_qs(up.urlparse(url).query)
    return q.get("t", [None])[0], q.get("e", [None])[0]


def _pick_best_variant(master_text, master_url):
    """From a master playlist, return the highest-bandwidth media playlist URL."""
    best = None
    best_bw = -1
    lines = master_text.splitlines()
    for i, line in enumerate(lines):
        if line.startswith("#EXT-X-STREAM-INF"):
            mbw = re.search(r"BANDWIDTH=(\d+)", line)
            bw = int(mbw.group(1)) if mbw else 0
            # the URI is the next non-comment line
            for j in range(i + 1, len(lines)):
                cand = lines[j].strip()
                if cand and not cand.startswith("#"):
                    if bw > best_bw:
                        best_bw, best = bw, up.urljoin(master_url, cand)
                    break
    if best is None:
        # no variant tags: treat first media line as the playlist
        for line in lines:
            ls = line.strip()
            if ls and not ls.startswith("#"):
                best = up.urljoin(master_url, ls)
                break
    return best


def get_player(iframe_url, referer, session=None):
    """Fetch the embed page and return (session, decoded_player_js)."""
    s = session or requests.Session()
    s.verify = False
    html = s.get(iframe_url, headers=iframe_headers(referer), timeout=15,
                 proxies=PROXIES).text
    return s, _decode_player(html)


def parse_meta(player, rid):
    """Extract movie/tv metadata from the decoded player script."""
    mm = re.search(r'MODE\s*=\s*"(\w+)"', player)
    mode = mm.group(1) if mm else "movie"

    title = None
    mt = re.search(r'name:\s*"([^"]+)"', player)
    if mt:
        title = mt.group(1)

    poster = None
    mp = re.search(r'poster:\s*"([^"]+)"', player)
    if mp:
        poster = mp.group(1).replace("\\/", "/")

    tmdb_tv_id = None
    mtv = re.search(r'tmdbTvId:\s*(\d+)', player)
    if mtv:
        tmdb_tv_id = int(mtv.group(1))

    seasons = []
    ms = re.search(r'seasons:\s*(\[[^\]]*\])', player)
    if ms:
        try:
            seasons = json.loads(ms.group(1))  # [{"n":1,"count":10}, ...]
        except Exception:
            seasons = []

    # Default season/episode from the embedded currentSrc path or current={s,e}
    default_s, default_e = 1, 1
    mc = re.search(r"/hls/\w+/" + re.escape(rid) + r"/(\d+)/(\d+)/", player)
    if mc:
        default_s, default_e = int(mc.group(1)), int(mc.group(2))
    else:
        mcur = re.search(r'current\s*=\s*\{\s*s:\s*(\d+),\s*e:\s*(\d+)', player)
        if mcur:
            default_s, default_e = int(mcur.group(1)), int(mcur.group(2))

    return {
        "mode": mode,
        "title": title,
        "poster": poster,
        "tmdb_tv_id": tmdb_tv_id,
        "seasons": [{"number": s.get("n"), "count": s.get("count")} for s in seasons],
        "default_season": default_s,
        "default_episode": default_e,
    }


def list_episodes(tmdb_tv_id, season, iframe_url, session=None):
    """Return episode metadata for a season via vidxgo's /tmdb proxy."""
    s = session or requests.Session()
    s.verify = False
    r = s.get(f"{ORIGIN}/tmdb/{tmdb_tv_id}/{int(season)}", headers={
        "User-Agent": UA,
        "Accept": "application/json, text/plain, */*",
        "Referer": iframe_url,
        "X-Requested-With": "XMLHttpRequest",
    }, timeout=15, verify=False, proxies=PROXIES)
    out = []
    if r.status_code == 200:
        try:
            for ep in r.json().get("episodes", []):
                still = ep.get("still_path")
                out.append({
                    "number": ep.get("episode_number"),
                    "name": ep.get("name"),
                    "plot": ep.get("overview"),
                    "duration": ep.get("runtime"),
                    "cover": f"https://image.tmdb.org/t/p/w300{still}" if still else None,
                })
        except Exception:
            pass
    return out


def resolve_episode(rid, mode, season, episode, iframe_url, session=None):
    """Mint a fresh token and resolve a single episode/movie to a variant URL."""
    s = session or requests.Session()
    s.verify = False
    master_url, _ = mint_token(rid, mode, season, episode, iframe_url, session=s)
    hdrs = cdn_headers(iframe_url)
    master_text = s.get(master_url, headers=hdrs, timeout=20, proxies=PROXIES).text
    variant_url = _pick_best_variant(master_text, master_url)
    if not variant_url:
        return None
    return {"variant_url": variant_url, "headers": hdrs}


def resolve_stream(iframe_url, referer, season=None, episode=None):
    """
    High-level resolve for a vidxgo embed.

    For movies (and when an explicit season/episode is given) it resolves a
    directly-downloadable variant playlist. For series with no episode chosen it
    returns the season catalogue so the UI can present a picker.

    Returns a dict consumed by api.build_vidxgo_response, or None on failure.
    """
    rid = get_iframe_id(iframe_url)
    if not rid:
        return None

    s, player = get_player(iframe_url, referer)
    meta = parse_meta(player, rid)
    mode = meta["mode"]

    result = {
        "id": rid,
        "mode": mode,
        "iframe_url": iframe_url,
        "title": meta["title"],
        "poster": meta["poster"],
        "tmdb_tv_id": meta["tmdb_tv_id"],
        "seasons": meta["seasons"],
        "variant_url": None,
        "headers": cdn_headers(iframe_url),
        "season": season,
        "episode": episode,
    }

    if mode != "tv":
        # Movie: resolve directly.
        ep = resolve_episode(rid, mode, None, None, iframe_url, session=s)
        if ep:
            result["variant_url"] = ep["variant_url"]
            result["headers"] = ep["headers"]
        return result

    # Series: resolve a specific episode only if explicitly requested.
    if season is not None and episode is not None:
        ep = resolve_episode(rid, mode, season, episode, iframe_url, session=s)
        if ep:
            result["variant_url"] = ep["variant_url"]
            result["headers"] = ep["headers"]
    return result
