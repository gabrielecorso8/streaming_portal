(function () {
  var tok = (new URLSearchParams(location.search).get("t")) || "";
  // Persisti il token: l'app installata in home riparte gia' autenticata.
  try {
    if (tok) localStorage.setItem("sc_tok", tok);
    else tok = localStorage.getItem("sc_tok") || "";
  } catch (e) {}
  // Manifest col token (per Aggiungi a Home) + service worker (installabile).
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

  var seeking = false, duration = 0, toastT = null;
  var nav = { canPrev: false, canNext: false, moreExists: false, moreLabel: "" };

  var ICON_PLAY = '<polygon points="7 4 20 12 7 20 7 4"></polygon>';
  var ICON_PAUSE = '<rect x="6" y="4" width="4" height="16" rx="1.4"></rect><rect x="14" y="4" width="4" height="16" rx="1.4"></rect>';

  function fmt(s) {
    s = Math.max(0, Math.floor(s || 0));
    var m = Math.floor(s / 60), ss = ("0" + (s % 60)).slice(-2);
    var h = Math.floor(m / 60);
    if (h > 0) return h + ":" + ("0" + (m % 60)).slice(-2) + ":" + ss;
    return m + ":" + ss;
  }
  function toast(msg) {
    elToast.textContent = msg;
    elToast.classList.add("show");
    if (toastT) clearTimeout(toastT);
    toastT = setTimeout(function () { elToast.classList.remove("show"); }, 3200);
    if (navigator.vibrate) { try { navigator.vibrate(15); } catch (e) {} }
  }
  function send(action, value) {
    fetch(api("/api/remote/cmd"), { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: action, value: value }) }).catch(function () {});
    if (navigator.vibrate) { try { navigator.vibrate(12); } catch (e) {} }
  }

  // Navigazione prossimo/precedente con feedback chiaro sul telefono
  function goNext() {
    if (nav.canNext) { send("next"); return; }
    if (nav.moreExists) {
      toast("Prossimo episodio non ancora scaricato — scaricalo dal computer");
    } else {
      toast("Nessun titolo successivo");
    }
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
      missed = 0;
      elHdr.classList.add("live");
      var idle = !st.title;
      elConn.textContent = idle ? "In attesa di riproduzione sul PC" : "Collegato al PC";
      elTitle.textContent = st.title || "Avvia un titolo sul PC";
      nav.canPrev = !!st.canPrev; nav.canNext = !!st.canNext;
      nav.moreExists = !!st.moreExists; nav.moreLabel = st.moreLabel || "";
      elSub.textContent = (!st.canNext && st.moreExists)
        ? "Prossimo episodio da scaricare sul PC" : "";
      duration = st.duration || 0;
      elCur.textContent = fmt(st.time);
      elDur.textContent = fmt(duration);
      if (!seeking && duration > 0) elSeek.value = Math.round((st.time / duration) * 1000);
      elPPicon.innerHTML = st.playing ? ICON_PAUSE : ICON_PLAY;
      applyNav();
    } catch (e) {
      if (++missed >= 2) {
        elHdr.classList.remove("live");
        elConn.textContent = "SC Portal chiuso o non raggiungibile — stessa Wi-Fi?";
        elTitle.textContent = "Nessuna connessione col PC";
        elSub.textContent = "";
      }
    }
  }
  poll();
  setInterval(poll, 1000);
})();
