import os
import re
import sys
import json
import time
import uuid
import queue
import shutil
import urllib.parse
import subprocess
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests
from requests.adapters import HTTPAdapter
from bs4 import BeautifulSoup
import m3u8
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend

import vidxgo

# Global status tracker for active downloads
active_downloads = {}
# Maps download_id -> absolute path of the finished file (used to open/reveal it)
download_paths = {}

# Registered by api.py: resolve_stream_info(sc_id, episode_id) -> dict with
# {"download": {video_url, audio_url, ...}} used to re-sign expired Vixcloud URLs.
STREAM_RESOLVER = None

def set_stream_resolver(fn):
    global STREAM_RESOLVER
    STREAM_RESOLVER = fn

# On-disk registry so the download queue + history survive a server restart.
STATE_FILE = os.path.join("tmp", "downloads_state.json")
_state_lock = threading.Lock()


class DownloadCancelled(Exception):
    """Raised inside a task when the user cancels the download."""
    pass

class Decryptor:
    def __init__(self, key_bytes, iv_hex):
        self.key = key_bytes
        self.iv = bytes.fromhex(iv_hex.replace("0x", "")) if iv_hex else None

    def decrypt(self, encrypted_data, segment_index=0):
        # If IV is not provided in the playlist, HLS uses the segment index as the IV (16-byte big-endian)
        iv = self.iv
        if not iv:
            iv = segment_index.to_bytes(16, byteorder='big')
            
        cipher = Cipher(algorithms.AES(self.key), modes.CBC(iv), backend=default_backend())
        decryptor = cipher.decryptor()
        return decryptor.update(encrypted_data) + decryptor.finalize()

