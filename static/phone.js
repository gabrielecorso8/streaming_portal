(function () {
  var p = new URLSearchParams(location.search);
  var src = p.get("src");
  var isHls = p.get("hls") === "1";
  var v = document.getElementById("v");
  var msg = document.getElementById("msg");
  var title = p.get("title") || "SC Portal";
  document.title = title;
  if (msg) msg.textContent = title;
  if (!src) { if (msg) msg.textContent = "Nessun media da riprodurre."; return; }
  function fail(t) { if (msg) msg.textContent = t || "Errore di riproduzione."; }
  v.addEventListener("error", function () { fail("Il video non parte. Riprova o usa un altro browser."); });
  if (isHls) {
    if (v.canPlayType("application/vnd.apple.mpegurl")) {
      v.src = src;                       // Safari/iOS: HLS nativo (AirPlay disponibile)
    } else if (window.Hls && window.Hls.isSupported()) {
      var h = new Hls();
      h.on(Hls.Events.ERROR, function (e, d) { if (d && d.fatal) fail("Stream non disponibile."); });
      h.loadSource(src);
      h.attachMedia(v);
    } else {
      v.src = src;
    }
  } else {
    v.src = src;
  }
  var pr = v.play();
  if (pr && pr.catch) pr.catch(function () { /* autoplay bloccato: l'utente preme play */ });
})();
