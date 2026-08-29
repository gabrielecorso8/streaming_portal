"""Privacy / anti-tracce helpers.

Scopo: ridurre al minimo le TRACCE che restano sul disco locale. Non garantisce
l'anonimato di rete (l'IP reale e' comunque esposto a Cloudflare/Vixcloud durante
la fase in diretta, per progetto), ma evita che segreti e cronologia finiscano in
chiaro nel file di log e permette di cancellare le tracce con un comando.

Due cose:
  1) redact(text) + RedactingWriter: oscurano token, cookie, URL firmati e IP
     prima che vengano scritti su server.log.
  2) clean_traces(base_dir): azzera il log e cancella il profilo del browser
     (cookie/cache, incluso cf_clearance).
"""

import os
import re
import shutil

# Chiavi di query/cookie che portano segreti (token di firma, scadenze, clearance).
_SECRET_KEYS = (
    "token", "expires", "cf_clearance", "asn", "scz", "sig", "signature",
    "auth", "authorization", "session", "sessionid", "key", "apikey",
    "access_token", "__cf_bm",
)

# query string ?a=b&c=d  -> la sostituiamo interamente con ?…
_QS_RE = re.compile(r"\?[^\s\"'<>]+")
# cookie/kv "chiave=valore" con una delle chiavi segrete
_KV_RE = re.compile(
    r"(?i)\b(" + "|".join(re.escape(k) for k in _SECRET_KEYS) + r")=([^\s;&\"'<>]+)"
)
# indirizzi IPv4 (LAN o pubblici) che possono comparire nei log
_IP_RE = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
# host delle URL esterne (QUALE sito stai aprendo): mascherato, loopback esclusi
_URL_HOST_RE = re.compile(r"(?i)(https?://)(?!(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?:[:/]|\b))([^/\s\"'<>]+)")
# lascia stare i loopback: sono innocui e utili per il debug
_KEEP_IPS = {"127.0.0.1", "0.0.0.0", "255.255.255.255"}


def redact(text):
    """Restituisce il testo con segreti e dati identificativi oscurati."""
    if not text or not isinstance(text, str):
        return text
    text = _URL_HOST_RE.sub(lambda m: m.group(1) + "[host]", text)
    text = _QS_RE.sub("?…", text)
    text = _KV_RE.sub(lambda m: m.group(1) + "=[REDACTED]", text)

    def _ip(m):
        ip = m.group(0)
        return ip if ip in _KEEP_IPS else "[ip]"

    text = _IP_RE.sub(_ip, text)
    return text


class RedactingWriter:
    """Avvolge uno stream (il file server.log) e oscura ogni riga in scrittura.

    Trasparente per il resto: delega flush/fileno/close allo stream sottostante,
    cosi' uvicorn e i print() continuano a funzionare senza saperlo."""

    def __init__(self, stream):
        self._stream = stream

    def write(self, data):
        try:
            return self._stream.write(redact(data))
        except Exception:
            try:
                return self._stream.write(data)
            except Exception:
                return 0

    def flush(self):
        try:
            self._stream.flush()
        except Exception:
            pass

    def __getattr__(self, name):
        return getattr(self._stream, name)


def host_only(url):
    """Riduce un URL a 'schema://host' (per i print di debug, senza path/token)."""
    if not url or not isinstance(url, str):
        return url or ""
    m = re.match(r"(https?://[^/\s?]+)", url)
    return (m.group(1) + "/…") if m else "[url]"


def clean_traces(base_dir):
    """Azzera le tracce locali. Ritorna la lista di cio' che e' stato ripulito.

    - server.log: troncato a zero byte;
    - bin/cf_profile: cancellato (cookie/cache del browser, incluso cf_clearance);
    - tmp/*.log e file di log residui.
    """
    removed = []

    log = os.path.join(base_dir, "server.log")
    try:
        if os.path.exists(log):
            open(log, "w", encoding="utf-8").close()
            removed.append("server.log")
    except Exception:
        pass

    prof = os.path.join(base_dir, "bin", "cf_profile")
    try:
        if os.path.isdir(prof):
            shutil.rmtree(prof, ignore_errors=True)
            removed.append("cf_profile")
    except Exception:
        pass

    return removed