class DownloadTask:
    def __init__(self, download_id, title, m3u8_video_url, m3u8_audio_url=None, key_info=None,
                 output_dir="downloads", extra_headers=None, vidxgo_meta=None, proxies=None,
                 vixcloud_meta=None):
        self.download_id = download_id
        self.title = title
        self.m3u8_video_url = m3u8_video_url
        self.m3u8_audio_url = m3u8_audio_url
        self.key_info = key_info  # dict with keys: 'key_url', 'referer', 'iv'
        self.output_dir = output_dir
        # Per-host request headers (e.g. Referer/Origin required by the CDN).
        self.extra_headers = extra_headers or {}
        # Optional proxy for playlist/segment fetches. Needed when the CDN node
        # serving this asset is IP-blocked by the ISP (see vidxgo.set_proxies).
        self.proxies = proxies or None
        # Shared HTTP session: keep-alive + large connection pool so the segment
        # workers REUSE TCP/TLS connections instead of re-handshaking for every
        # .ts (this is the main download-speed fix).
        self.session = requests.Session()
        _adapter = HTTPAdapter(pool_connections=64, pool_maxsize=64, max_retries=0)
        self.session.mount("https://", _adapter)
        self.session.mount("http://", _adapter)
        # vidxgo token-refresh metadata: {id, mode, season, episode, iframe_url}.
        # When present, every segment URL's ?t=&e= signature is kept fresh by
        # re-minting through vidxgo /t, because those tokens expire in ~180s.
        self.vidxgo_meta = vidxgo_meta
        self._sig = None
        self._sig_lock = threading.Lock()
        self._last_refresh = 0.0
        # Vixcloud (native SC) token refresh: re-resolve the signed URL when a
        # segment 403s because the original token/expires has lapsed mid-download.
        self.vixcloud_meta = vixcloud_meta   # {sc_id, episode_id}
        self._vix_qs = {}                    # per stream_type: fresh query params
        self._vix_lock = threading.Lock()
        self._vix_last = 0.0
        self._cur_stream_type = "video"

        self.temp_dir = os.path.join("tmp", f"download_{download_id}")
        self.video_temp_dir = os.path.join(self.temp_dir, "video")
        self.audio_temp_dir = os.path.join(self.temp_dir, "audio")

        self.progress = 0.0
        self.status = "pending"
        self.error_msg = None
        self.output_path = None  # absolute path of the finished .mp4
        self.cancel_flag = False  # set by request_cancel() to stop the download
        self.t_start = None       # download start time (for ETA)
        self.t_done = None        # download completion time (for total elapsed)

        # Snapshot of the construction parameters, persisted to disk so the
        # download can be reconstructed and resumed after a server restart.
        self.params = {
            "title": title,
            "m3u8_video_url": m3u8_video_url,
            "m3u8_audio_url": m3u8_audio_url,
            "key_info": key_info,
            "output_dir": output_dir,
            "extra_headers": extra_headers,
            "vidxgo_meta": vidxgo_meta,
            "vixcloud_meta": vixcloud_meta,
            "proxies": proxies,
        }

        active_downloads[download_id] = self.get_status()

    def _refresh_sig(self, force=False):
        """Re-mint the vidxgo token and update the shared (t, e) signature."""
        if not self.vidxgo_meta:
            return
        with self._sig_lock:
            now = time.time()
            # Coalesce concurrent refreshes: one mint serves all worker threads.
            if not force and (now - self._last_refresh) < 5:
                return
            try:
                master, _ = vidxgo.mint_token(
                    self.vidxgo_meta["id"], self.vidxgo_meta["mode"],
                    self.vidxgo_meta.get("season"), self.vidxgo_meta.get("episode"),
                    self.vidxgo_meta["iframe_url"],
                )
                t, e = vidxgo.sig_of(master)
                self._sig = {"t": t, "e": e}
                self._last_refresh = now
            except Exception as ex:
                print(f"[-] vidxgo token refresh failed: {ex}")

    def _refresh_vix(self, stream_type, force=False):
        """Re-resolve the native Vixcloud stream and capture fresh signing query
        params (token/expires/...) so expired segment URLs can be re-signed."""
        if not self.vixcloud_meta or STREAM_RESOLVER is None:
            return
        with self._vix_lock:
            now = time.time()
            if not force and (now - self._vix_last) < 5:
                return
            try:
                info = STREAM_RESOLVER(self.vixcloud_meta.get("sc_id"),
                                       self.vixcloud_meta.get("episode_id"))
                dl = (info or {}).get("download") or {}
                url = dl.get("video_url") if stream_type == "video" else dl.get("audio_url")
                url = url or dl.get("video_url")
                if url:
                    q = urllib.parse.urlparse(url).query
                    self._vix_qs[stream_type] = {k: v[0] for k, v in urllib.parse.parse_qs(q).items()}
                    self._vix_last = now
                    print(f"[+] Vixcloud token refreshed ({stream_type}).")
            except Exception as ex:
                print(f"[-] Vixcloud token refresh failed: {ex}")

    def _seg_url(self, base_seg_url):
        """Rewrite a segment URL with the current (auto-refreshed) token."""
        if self.vixcloud_meta:
            qs = self._vix_qs.get(self._cur_stream_type)
            if qs:
                parts = urllib.parse.urlparse(base_seg_url)
                q = urllib.parse.parse_qs(parts.query)
                for k in ("token", "expires", "h", "scz", "lang", "ub", "asn"):
                    if k in qs:
                        q[k] = [qs[k]]
                return urllib.parse.urlunparse(parts._replace(query=urllib.parse.urlencode(q, doseq=True)))
            return base_seg_url
        if not self.vidxgo_meta:
            return base_seg_url
        # Proactively refresh ~25s before expiry to avoid a wave of 403s.
        sig = self._sig
        if sig and sig.get("e"):
            try:
                if int(sig["e"]) - int(time.time() * 1000) < 25000:
                    self._refresh_sig()
            except (ValueError, TypeError):
                pass
        sig = self._sig
        if sig:
            return vidxgo.swap_sig(base_seg_url, sig.get("t"), sig.get("e"))
        return base_seg_url

    def get_status(self):
        st = {
            "id": self.download_id,
            "title": self.title,
            "status": self.status,
            "progress": round(self.progress, 1),
            "error": self.error_msg
        }
        if self.status in ("downloading", "merging") and self.t_start and self.progress > 1:
            elapsed = time.time() - self.t_start
            # ETA from overall progress (video 0-80%, audio 80-100%)
            st["eta"] = round(elapsed * (100 - self.progress) / self.progress)
        if self.status == "completed" and self.output_path and os.path.exists(self.output_path):
            st["file"] = os.path.basename(self.output_path)
            if self.t_start and self.t_done:
                st["elapsed"] = round(self.t_done - self.t_start)
            try:
                st["size"] = os.path.getsize(self.output_path)
            except OSError:
                pass
        return st

    def request_cancel(self):
        """Signal the running download to stop as soon as possible."""
        self.cancel_flag = True

    def update_status(self, status, progress=None, error_msg=None):
        prev_status = self.status
        self.status = status
        if progress is not None:
            self.progress = progress
        if error_msg is not None:
            self.error_msg = error_msg
        active_downloads[self.download_id] = self.get_status()
        # Persist on status transitions only (not on every progress tick, which
        # fires once per segment) to keep disk writes cheap.
        if status != prev_status:
            _persist_state()

    def fetch_key(self):
        if not self.key_info:
            return None
        
        key_url = self.key_info.get("key_url")
        referer = self.key_info.get("referer")
        
        if not key_url:
            return None
            
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": referer
        }
        
        print(f"[*] Fetching decryption key from {key_url} with Referer {referer}")
        resp = self.session.get(key_url, headers=headers, timeout=10, proxies=self.proxies)
        if resp.status_code == 200:
            return resp.content
        else:
            raise Exception(f"Failed to fetch AES key. Status code: {resp.status_code}")

    def download_stream(self, stream_url, target_dir, key_bytes, stream_type="video", weight=1.0, progress_offset=0.0):
        os.makedirs(target_dir, exist_ok=True)
        self._cur_stream_type = stream_type

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        headers.update(self.extra_headers)

        # Seed the vidxgo token signature from the playlist URL before fetching.
        if self.vidxgo_meta and self._sig is None:
            t, e = vidxgo.sig_of(stream_url)
            self._sig = {"t": t, "e": e}

        # 1. Fetch playlist
        resp = self.session.get(stream_url, headers=headers, timeout=10, proxies=self.proxies)
        if resp.status_code != 200:
            raise Exception(f"Failed to fetch {stream_type} playlist. Status code: {resp.status_code}")
            
        playlist = m3u8.loads(resp.text)
        segments = playlist.segments
        total_segments = len(segments)
        
        if total_segments == 0:
            raise Exception(f"No segments found in {stream_type} playlist.")
            
        # Parse decryption info from playlist
        decryptor = None
        if not key_bytes and playlist.keys and playlist.keys[0]:
            key_uri = playlist.keys[0].uri
            if key_uri:
                absolute_key_url = urllib.parse.urljoin(stream_url, key_uri)
                print(f"[*] Automatically fetching key from {absolute_key_url}...")
                try:
                    key_headers = headers.copy()
                    if self.key_info and self.key_info.get("referer"):
                        key_headers["Referer"] = self.key_info.get("referer")
                    key_resp = self.session.get(absolute_key_url, headers=key_headers, timeout=10, proxies=self.proxies)
                    if key_resp.status_code == 200:
                        key_bytes = key_resp.content
                        print("[+] Automatically fetched AES key successfully.")
                    else:
                        print(f"[-] Failed to automatically fetch AES key. Status: {key_resp.status_code}")
                except Exception as e:
                    print(f"[-] Error automatically fetching AES key: {e}")

        if key_bytes:
            iv = None
            if playlist.keys and playlist.keys[0]:
                iv = playlist.keys[0].iv
            decryptor = Decryptor(key_bytes, iv)

        print(f"[*] Downloading {total_segments} segments of {stream_type}...")
        
        completed_segments = 0
        lock = threading.Lock()
        
        def download_segment(idx, seg_uri):
            nonlocal completed_segments
            # Stop quickly if the user cancelled the download.
            if self.cancel_flag:
                return
            base_seg_url = urllib.parse.urljoin(stream_url, seg_uri)

            # Resume support: a segment already saved on disk (non-empty) is
            # reused instead of being re-downloaded. This makes interrupted
            # downloads resumable and lets the targeted-retry pass below only
            # re-fetch the segments that are actually missing.
            seg_path = os.path.join(target_dir, f"{idx:05d}.ts")
            if os.path.exists(seg_path) and os.path.getsize(seg_path) > 0:
                with lock:
                    completed_segments += 1
                    current_progress = progress_offset + (completed_segments / total_segments) * 100 * weight
                    self.update_status(self.status, current_progress)
                return

            # Simple retry mechanism (extra attempts for token-refresh streams)
            attempts = 5 if (self.vidxgo_meta or self.vixcloud_meta) else 3
            for retry in range(attempts):
                try:
                    seg_url = self._seg_url(base_seg_url)
                    seg_resp = self.session.get(seg_url, headers=headers, timeout=15, proxies=self.proxies)
                    if seg_resp.status_code == 200:
                        content = seg_resp.content
                        if decryptor:
                            content = decryptor.decrypt(content, idx)

                        seg_path = os.path.join(target_dir, f"{idx:05d}.ts")
                        with open(seg_path, "wb") as f:
                            f.write(content)

                        with lock:
                            completed_segments += 1
                            # Update global progress
                            current_progress = progress_offset + (completed_segments / total_segments) * 100 * weight
                            self.update_status(self.status, current_progress)
                        return
                    # An expired/forbidden token: re-sign and retry immediately.
                    if seg_resp.status_code in (401, 403, 410):
                        if self.vidxgo_meta:
                            self._refresh_sig(force=True); continue
                        if self.vixcloud_meta:
                            self._refresh_vix(stream_type, force=True); continue
                    raise Exception(f"HTTP {seg_resp.status_code}")
                except Exception as e:
                    print(f"[-] Segment {idx} download attempt {retry+1} failed: {e}")
                    if self.vidxgo_meta:
                        self._refresh_sig(force=True)
                    elif self.vixcloud_meta:
                        self._refresh_vix(stream_type, force=True)
                    time.sleep(1)
            raise Exception(f"Failed to download segment {idx} after retries")

        # Use ThreadPoolExecutor for downloading segments concurrently.
        # We do NOT abort on the first failed segment: transient errors are
        # collected and resolved by the targeted-retry pass below, so a single
        # flaky segment can't waste the whole download.
        with ThreadPoolExecutor(max_workers=30) as executor:
            futures = [executor.submit(download_segment, i, seg.uri) for i, seg in enumerate(segments)]
            for future in as_completed(futures):
                try:
                    future.result()
                except Exception as e:
                    print(f"[-] Segment task error (will retry): {e}")
                if self.cancel_flag:
                    raise DownloadCancelled()

        if self.cancel_flag:
            raise DownloadCancelled()

        # Completeness check: every segment 0..N-1 must exist and be non-empty.
        def _missing_segments():
            miss = []
            for i in range(total_segments):
                p = os.path.join(target_dir, f"{i:05d}.ts")
                if not os.path.exists(p) or os.path.getsize(p) == 0:
                    miss.append(i)
            return miss

        missing = _missing_segments()
        for attempt in range(3):
            if self.cancel_flag:
                raise DownloadCancelled()
            if not missing:
                break
            preview = missing[:10]
            print(f"[!] {len(missing)} {stream_type} segment(s) missing "
                  f"(retry {attempt + 1}/3): {preview}{'...' if len(missing) > 10 else ''}")
            if self.vidxgo_meta:
                self._refresh_sig(force=True)
            for idx in missing:
                try:
                    download_segment(idx, segments[idx].uri)
                except Exception as e:
                    print(f"[-] Targeted retry of segment {idx} failed: {e}")
            missing = _missing_segments()

        if missing:
            raise Exception(
                f"{len(missing)} segmenti '{stream_type}' mancanti dopo i retry "
                f"(es. {missing[:5]}). Download incompleto: i .ts scaricati restano "
                f"in {target_dir} e il download può essere ripreso."
            )

    def download_direct_file(self, url, output_path):
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        # Disable SSL verification for safety since the user runs in verify=False mode
        resp = self.session.get(url, headers=headers, stream=True, timeout=15, verify=False, proxies=self.proxies)
        if resp.status_code != 200:
            raise Exception(f"Failed to download file. Status code: {resp.status_code}")
            
        total_size = int(resp.headers.get('content-length', 0))
        downloaded = 0
        
        with open(output_path, 'wb') as f:
            for chunk in resp.iter_content(chunk_size=1024*1024): # 1MB chunks
                if chunk:
                    f.write(chunk)
                    downloaded += len(chunk)
                    if total_size > 0:
                        progress = (downloaded / total_size) * 100
                        self.update_status(self.status, progress)

    def run(self):
        try:
            if self.cancel_flag:
                raise DownloadCancelled()
            self.t_start = time.time()
            self.update_status("downloading", 0.0)
            
            # Create download output path
            os.makedirs(self.output_dir, exist_ok=True)
            safe_title = re.sub(r'[\\/*?:"<>|]', "", self.title)
            final_output_path = os.path.join(self.output_dir, f"{safe_title}.mp4")
            self.output_path = os.path.abspath(final_output_path)

            parsed_video_url = urllib.parse.urlparse(self.m3u8_video_url)
            is_direct_mp4 = parsed_video_url.path.lower().endswith(".mp4")

            if is_direct_mp4:
                print(f"[*] Downloading direct MP4 stream: {self.m3u8_video_url}")
                self.download_direct_file(self.m3u8_video_url, final_output_path)
                download_paths[self.download_id] = self.output_path
                self.t_done = time.time()
                self.update_status("completed", 100.0)
                print(f"[+] Download completed! Saved to {final_output_path}")
                return

            # Fetch Decryption Key
            key_bytes = None
            if self.key_info:
                key_bytes = self.fetch_key()

            # Determine weights of video and audio
            has_audio = bool(self.m3u8_audio_url)
            video_weight = 0.8 if has_audio else 1.0
            audio_weight = 0.2 if has_audio else 0.0
            
            # Download Video
            self.download_stream(
                self.m3u8_video_url, 
                self.video_temp_dir, 
                key_bytes, 
                stream_type="video", 
                weight=video_weight, 
                progress_offset=0.0
            )
            
            # Download Audio if separate
            if has_audio:
                self.download_stream(
                    self.m3u8_audio_url, 
                    self.audio_temp_dir, 
                    key_bytes, 
                    stream_type="audio", 
                    weight=audio_weight, 
                    progress_offset=80.0
                )
            
            # 3. Concatenate and Merge Streams
            self.update_status("merging", 100.0)
            print("[*] Merging segments...")
            
            temp_video_mp4 = os.path.join(self.temp_dir, "temp_video.mp4")
            self.concat_segments(self.video_temp_dir, temp_video_mp4)
            
            if has_audio:
                temp_audio_mp4 = os.path.join(self.temp_dir, "temp_audio.mp4")
                self.concat_segments(self.audio_temp_dir, temp_audio_mp4)
                
                # Merge video and audio with FFmpeg
                print("[*] Muxing video and audio tracks...")
                cmd = [
                    "ffmpeg",
                    "-i", temp_video_mp4,
                    "-i", temp_audio_mp4,
                    "-c:v", "copy",
                    "-c:a", "copy",
                    "-shortest",
                    "-y",
                    final_output_path
                ]
                subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            else:
                # Direct move video to final path
                shutil.move(temp_video_mp4, final_output_path)
                
            # Clean up temp files
            shutil.rmtree(self.temp_dir, ignore_errors=True)
            download_paths[self.download_id] = self.output_path
            self.t_done = time.time()
            self.update_status("completed", 100.0)
            print(f"[+] Download completed! Saved to {final_output_path}")

        except DownloadCancelled:
            print(f"[*] Download cancelled by user: {self.title}")
            self.update_status("cancelled")
            # Drop partial files so a cancelled download leaves nothing behind.
            shutil.rmtree(self.temp_dir, ignore_errors=True)
        except Exception as e:
            print(f"[-] Download failed: {e}")
            self.update_status("failed", error_msg=str(e))
            # NOTE: we deliberately KEEP self.temp_dir on failure. The already
            # downloaded .ts segments let the download be resumed later (the
            # segment-skip logic in download_stream reuses them) instead of
            # restarting from zero. Temp files are only removed on success.

    def concat_segments(self, segments_dir, output_mp4):
        """Merges all TS segments in segments_dir into a single MP4 file.

        HLS .ts segments are byte-concatenable and already carry globally
        continuous PTS/DTS timestamps. We therefore join the raw bytes into
        one contiguous TS stream and remux it in a single pass.

        This deliberately AVOIDS the ffmpeg `concat` demuxer (-f concat), which
        re-bases each input file's timestamps to zero and then stacks them by
        their measured duration. Because consecutive HLS segments overlap by a
        few frames and the per-segment audio/video durations differ slightly,
        the demuxer inserts a small timestamp discontinuity at every join,
        producing a visible ~0.1-0.2s micro-freeze between each part (which
        accumulates over hundreds of segments). Byte-concatenation preserves
        the original continuous timing, so playback stays fluid.
        """
        ts_files = sorted([f for f in os.listdir(segments_dir) if f.endswith(".ts")])
        if not ts_files:
            raise Exception(f"No .ts segments found in {segments_dir}")

        # 1. Concatenate raw TS bytes into one continuous stream.
        joined_ts = os.path.join(segments_dir, "_joined.ts")
        with open(joined_ts, "wb") as out:
            for ts_file in ts_files:
                with open(os.path.join(segments_dir, ts_file), "rb") as src:
                    shutil.copyfileobj(src, out, length=1024 * 1024)

        # 2. Remux to MP4 in a single pass, keeping the original timestamps.
        #    +genpts fills any missing PTS; +faststart moves the moov atom to
        #    the front for smooth streaming/seeking.
        cmd = [
            "ffmpeg",
            "-fflags", "+genpts",
            "-i", joined_ts,
            "-c", "copy",
            "-movflags", "+faststart",
            "-y",
            output_mp4
        ]
        try:
            subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        finally:
            # Always drop the large intermediate file.
            if os.path.exists(joined_ts):
                os.remove(joined_ts)

