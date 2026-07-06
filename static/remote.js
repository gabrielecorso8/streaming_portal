(function () {
  var tok = (new URLSearchParams(location.search).get("t")) || "";
  try { if (tok) localStorage.setItem("sc_tok", tok); else tok = localStorage.getItem("sc_tok") || ""; } catch (e) {}
  try { var mf = document.getElementById("mf-link"); if (mf && tok) mf.href = "/api/pwa/manifest?kind=remote&t=" + encodeURIComponent(tok); } catch (e) {}
  if ("serviceWorker" in navigator) { try { navigator.serviceWorker.register("/sw.js"); } catch (e) {} }

  function api(u) { return u + (u.indexOf("?") >= 0 ? "&" : "?") + (tok ? "t=" + encodeURIComponent(tok) : ""); }

  var elTitle = document.getElementById("title"), elSub = document.getElementById("sub");
  var elCur = document.getElementById("cur"), elDur = document.getElementById("dur");
  var elSeek = document.getElementById("seek"), elPPicon = document.getElementById("ppicon");
  var elPrev = document.getElementById("prev"), elNext = document.getElementById("next");
  var elHdr = document.getElementById("hdr"), elConn = document.getElementById("conn"), elToast = document.getElementById("toast");
  var elDl = document.getElementById("dl"), elDlToggle = document.getElementById("dl-toggle");
  var elDlList = document.getElementById("dl-list"), elDlCount = document.getElementById("dl-count");

  var seeking = false, duration = 0, toastT = null, curTitle = "";
  var nav = { canPrev: false, canNext: false, moreExists: false };
  var files = [], coverMap = {}, dlLoaded = false;

  var ICON_PLAY = '<polygon points="7 4 20 12 7 20 7 4"></polygon>';
  var ICON_PAUSE = '<rect x="6" y="4" width="4" height="16" rx="1.4"></rect><rect x="14" y="4" width="4" height="16" rx="1.4"></rect>';
  var PLAY_MINI = '<svg viewBox="0 0 24 24" width="26" height="26" fill="#fff"><polygon points="8 5 20 12 8 19 8 5"></polygon></svg>';

  function esc(s) { return (s || "").replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function normName(s) { return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, ""); }
  function baseName(n) { return (n || "").replace(/\.(mp4|mkv|webm|m4v)$/i, ""); }
  function fmt(s) { s = Math.max(0, Math.floor(s || 0)); var m = Math.floor(s / 60), ss = ("0" + (s % 60)).slice(-2), h = Math.floor(m / 60); return h > 0 ? (h + ":" + ("0" + (m % 60)).slice(-2) + ":" + ss) : (m + ":" + ss); }
  function parseEpisode(name) {
    var s = name || "";
    var m = s.match(/^(.*?)[\s._-]*s(\d{1,2})[\s._-]*e(\d{1,3})/i)
         || s.match(/^(.*?)[\s._-]*(\d{1,2})x(\d{1,3})/i)
         || s.match(/^(.*?)stagione\s*(\d{1,3}).*?(?:episodio|ep\.?|puntata)\s*(\d{1,3})/i);
    if (!m) return null;
    return { series: (m[1] || "").trim(), season: parseInt(m[2], 10), episode: parseInt(m[3], 10) };
  }
  function episodeLabel(title) {
    var s = baseName(title), ep = parseEpisode(s);
    if (!ep) return s;
    var m = s.match(/s\d{1,2}[\s._-]*e\d{1,3}/i) || s.match(/\d{1,2}x\d{1,3}/i) || s.match(/(?:episodio|ep\.?|puntata)\s*\d{1,3}/i);
    var rest = m ? s.slice(s.indexOf(m[0]) + m[0].length) : "";
    rest = rest.replace(/^[\s._\-–—]+/, "").trim();
    return rest || ("Episodio " + ep.episode);
  }
  function coverUrl(name) {
    var c = coverMap[normName(name)];
    if (!c) return "";
    if (/^https?:/i.test(c)) return api("/api/img?u=" + encodeURIComponent(c));
    if (c.charAt(0) === "/") return api(c);
    return c;
  }
  function posterImg(name, cls) {
    var u = coverUrl(name);
    return u ? '<img src="' + esc(u) + '" alt="" loading="lazy">' : '';
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
  function playFile(id, label) {
    send("playId", null, { arg: id, label: label });
    toast("Riproduco: " + episodeLabel(label));
    elDl.classList.remove("open"); elDlToggle.setAttribute("aria-expanded", "false");
  }

  // ---- Vista download in stile SC Portal (locandine + stagioni) -------------
  function buildGroups() {
    var movies = [], series = {};
    files.forEach(function (f) {
      var base = baseName(f.name), ep = parseEpisode(base);
      if (ep) {
        var sk = normName(ep.series) || normName(base);
        var s = series[sk] || (series[sk] = { name: ep.series || base, seasons: {}, count: 0 });
        (s.seasons[ep.season] || (s.seasons[ep.season] = [])).push({ id: f.id, ep: ep.episode, label: episodeLabel(f.name), raw: base });
        s.count++;
      } else {
        movies.push({ id: f.id, name: base });
      }
    });
    return { movies: movies, series: series };
  }
  function renderDownloads() {
    if (!files.length) { elDlList.innerHTML = '<div class="dl-empty">Nessun download disponibile</div>'; elDlCount.textContent = ""; return; }
    elDlCount.textContent = "(" + files.length + ")";
    var g = buildGroups(), html = "";
    if (g.movies.length) {
      g.movies.sort(function (a, b) { return a.name.localeCompare(b.name, "it", { numeric: true }); });
      html += '<div class="rdl-sec">Film</div><div class="rdl-grid">';
      html += g.movies.map(function (m) {
        var on = (m.name === curTitle) ? " playing" : "";
        return '<button class="rdl-card' + on + '" data-id="' + esc(String(m.id)) + '" data-label="' + esc(m.name) + '">' +
               '<span class="rdl-thumb">' + posterImg(m.name) + '<span class="pl">' + PLAY_MINI + '</span></span>' +
               '<span class="rdl-card-nm">' + esc(m.name) + '</span></button>';
      }).join("") + '</div>';
    }
    var keys = Object.keys(g.series).sort(function (a, b) { return g.series[a].name.localeCompare(g.series[b].name, "it"); });
    if (keys.length) html += '<div class="rdl-sec">Serie</div>';
    keys.forEach(function (sk) {
      var s = g.series[sk];
      var seasonNums = Object.keys(s.seasons).map(Number).sort(function (a, b) { return a - b; });
      var seasonsHtml = seasonNums.map(function (sn) {
        var eps = s.seasons[sn].slice().sort(function (a, b) { return a.ep - b.ep; });
        return '<div class="rdl-season-title">Stagione ' + sn + '</div>' + eps.map(function (e) {
          var on = (e.raw === curTitle) ? " playing" : "";
          return '<button class="rdl-ep' + on + '" data-id="' + esc(String(e.id)) + '" data-label="' + esc(e.raw) + '">' +
                 '<span class="en">' + e.ep + '</span><span>' + esc(e.label) + '</span></button>';
        }).join("");
      }).join("");
      html += '<div class="rdl-series"><button class="rdl-series-head">' +
              '<span class="rdl-poster">' + posterImg(s.name) + '</span>' +
              '<span class="rdl-s-meta"><span class="rdl-s-name">' + esc(s.name) + '</span>' +
              '<span class="rdl-s-sub">' + s.count + (s.count === 1 ? ' episodio' : ' episodi') + '</span></span>' +
              '<svg class="chev" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>' +
              '</button><div class="rdl-seasons">' + seasonsHtml + '</div></div>';
    });
    elDlList.innerHTML = html;
  }
  elDlList.addEventListener("click", function (e) {
    var head = e.target.closest(".rdl-series-head");
    if (head) { head.parentNode.classList.toggle("open"); return; }
    var it = e.target.closest("[data-id]");
    if (it) playFile(it.getAttribute("data-id"), it.getAttribute("data-label"));
  });

  async function loadDownloads() {
    try {
      var res = await Promise.all([
        fetch(api("/api/downloads/local"), { cache: "no-store" }).then(function (r) { return r.json(); }),
        fetch(api("/api/folders"), { cache: "no-store" }).then(function (r) { return r.json(); }).catch(function () { return null; })
      ]);
      files = res[0] || [];
      coverMap = {};
      var lib = res[1] || {};
      var items = [].concat(lib.unassigned || [], (lib.folders || []).reduce(function (a, f) { return a.concat(f.items || []); }, []));
      items.forEach(function (it) { if (it && it.name && it.cover) coverMap[normName(it.name)] = it.cover; });
      dlLoaded = true; renderDownloads();
    } catch (e) { elDlList.innerHTML = '<div class="dl-empty">Impossibile leggere i download</div>'; }
  }
  elDlToggle.addEventListener("click", function () {
    var open = !elDl.classList.contains("open");
    elDl.classList.toggle("open", open);
    elDlToggle.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) loadDownloads();
  });

  // ---- Trasporto + navigazione ---------------------------------------------
  function goNext() { if (nav.canNext) { send("next"); return; } toast(nav.moreExists ? "Prossimo episodio non ancora scaricato — scaricalo dal computer" : "Nessun titolo successivo"); }
  function goPrev() { if (nav.canPrev) { send("prev"); return; } toast("Nessun titolo precedente"); }
  Array.prototype.forEach.call(document.querySelectorAll(".controls [data-a], .footer [data-a]"), function (b) {
    b.addEventListener("click", function () {
      var a = b.getAttribute("data-a");
      if (a === "next") return goNext();
      if (a === "prev") return goPrev();
      var v = b.getAttribute("data-v");
      send(a, v != null ? parseFloat(v) : null);
    });
  });
  elSeek.addEventListener("input", function () { seeking = true; });
  elSeek.addEventListener("change", function () { if (duration > 0) send("seek", (elSeek.value / 1000) * duration); setTimeout(function () { seeking = false; }, 400); });
  // Spegnimento server dal telecomando
  var elPower = document.getElementById("power-btn");
  if (elPower) elPower.addEventListener("click", function () {
    if (!confirm("Spegnere SC Portal? Il server verra' chiuso.")) return;
    fetch(api("/api/shutdown"), { method: "POST" }).catch(function () {});
    document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;text-align:center;padding:2rem;color:#8b8ba3;font-family:system-ui,sans-serif"><div><h2 style="color:#fff;margin:0 0 .5rem">SC Portal spento</h2><p>Puoi chiudere questa scheda.</p></div></div>';
  });

  function applyNav() { elPrev.classList.toggle("disabled", !nav.canPrev); elNext.classList.toggle("disabled", !nav.canNext && !nav.moreExists); }

  var missed = 0;
  async function poll() {
    try {
      var st = await (await fetch(api("/api/remote/state"), { cache: "no-store" })).json();
      missed = 0; elHdr.classList.add("live");
      elConn.textContent = st.title ? "Collegato" : "In attesa";
      elTitle.textContent = st.title ? (parseEpisode(st.title) ? episodeLabel(st.title) : st.title) : "Scegli un titolo dai tuoi download";
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
