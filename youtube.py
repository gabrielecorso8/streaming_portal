"""Fonte YouTube tramite yt-dlp.

Fornisce: ricerca, risoluzione dello stream per la riproduzione e download del
file mp4 nella cartella downloads (così compare tra i "Titoli scaricati").
Tutte le chiamate rispettano l'egress dell'app (proxy/VPN) se passato.
"""
import os
import re
import threading
import time

try:
    from yt_dlp import YoutubeDL
    HAVE_YTDLP = True
except Exception:  # pragma: no cover
    HAVE_YTDLP = False


def _thumb(entry):
    tid = entry.get("id")
    thumbs = entry.get("thumbnails") or []
    if thumbs:
        # l'ultima è di solito la più grande
        u = thumbs[-1].get("url")
        if u:
            return u
    return f"https://i.ytimg.com/vi/{tid}/hqdefault.jpg" if tid else ""


def _base_opts(proxies=None):
    opts = {
        "quiet": True,
        "no_warnings": True,
        "nocheckcertificate": True,
        "noplaylist": True,
    }
    if proxies:
        p = proxies.get("https") or proxies.get("http")
        if p:
            opts["proxy"] = p
    return opts


def is_youtube_url(url):
    return bool(re.search(r"(youtube\.com/watch|youtu\.be/|youtube\.com/shorts/)", url or ""))


def video_id(url):
    m = re.search(r"(?:v=|youtu\.be/|shorts/)([\w-]{6,})", url or "")
    return m.group(1) if m else ""


def search(query, limit=20, proxies=None):
    """Ricerca su YouTube. Ritorna voci nel formato dei risultati dell'app."""
    if not HAVE_YTDLP or not query:
        return []
    opts = _base_opts(proxies)
    opts.update({"skip_download": True, "extract_flat": "in_playlist", "default_search": "ytsearch"})
    out = []
    try:
        with YoutubeDL(opts) as ydl:
            info = ydl.extract_info(f"ytsearch{int(limit)}:{query}", download=False)
        for e in (info.get("entries") or []):
            if not e:
                continue
            vid = e.get("id")
            if not vid:
                continue
            url = e.get("url") or f"https://www.youtube.com/watch?v={vid}"
            if url.startswith("//"):
                url = "https:" + url
            if not url.startswith("http"):
                url = f"https://www.youtube.com/watch?v={vid}"
            out.append({
                "id": vid,
                "name": e.get("title") or "YouTube",
                "slug": "",
                "id_and_slug": "yt:" + vid,
                "type": "movie",
                "score": None,
                "release_date": "",
                "genres": [],
                "cover": _thumb(e),
                "url": url,
                "is_youtube": True,
                "source": "youtube",
                "duration": e.get("duration"),
                "uploader": e.get("uploader") or e.get("channel") or "",
            })
    except Exception as ex:
        print(f"[youtube] search fail: {ex}")
    return out


def resolve_stream(url, proxies=None):
    """Ritorna un URL progressivo (mp4 audio+video) per la riproduzione diretta,
    più titolo e locandina. Nessun download."""
    if not HAVE_YTDLP:
        raise RuntimeError("yt-dlp non disponibile")
    opts = _base_opts(proxies)
    opts.update({"skip_download": True,
                 "format": "18/best[ext=mp4][protocol^=http][acodec!=none][vcodec!=none]/best[acodec!=none][vcodec!=none]"})
    with YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
    stream = info.get("url")
    if not stream:
        # scegli il formato progressivo con banda più alta
        best = None
        for fmt in info.get("formats", []):
            if fmt.get("acodec") not in (None, "none") and fmt.get("vcodec") not in (None, "none") and fmt.get("url"):
                if best is None or (fmt.get("tbr") or 0) > (best.get("tbr") or 0):
                    best = fmt
        stream = best.get("url") if best else None
    return {
        "url": stream,
        "title": info.get("title") or "YouTube",
        "cover": _thumb(info),
        "id": info.get("id"),
        "embed": f"https://www.youtube.com/embed/{info.get('id')}" if info.get("id") else "",
    }


# --- Download in background con stato condiviso -----------------------------
YT_JOBS = {}
_LOCK = threading.Lock()


def _sanitize(name):
    name = re.sub(r"[\\/:*?\"<>|]+", " ", name or "").strip()
    return (name or "youtube")[:120]


def download(url, dest_dir, title="", proxies=None):
    """Avvia in background il download del video (mp4) in dest_dir. Ritorna il
    job_id da interrogare con job_status()."""
    if not HAVE_YTDLP:
        raise RuntimeError("yt-dlp non disponibile")
    os.makedirs(dest_dir, exist_ok=True)
    vid = video_id(url) or str(int(time.time()))
    job_id = "yt:" + vid
    with _LOCK:
        YT_JOBS[job_id] = {"id": job_id, "title": title or "YouTube", "status": "downloading",
                           "progress": 0.0, "file": "", "error": ""}

    def _hook(d):
        st = d.get("status")
        j = YT_JOBS.get(job_id)
        if not j:
            return
        if st == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            done = d.get("downloaded_bytes") or 0
            if total:
                j["progress"] = round(min(0.999, done / total), 4)
            j["title"] = j["title"] or d.get("info_dict", {}).get("title", "")
        elif st == "finished":
            j["progress"] = 0.999  # resta il merge/postprocessing

    outtmpl = os.path.join(dest_dir, "%(title).120B [%(id)s].%(ext)s")
    opts = _base_opts(proxies)
    opts.update({
        "outtmpl": outtmpl,
        "format": "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        "merge_output_format": "mp4",
        "progress_hooks": [_hook],
        "concurrent_fragment_downloads": 4,
        "retries": 5,
    })

    def _run():
        try:
            with YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=True)
            fn = None
            try:
                fn = ydl.prepare_filename(info)
                fn = os.path.splitext(fn)[0] + ".mp4"
            except Exception:
                pass
            with _LOCK:
                j = YT_JOBS.get(job_id, {})
                j["status"] = "completed"
                j["progress"] = 1.0
                j["file"] = os.path.basename(fn) if fn else ""
        except Exception as ex:
            with _LOCK:
                j = YT_JOBS.get(job_id, {})
                j["status"] = "error"
                j["error"] = str(ex)[:300]

    threading.Thread(target=_run, daemon=True).start()
    return job_id


def job_status(job_id=None):
    with _LOCK:
        if job_id:
            return dict(YT_JOBS.get(job_id, {}))
        return [dict(v) for v in YT_JOBS.values()]
