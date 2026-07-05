# -*- coding: utf-8 -*-
"""
Resolver per AnimeWorld (animeworld.ac e domini alternativi).

AnimeWorld NON usa Vixcloud/StreamingCommunity: ha un player proprio con un
"grabber" via API che restituisce un file .mp4 diretto. Questo modulo:

- cerca serie (search)
- elenca gli episodi di una serie (get_series)
- risolve il singolo episodio in un URL .mp4 (resolve_episode)

Il .mp4 risultante e' un file diretto: si riproduce e si scarica come un normale
mp4 (il downloader gestisce gia' i file diretti).

NOTA: AnimeWorld e' dietro Cloudflare e ruota i domini. Se l'estrazione fallisce
puo' servire una VPN/proxy (gia' supportati dall'app) o l'aggiornamento del
dominio nella lista "fonti extra".
"""

import re
import json
import urllib.parse
import requests
from bs4 import BeautifulSoup

DEFAULT_HOST = "www.animeworld.ac"

_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")


def _host_of(url):
    try:
        h = urllib.parse.urlparse(url).netloc.lower()
        return h or DEFAULT_HOST
    except Exception:
        return DEFAULT_HOST


def _base(url):
    return f"https://{_host_of(url)}"


def is_animeworld_url(url):
    h = _host_of(url)
    return "animeworld" in h


def _session(proxies=None):
    s = requests.Session()
    s.headers.update({
        "User-Agent": _UA,
        "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
    })
    if proxies:
        s.proxies.update(proxies)
    s.verify = False
    return s


def _abs(base, u):
    if not u:
        return ""
    if u.startswith("//"):
        return "https:" + u
    if u.startswith("http"):
        return u
    return urllib.parse.urljoin(base, u)


# --------------------------------------------------------------------------- #
#  Ricerca
# --------------------------------------------------------------------------- #
def search(query, host=DEFAULT_HOST, proxies=None, limit=40):
    """Cerca serie su AnimeWorld. Ritorna [{title, url, cover, key}]."""
    base = f"https://{host}"
    s = _session(proxies)
    out = []
    try:
        r = s.get(f"{base}/search", params={"keyword": query}, timeout=15)
        if r.status_code != 200:
            return out
        soup = BeautifulSoup(r.text, "lxml")
        # I risultati sono in .film-list .item (a.poster + .name)
        items = soup.select(".film-list .item") or soup.select("div.item")
        for it in items:
            a = it.select_one("a.poster") or it.select_one("a.name") or it.find("a")
            if not a or not a.get("href"):
                continue
            href = _abs(base, a.get("href"))
            name_el = it.select_one(".name") or a
            title = (name_el.get("data-jtitle") or name_el.text or a.get("data-jtitle") or "").strip()
            if not title:
                title = (a.get("title") or "").strip()
            img = it.find("img")
            cover = ""
            if img:
                cover = _abs(base, img.get("src") or img.get("data-src") or "")
            out.append({
                "title": title or "Senza titolo",
                "url": href,
                "cover": cover,
                "key": _key_for(href),
            })
            if len(out) >= limit:
                break
    except Exception as e:
        print(f"[animeworld] search error: {e}")
    return out


def _key_for(url):
    """Chiave stabile per la libreria: aw:<slug>.<id> ricavato dall'URL."""
    m = re.search(r"/play/([^/?#]+)", url)
    slug = m.group(1) if m else urllib.parse.urlparse(url).path.strip("/").replace("/", "-")
    return "aw:" + slug


# --------------------------------------------------------------------------- #
#  Serie + episodi
# --------------------------------------------------------------------------- #
def get_series(url, proxies=None):
    """Legge la pagina di una serie AnimeWorld e ritorna:
       {title, cover, plot, episodes:[{num, id, url}], csrf}
    """
    base = _base(url)
    s = _session(proxies)
    r = s.get(url, timeout=20)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "lxml")

    title = ""
    h1 = soup.find("h1")
    if h1:
        title = h1.get_text(strip=True)
    if not title:
        og = soup.find("meta", property="og:title")
        if og:
            title = re.sub(r"\s*-\s*AnimeWorld.*$", "", og.get("content", "")).strip()

    cover = ""
    ogimg = soup.find("meta", property="og:image")
    if ogimg:
        cover = _abs(base, ogimg.get("content", ""))

    plot = ""
    md = soup.find("meta", {"name": "description"})
    if md:
        plot = (md.get("content") or "").strip()

    csrf = ""
    cm = soup.find("meta", {"name": "csrf-token"})
    if cm:
        csrf = cm.get("content", "")

    episodes = _parse_episodes(soup, base)
    return {"title": title or "AnimeWorld", "cover": cover, "plot": plot,
            "episodes": episodes, "csrf": csrf, "host": _host_of(url)}


