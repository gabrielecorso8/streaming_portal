import os
import re
import sys
import time
import shutil
import urllib.parse
import subprocess
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests
from bs4 import BeautifulSoup
import m3u8
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend

import vidxgo

# Global status tracker for active downloads
active_downloads = {}
# Maps download_id -> absolute path of the finished file (used to open/reveal it)
download_paths = {}

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
                 output_dir="downloads", extra_headers=None, vidxgo_meta=None, proxies=None):
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
        # vidxgo token-refresh metadata: {id, mode, season, episode, iframe_url}.
        # When present, every segment URL's ?t=&e= signature is kept fresh by
        # re-minting through vidxgo /t, because those tokens expire in ~180s.
        self.vidxgo_meta = vidxgo_meta
        self._sig = None
        self._sig_lock = threading.Lock()
        self._last_refresh = 0.0

        self.temp_dir = os.path.join("tmp", f"download_{download_id}")
        self.video_temp_dir = os.path.join(self.temp_dir, "video")
        self.audio_temp_dir = os.path.join(self.temp_dir, "audio")

        self.progress = 0.0
        self.status = "pending"
        self.error_msg = None
        self.output_path = None  # absolute path of the finished .mp4

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

    def _seg_url(self, base_seg_url):
        """Rewrite a segment URL with the current (auto-refreshed) token."""
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
        if self.status == "completed" and self.output_path and os.path.exists(self.output_path):
            st["file"] = os.path.basename(self.output_path)
            try:
                st["size"] = os.path.getsize(self.output_path)
            except OSError:
                pass
        return st

    def update_status(self, status, progress=None, error_msg=None):
        self.status = status
        if progress is not None:
            self.progress = progress
        if error_msg is not None:
            self.error_msg = error_msg
        active_downloads[self.download_id] = self.get_status()

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
        resp = requests.get(key_url, headers=headers, timeout=10, proxies=self.proxies)
        if resp.status_code == 200:
            return resp.content
        else:
            raise Exception(f"Failed to fetch AES key. Status code: {resp.status_code}")

    def download_stream(self, stream_url, target_dir, key_bytes, stream_type="video", weight=1.0, progress_offset=0.0):
        os.makedirs(target_dir, exist_ok=True)

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        headers.update(self.extra_headers)

        # Seed the vidxgo token signature from the playlist URL before fetching.
        if self.vidxgo_meta and self._sig is None:
            t, e = vidxgo.sig_of(stream_url)
            self._sig = {"t": t, "e": e}

        # 1. Fetch playlist
        resp = requests.get(stream_url, headers=headers, timeout=10, proxies=self.proxies)
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
                    key_resp = requests.get(absolute_key_url, headers=key_headers, timeout=10, proxies=self.proxies)
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
            base_seg_url = urllib.parse.urljoin(stream_url, seg_uri)

            # Simple retry mechanism (extra attempts for token-refresh streams)
            attempts = 5 if self.vidxgo_meta else 3
            for retry in range(attempts):
                try:
                    seg_url = self._seg_url(base_seg_url)
                    seg_resp = requests.get(seg_url, headers=headers, timeout=15, proxies=self.proxies)
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
                    # An expired/forbidden token: re-mint and retry immediately.
                    if seg_resp.status_code in (401, 403) and self.vidxgo_meta:
                        self._refresh_sig(force=True)
                        continue
                    raise Exception(f"HTTP {seg_resp.status_code}")
                except Exception as e:
                    print(f"[-] Segment {idx} download attempt {retry+1} failed: {e}")
                    if self.vidxgo_meta:
                        self._refresh_sig(force=True)
                    time.sleep(1)
            raise Exception(f"Failed to download segment {idx} after retries")

        # Use ThreadPoolExecutor for downloading segments concurrently
        with ThreadPoolExecutor(max_workers=30) as executor:
            futures = [executor.submit(download_segment, i, seg.uri) for i, seg in enumerate(segments)]
            for future in as_completed(futures):
                future.result()  # Will raise exceptions if any segment download failed

    def download_direct_file(self, url, output_path):
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        # Disable SSL verification for safety since the user runs in verify=False mode
        resp = requests.get(url, headers=headers, stream=True, timeout=15, verify=False, proxies=self.proxies)
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
            self.update_status("completed", 100.0)
            print(f"[+] Download completed! Saved to {final_output_path}")
            
        except Exception as e:
            print(f"[-] Download failed: {e}")
            self.update_status("failed", error_msg=str(e))
            # Clean up temp folder on failure
            shutil.rmtree(self.temp_dir, ignore_errors=True)

    def concat_segments(self, segments_dir, output_mp4):
        """Merges all TS files in segments_dir into a single MP4 file."""
        ts_files = sorted([f for f in os.listdir(segments_dir) if f.endswith(".ts")])
        
        file_list_path = os.path.join(segments_dir, "file_list.txt")
        with open(file_list_path, "w", encoding="utf-8") as f:
            for ts_file in ts_files:
                # Use absolute path and escape single quotes for ffmpeg format
                abs_path = os.path.abspath(os.path.join(segments_dir, ts_file))
                escaped_path = abs_path.replace("'", "'\\''")
                f.write(f"file '{escaped_path}'\n")
                
        cmd = [
            "ffmpeg",
            "-f", "concat",
            "-safe", "0",
            "-i", file_list_path,
            "-c", "copy",
            "-y",
            output_mp4
        ]
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def start_download_task(download_id, title, m3u8_video, m3u8_audio=None, key_info=None,
                        extra_headers=None, vidxgo_meta=None, proxies=None):
    task = DownloadTask(download_id, title, m3u8_video, m3u8_audio, key_info,
                        extra_headers=extra_headers, vidxgo_meta=vidxgo_meta, proxies=proxies)
    thread = threading.Thread(target=task.run)
    thread.daemon = True
    thread.start()
    return task
