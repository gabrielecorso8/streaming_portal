(function () {
  var tok = (new URLSearchParams(location.search).get("t")) || "";
  try {
    if (tok) localStorage.setItem("sc_tok", tok);
    else tok = localStorage.getItem("sc_tok") || "";
  } catch (e) {}
  try {
    var mf = document.getElementById("mf-link");
    if (mf && tok) mf.href = "/api/pwa/manifest?kind=remote&t=" + encodeURIComponent(tok);
  } catch (e) {}
  if ("serviceWorker" in navigator) { try { navigator.serviceWorker.register("/sw.js"); } catch (e) {} }

  function api(u) { return u + (u.indexOf("?") >= 0 ? "&" : "?") + (tok ? "t=" + encodeURIComponent(tok) : ""); }

  var elTitle = document.getElementById("title");
  var elSub = document.getElementById("sub");
  var elCur = document.getElementById("cur");
  var elDur = document.getElementById("dur");
  var elSeek = document.getElementById("seek");
  var elPPicon = document.getElementById("ppicon");
  var elPrev = document.getElementById("prev");
  var elNext = document.getElementById("next");
  var elHdr = document.getElementById("hdr");
  var elConn = document.getElementById("conn");
  var elToast = document.getElementById("toast");
  var elDl = document.getElementById("dl");
  var elDlToggle = document.getElementById("dl-toggle");
  var elDlList = document.getElementById("dl-list");
  var elDlCount = document.getElementById("dl-count");

  var seeking = false, duration = 0, toastT = null, curTitle = "";
  var nav = { canPrev: false, canNext: false, moreExists: false };
  var downloads = [], dlLoaded = false;

  var ICON_PLAY = '<polygon points="7 4 20 12 7 20 7 4"></polygon>';
  var ICON_PAUSE = '<rect x="6" y="4" width="4" height="16" rx="1.4"></rect><rect x="14" y="4" width="4" height="16" rx="1.4"></rect>';
  var ICON_ROW = '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><polygon points="7 4 20 12 7 20 7 4"></polygon></svg>';

  function esc(s) { return (s || "").replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function fmt(s) {
    s = Math.max(0, Math.floor(s || 0));
    var m = Math.floor(s / 60), ss = ("0" + (s % 60)).slice(-2), h = Math.floor(m / 60);
    if (h > 0) return h + ":" + ("0" + (m % 60)).slice(-2) + ":" + ss;
    return m + ":" + ss;
  }
  function toast(msg) {
    elToast.textContent = msg; elToast.classList.add("show");
    if (toastT) clearTimeout(toastT);
    toastT = setTimeout(function () { elToast.classList.remove("show"); }, 3200);
    if (navigator.vibrate) { try { navigator.vibrate(15); } catch (e) {} }
  }
  function send(action, value, extra) {
    var body = { action: action, value: value != null ? value : null };
    if (extra) { body.arg = extra.arg; body.label = extra.label; }
    fetch(api("/api/remote/cmd"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(function () {});
    if (navigator.vibrate) { try { navigator.vibrate(12); } catch (e) {} }
  }

  // ---- Menù a tendina: i tuoi download -------------------------------------
  function labelFor(f) {
    return (f.name || "").replace(/\.(mp4|mkv|webm|m4v)$/i, "");
  }
  function renderDownloads() {
    if (!downloads.length) { elDlList.innerHTML = '<div class="dl-empty">Nessun download disponibile</div>'; elDlCount.textContent = ""; return; }
    elDlCount.textContent = "(" + downloads.length + ")";
    elDlList.innerHTML = downloads.map(function (f) {
      var nm = labelFor(f);
      var on = curTitle && (nm === curTitle) ? " playing" : "";
      return '<button class="dl-item' + on + '" data-id="' + esc(String(f.id)) + '" data-name="' + esc(nm) + '">' +
             '<span class="dot-play">' + ICON_ROW + '</span><span class="nm">' + esc(nm) + '</span></button>';
    }).join("");
    Array.prototype.forEach.call(elDlList.querySelectorAll(".dl-item"), function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-id"), name = b.getAttribute("data-name");
        send("playId", null, { arg: id, label: name });
        toast("Riproduco: " + name);
        elDl.classList.remove("open"); elDlToggle.setAttribute("aria-expanded", "false");
      });
    });
  }
  async function loadDownloads() {
    try {
      var r = await fetch(api("/api/downloads/local"), { cache: "no-store" });
      downloads = (await r.json()) || [];
      downloads.sort(function (x, y) { return labelFor(x).localeCompare(labelFor(y), "it", { numeric: true }); });
      dlLoaded = true; renderDownloads();
    } catch (e) { elDlList.innerHTML = '<div class="dl-empty">Impossibile leggere i download</div>'; }
  }
  elDlToggle.addEventListener("click", function () {
    var open = !elDl.classList.contains("open");
    elDl.classList.toggle("open", open);
    elDlToggle.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) loadDownloads();
  });

  // ---- Navigazione con feedback -------------------------------------------
  function goNext() {
    if (nav.canNext) { send("next"); return; }
    toast(nav.moreExists ? "Prossimo episodio non ancora scaricato — scaricalo dal computer" : "Nessun titolo successivo");
  }
  function goPrev() {
    if (nav.canPrev) { send("prev"); return; }
    toast("Nessun titolo precedente");
  }
  Array.prototype.forEach.call(document.querySelectorAll("[data-a]"), function (b) {
    b.addEventListener("click", function () {
      var a = b.getAttribute("data-a");
      if (a === "next") return goNext();
      if (a === "prev") return goPrev();
      var v = b.getAttribute("data-v");
      send(a, v != null ? parseFloat(v) : null);
    });
  });
  elSeek.addEventListener("input", function () { seeking = true; });
  elSeek.addEventListener("change", function () {
    if (duration > 0) send("seek", (elSeek.value / 1000) * duration);
    setTimeout(function () { seeking = false; }, 400);
  });

  function applyNav() {
    elPrev.classList.toggle("disabled", !nav.canPrev);
    elNext.classList.toggle("disabled", !nav.canNext && !nav.moreExists);
  }

  var missed = 0;
  async function poll() {
    try {
      var r = await fetch(api("/api/remote/state"), { cache: "no-store" });
      var st = await r.json();
      missed = 0; elHdr.classList.add("live");
      var idle = !st.title;
      elConn.textContent = idle ? "In attesa" : "Collegato";
      elTitle.textContent = st.title || "Scegli un titolo dai tuoi download";
      nav.canPrev = !!st.canPrev; nav.canNext = !!st.canNext; nav.moreExists = !!st.moreExists;
      elSub.textContent = (!st.canNext && st.moreExists) ? "Prossimo episodio da scaricare sul PC" : "";
      duration = st.duration || 0;
      elCur.textContent = fmt(st.time); elDur.textContent = fmt(duration);
      if (!seeking && duration > 0) elSeek.value = Math.round((st.time / duration) * 1000);
      elPPicon.innerHTML = st.playing ? ICON_PAUSE : ICON_PLAY;
      if ((st.title || "") !== curTitle) { curTitle = st.title || ""; if (dlLoaded) renderDownloads(); }
      applyNav();
    } catch (e) {
      if (++missed >= 2) {
        elHdr.classList.remove("live");
        elConn.textContent = "Offline";
        elTitle.textContent = "SC Portal chiuso o non raggiungibile";
        elSub.textContent = "Accendi SC Portal sul PC — stessa Wi-Fi";
      }
    }
  }
  poll();
  setInterval(poll, 1000);
})();