def _parse_episodes(soup, base):
    """Estrae gli episodi: ogni <a> ha data-id (id del grabber) e href col token."""
    eps = []
    seen = set()
    # Preferisci il primo server disponibile
    for a in soup.select(".server .episodes a, ul.episodes a, a.episode"):
        did = a.get("data-id") or a.get("data-episode-id")
        href = a.get("href")
        if not did or not href:
            continue
        num = (a.get("data-episode-num") or a.get("data-num") or a.get_text(strip=True) or "").strip()
        key = str(did)
        if key in seen:
            continue
        seen.add(key)
        eps.append({"num": num, "id": str(did), "url": _abs(base, href)})
    return eps


# --------------------------------------------------------------------------- #
#  Risoluzione del singolo episodio -> URL mp4 diretto
# --------------------------------------------------------------------------- #
def resolve_episode(url=None, episode_id=None, host=DEFAULT_HOST, proxies=None):
    """Risolve un episodio AnimeWorld in un URL .mp4 diretto.

    Puoi passare l'URL della pagina episodio (`.../slug.id/token`) OPPURE
    direttamente l'`episode_id` (data-id) + host.
    Ritorna {mp4_url, title, cover} oppure solleva un'eccezione.
    """
    s = _session(proxies)
    base = f"https://{host}"
    title = ""
    cover = ""
    csrf = ""

    if url:
        base = _base(url)
        host = _host_of(url)
        r = s.get(url, timeout=20)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "lxml")
        cm = soup.find("meta", {"name": "csrf-token"})
        csrf = cm.get("content", "") if cm else ""
        h1 = soup.find("h1")
        if h1:
            title = h1.get_text(strip=True)
        ogimg = soup.find("meta", property="og:image")
        if ogimg:
            cover = _abs(base, ogimg.get("content", ""))
        if not episode_id:
            episode_id = _active_episode_id(soup, url)
        # A volte il link diretto e' gia' nella pagina (alternativeDownloadLink)
        direct = _direct_from_soup(soup)
        if direct:
            return {"mp4_url": direct, "title": title, "cover": cover}

    if not episode_id:
        raise Exception("Impossibile individuare l'episodio (data-id mancante)")

    mp4 = _grab(s, base, episode_id, referer=url or base, csrf=csrf)
    if not mp4:
        raise Exception("Grabber AnimeWorld non ha restituito un mp4")
    return {"mp4_url": mp4, "title": title, "cover": cover}


def _active_episode_id(soup, url):
    """Ricava il data-id dell'episodio corrispondente al token nell'URL."""
    token = url.rstrip("/").split("/")[-1]
    for a in soup.select("a[href]"):
        href = a.get("href", "")
        if href.rstrip("/").endswith("/" + token) and (a.get("data-id") or a.get("data-episode-id")):
            return str(a.get("data-id") or a.get("data-episode-id"))
    # fallback: primo episodio con data-id
    eps = _parse_episodes(soup, "")
    return eps[0]["id"] if eps else None


def _grab(s, base, episode_id, referer="", csrf=""):
    """Chiama il grabber e ricava l'mp4. Prova JSON poi HTML."""
    api = f"{base}/api/episode/serverPlayerAnimeWorld"
    headers = {
        "X-Requested-With": "XMLHttpRequest",
        "Referer": referer or base,
    }
    if csrf:
        headers["csrf-token"] = csrf
    try:
        r = s.get(api, params={"id": episode_id}, headers=headers, timeout=20)
    except Exception as e:
        print(f"[animeworld] grabber request failed: {e}")
        return ""
    if r.status_code != 200:
        print(f"[animeworld] grabber status {r.status_code}")
        return ""
    txt = r.text or ""
    # 1) risposta JSON con campo grabber/target
    try:
        j = r.json()
        for k in ("grabber", "target", "url", "src"):
            if isinstance(j, dict) and j.get(k) and str(j[k]).startswith("http"):
                return str(j[k])
    except Exception:
        pass
    # 2) HTML con <source src> o <video src> o download link
    soup = BeautifulSoup(txt, "lxml")
    d = _direct_from_soup(soup)
    if d:
        return d
    # 3) regex fallback su un qualsiasi .mp4
    m = re.search(r'https?://[^\s"\'<>]+\.mp4[^\s"\'<>]*', txt)
    return m.group(0) if m else ""


def _direct_from_soup(soup):
    src = soup.select_one("source[src]")
    if src and src.get("src", "").startswith("http"):
        return src["src"]
    vid = soup.select_one("video[src]")
    if vid and vid.get("src", "").startswith("http"):
        return vid["src"]
    a = soup.select_one("#alternativeDownloadLink[href], a.dwl[href], a[download][href]")
    if a and a.get("href", "").startswith("http"):
        return a["href"]
    return ""
