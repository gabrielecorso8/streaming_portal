(function () {
  var p = new URLSearchParams(location.search);
  var src = p.get("src");
  var isHls = p.get("hls") === "1";
  var tok = p.get("t") || "";
  var v = document.getElementById("v");
  var msg = document.getElementById("msg");
  var title = p.get("title") || "SC Portal";
  document.title = title;
  if (msg) msg.textContent = title;
  if (!src) { if (msg) msg.textContent = "Nessun media da riprodurre."; return; }
  function withTok(u) {
    if (!tok) return u;
    return u + (u.indexOf("?") >= 0 ? "&" : "?") + "t=" + encodeURIComponent(tok);
  }
  var mediaUrl = withTok(src);
  function fail(t) { if (msg) msg.textContent = t || "Errore di riproduzione."; }
  v.addEventListener("error", function () { fail("Il video non parte su questo dispositivo. Controlla di essere sulla stessa Wi-Fi."); });
  if (isHls) {
    if (v.canPlayType("application/vnd.apple.mpegurl")) {
      v.src = mediaUrl;                       // iOS/Safari: HLS nativo (AirPlay disponibile)
    } else if (window.Hls && window.Hls.isSupported()) {
      var h = new Hls();
      h.on(Hls.Events.ERROR, function (e, d) { if (d && d.fatal) fail("Stream non disponibile (" + (d.details || d.type || "errore") + ")."); });
      h.loadSource(mediaUrl);
      h.attachMedia(v);
    } else {
      v.src = mediaUrl;
    }
  } else {
    v.src = mediaUrl;
  }
  var pr = v.play();
  if (pr && pr.catch) pr.catch(function () { if (msg) msg.textContent = title + " \u2014 premi \u25b6 per avviare"; });
})();
