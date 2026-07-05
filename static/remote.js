(function () {
  var tok = (new URLSearchParams(location.search).get("t")) || "";
  function api(u) { return u + (u.indexOf("?") >= 0 ? "&" : "?") + (tok ? "t=" + encodeURIComponent(tok) : ""); }
  var elTitle = document.getElementById("title");
  var elCur = document.getElementById("cur");
  var elDur = document.getElementById("dur");
  var elSeek = document.getElementById("seek");
  var elPP = document.getElementById("pp");
  var elStatus = document.getElementById("status");
  var seeking = false, duration = 0;

  function fmt(s) {
    s = Math.max(0, Math.floor(s || 0));
    var m = Math.floor(s / 60), ss = ("0" + (s % 60)).slice(-2);
    var h = Math.floor(m / 60);
    if (h > 0) return h + ":" + ("0" + (m % 60)).slice(-2) + ":" + ss;
    return m + ":" + ss;
  }
  function send(action, value) {
    fetch(api("/api/remote/cmd"), { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: action, value: value }) }).catch(function () {});
  }
  Array.prototype.forEach.call(document.querySelectorAll("button[data-a]"), function (b) {
    b.addEventListener("click", function () {
      var a = b.getAttribute("data-a");
      var v = b.getAttribute("data-v");
      send(a, v != null ? parseFloat(v) : null);
    });
  });
  elSeek.addEventListener("input", function () { seeking = true; });
  elSeek.addEventListener("change", function () {
    if (duration > 0) send("seek", (elSeek.value / 1000) * duration);
    setTimeout(function () { seeking = false; }, 400);
  });

  async function poll() {
    try {
      var r = await fetch(api("/api/remote/state"), { cache: "no-store" });
      var st = await r.json();
      elStatus.textContent = "Connesso al PC";
      elTitle.textContent = st.title || "—";
      duration = st.duration || 0;
      elCur.textContent = fmt(st.time);
      elDur.textContent = fmt(duration);
      if (!seeking && duration > 0) elSeek.value = Math.round((st.time / duration) * 1000);
      elPP.textContent = st.playing ? "⏸" : "▶";
    } catch (e) {
      elStatus.textContent = "Nessuna connessione col PC (stessa Wi-Fi?)";
    }
  }
  poll();
  setInterval(poll, 1000);
})();