# --------------------------------------------------------------------------- #
#  Persistence + download queue
# --------------------------------------------------------------------------- #

# Statuses considered "in flight" — these are re-queued on restart so an
# interrupted download resumes instead of being lost.
_RESUMABLE_STATES = ("pending", "queued", "downloading", "merging")


def _persist_state():
    """Atomically write the whole download registry to STATE_FILE.

    Stores, per download: current status/progress and the construction params
    needed to rebuild and resume the task after a restart. Already-downloaded
    .ts segments live in tmp/ and are reused on resume.
    """
    manager = _MANAGER
    if manager is None:
        return
    try:
        with _state_lock:
            data = {}
            for did, task in list(manager.tasks.items()):
                data[did] = {
                    "title": task.title,
                    "status": task.status,
                    "progress": round(task.progress, 1),
                    "error": task.error_msg,
                    "output_path": task.output_path,
                    "params": task.params,
                }
            os.makedirs(os.path.dirname(STATE_FILE) or ".", exist_ok=True)
            tmp_path = STATE_FILE + ".tmp"
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(data, f)
            os.replace(tmp_path, STATE_FILE)
    except Exception as e:
        print(f"[-] Failed to persist download state: {e}")


class DownloadManager:
    """Runs downloads through a bounded worker pool (a real queue) and keeps the
    registry persisted so the queue and history survive restarts."""

    def __init__(self, max_concurrent=2):
        self.tasks = {}                      # download_id -> DownloadTask
        self.max_concurrent = max(1, int(max_concurrent))
        self._queue = queue.Queue()
        self._workers = []
        self._started = False
        self._lock = threading.Lock()

    def set_concurrency(self, n):
        """Set how many downloads may run at once. Takes effect before the
        worker pool is started (i.e. before the first enqueue)."""
        self.max_concurrent = max(1, int(n))

    def start(self):
        with self._lock:
            if self._started:
                return
            self._started = True
            for _ in range(self.max_concurrent):
                t = threading.Thread(target=self._worker, daemon=True)
                t.start()
                self._workers.append(t)

    def _worker(self):
        while True:
            download_id = self._queue.get()
            try:
                task = self.tasks.get(download_id)
                if task and task.status in _RESUMABLE_STATES:
                    task.run()
            except Exception as e:
                print(f"[-] Download worker error: {e}")
            finally:
                self._queue.task_done()

    def enqueue(self, params):
        """Create a task from params and put it on the queue. Returns the task."""
        self.start()
        download_id = params.pop("download_id", None) or str(uuid.uuid4())
        task = DownloadTask(download_id=download_id, **params)
        self.tasks[download_id] = task
        task.update_status("queued")
        self._queue.put(download_id)
        return task

    def load_persisted(self):
        """Restore the registry from disk. Finished downloads become history;
        unfinished ones are re-queued and resume from their existing segments."""
        if not os.path.exists(STATE_FILE):
            return
        try:
            with open(STATE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception as e:
            print(f"[-] Could not read persisted download state: {e}")
            return

        requeued = 0
        for did, rec in data.items():
            params = rec.get("params") or {}
            if not params:
                continue
            try:
                task = DownloadTask(download_id=did, **params)
            except Exception as e:
                print(f"[-] Skipping unreconstructable download {did}: {e}")
                continue
            self.tasks[did] = task
            status = rec.get("status")
            task.output_path = rec.get("output_path")

            if status == "completed" and task.output_path and os.path.exists(task.output_path):
                task.status = "completed"
                task.progress = 100.0
                download_paths[did] = task.output_path
                active_downloads[did] = task.get_status()
            elif status == "failed":
                # Keep failed entries as history (their temp segments are kept,
                # so the user could retry); do not auto-run.
                task.status = "failed"
                task.error_msg = rec.get("error")
                task.progress = rec.get("progress", 0.0)
                active_downloads[did] = task.get_status()
            else:
                # Anything that was in flight resumes.
                self.start()
                task.update_status("queued", rec.get("progress", 0.0))
                self._queue.put(did)
                requeued += 1

        if requeued:
            print(f"[+] Resumed {requeued} interrupted download(s) from previous session.")
        _persist_state()

    def cancel(self, download_id):
        """Request cancellation of a queued or running download."""
        task = self.tasks.get(download_id)
        if not task:
            return False
        task.request_cancel()
        # If it hadn't started yet, reflect the cancellation immediately so the
        # worker skips it when it reaches the front of the queue.
        if task.status in ("queued", "pending"):
            task.update_status("cancelled")
        return True

    def clear(self):
        """Forget every download (used at startup so a new session starts with an
        empty download list — only favourites are remembered, in library.json)."""
        self.tasks.clear()
        active_downloads.clear()
        download_paths.clear()
        try:
            if os.path.exists(STATE_FILE):
                os.remove(STATE_FILE)
        except OSError:
            pass


# Single shared manager instance.
_MANAGER = DownloadManager()


def start_download_task(download_id, title, m3u8_video, m3u8_audio=None, key_info=None,
                        extra_headers=None, vidxgo_meta=None, proxies=None, vixcloud_meta=None):
    """Public API: enqueue a download onto the manager."""
    return _MANAGER.enqueue({
        "download_id": download_id,
        "title": title,
        "m3u8_video_url": m3u8_video,
        "m3u8_audio_url": m3u8_audio,
        "key_info": key_info,
        "extra_headers": extra_headers,
        "vidxgo_meta": vidxgo_meta,
        "vixcloud_meta": vixcloud_meta,
        "proxies": proxies,
    })


def load_persisted_state():
    """Entry point for the API to restore the queue/history on startup."""
    _MANAGER.load_persisted()


def clear_downloads():
    """Forget all downloads (the list starts empty every session)."""
    _MANAGER.clear()


def cancel_download(download_id):
    """Cancel a queued or running download. Returns True if it existed."""
    return _MANAGER.cancel(download_id)


def set_max_concurrent(n):
    """Entry point for the API to configure queue concurrency on startu