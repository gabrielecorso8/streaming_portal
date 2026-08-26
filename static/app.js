let currentTitle = null; // Stores current active media details
let activeHls = null;    // Stores active HLS.js instance
let proxyConfigured = false;   // se e impostato un proxy (privacy)
let currentMediaForCast = null; // { src, hls, title } del media in riproduzione
let _proxyWarned = false;      // avviso proxy mostrato una volta
let lastTitleContext = ""; // Name of the title being opened (for domain-error messages)
let currentLibKey = "";    // Library key of the title currently shown in the modal
let libraryCache = [];     // Last known library list (to read favourite state)
let openFolders = new Set(); // Folder ids currently expanded (kept across re-renders)
let openGroups = new Set(); // (legacy)
let closedGroups = new Set(); // categorie CHIUSE (default: tutte aperte)
let openDownloadGroups = new Set(); // cartelle/sottocartelle download espanse
let touchedDownloadGroups = new Set(); // ricorda quali gruppi download l'utente ha aperto/chiuso
let localCustomFilters = new Set(); // filtri creati nella sessione corrente
let librarySel = new Map(); // key -> item: multi-selezione titoli in libreria
let playbackCtx = null;    // {folderId, items:[...], index}: contesto prev/next
let currentPlayTitle = "";  // titolo attualmente in riproduzione
let downloadedKeys = new Set(); // chiavi dei titoli gia' scaricati
let downloadByKey = {};    // key -> download_id (completati)
let localByName = {};      // nome-normalizzato -> id file locale (/downloads)
let localFiles = [];       // [{id,name,file}] file in /downloads
let localDownloads = [];   // voci 'completate' dai file locali (per la lista download)
let _downloadsSnapshot = []; // ultima lista /api/download/status (per l'anti-duplicati)
let _deviceBlobUrl = null;   // URL blob del file locale del telefono in riproduzione
let _dlSig = "";             // firma dell'ultima lista download (evita rebuild inutili = niente flicker)
let _cwSig = "";             // firma di "Continua a guardare"
let _bannerDismissed = false; // l'utente ha chiuso il banner 'prossimo'
let _bannerReshown = false;   // gia' riproposto a 3/4
let librarySearch = "";    // current library search query
let lastLibraryData = null; // last folders payload (to re-render without refetch)
let searchAll = [];        // all results from the last search (for pagination)
let searchQ = "";          // last search query (for the header)
let searchPage = 1;        // current results page (1-based)
const SEARCH_PER_PAGE = 18; // posters shown per page
let searchSel = new Map(); // id_and_slug -> item, multi-select on search posters
let folderFilters = new Map(); // folderId -> {type, order} view filters (in-memory)
let librarySearchType = "";  // ricerca libreria: filtro film/serie
let librarySearchOrder = ""; // ricerca libreria: ordine (recent/oldest)

// Helper for UI elements
const el = {
    domainInput: document.getElementById("domain-input"),
    saveSettingsBtn: document.getElementById("save-settings-btn"),
    refreshDomainBtn: document.getElementById("refresh-domain-btn"),
    proxyInput: document.getElementById("proxy-input"),
    saveProxyBtn: document.getElementById("save-proxy-btn"),
    urlInput: document.getElementById("url-input"),
    miniSearch: document.getElementById("mini-search"),
    loadUrlBtn: document.getElementById("load-url-btn"),
    convertUrlBtn: document.getElementById("convert-url-btn"),
    searchResultsSection: document.getElementById("search-results-section"),
    searchResultsTitle: document.getElementById("search-results-title"),
    searchResults: document.getElementById("search-results"),
    searchSort: document.getElementById("search-sort"),
    searchGenre: document.getElementById("search-genre"),
    searchType: document.getElementById("search-type"),
    srcSc: document.getElementById("src-sc"),
    srcAw: document.getElementById("src-aw"),
    privacyBanner: document.getElementById("privacy-banner"),
    privacyDismiss: document.getElementById("privacy-dismiss"),
    privacyVpnOk: document.getElementById("privacy-vpn-ok"),
    privacyCheckIp: document.getElementById("privacy-check-ip"),
    privacyIpResult: document.getElementById("privacy-ip-result"),
    searchClear: document.getElementById("search-clear"),
    openFolderBtn: document.getElementById("open-folder-btn"),
    shutdownBtn: document.getElementById("shutdown-btn"),
    privacyCleanBtn: document.getElementById("privacy-clean-btn"),
    privacyShieldBtn: document.getElementById("privacy-shield-btn"),

    // Details Modal
    detailsModal: document.getElementById("details-modal"),
    closeModalBtn: document.getElementById("close-modal-btn"),
    favModalBtn: document.getElementById("fav-modal-btn"),
    detailCover: document.getElementById("detail-cover"),
    detailTitle: document.getElementById("detail-title"),
    detailYear: document.getElementById("detail-year"),
    detailScore: document.getElementById("detail-score"),
    detailRuntime: document.getElementById("detail-runtime"),
    detailPlot: document.getElementById("detail-plot"),
    detailGenres: document.getElementById("detail-genres"),
    movieActions: document.getElementById("movie-actions"),
    streamMovieBtn: document.getElementById("stream-movie-btn"),
    downloadMovieBtn: document.getElementById("download-movie-btn"),
    seriesContainer: document.getElementById("series-container"),
    seasonSelect: document.getElementById("season-select"),
    episodesList: document.getElementById("episodes-list"),
    
    // Player
    playerSection: document.getElementById("player-section"),
    closePlayerBtn: document.getElementById("close-player-btn"),
    videoPlayer: document.getElementById("video-player"),
    iframePlayer: document.getElementById("iframe-player"),
    playingTitle: document.getElementById("playing-title"),
    qualitySelect: document.getElementById("quality-select"),
    refreshDownloadsBtn: document.getElementById("refresh-downloads-btn"),
    castBtn: document.getElementById("cast-btn"),
    ccBtn: document.getElementById("cc-btn"),
    videoContainer: document.querySelector(".video-container"),
    fsBtn: document.getElementById("player-fs-btn"),
    phonecastBtn: document.getElementById("phonecast-btn"),
    remoteBtn: document.getElementById("remote-btn"),
    headerCastBtn: document.getElementById("header-cast-btn"),
    headerRemoteBtn: document.getElementById("header-remote-btn"),
    headerSearchBtn: document.getElementById("header-search-btn"),
    headerFavoritesBtn: document.getElementById("header-favorites-btn"),
    headerDownloadsBtn: document.getElementById("header-downloads-btn"),
    headerLibraryBtn: document.getElementById("header-library-btn"),
    prevTitleBtn: document.getElementById("prev-title-btn"),
    nextTitleBtn: document.getElementById("next-title-btn"),
    nextBanner: document.getElementById("next-banner"),
    audioSelect: document.getElementById("audio-select"),
    audioLabel: document.getElementById("audio-label"),
    qualityBar: document.querySelector(".player-controls-bar"),
    qualityLabel: document.querySelector('label[for="quality-select"]'),
    
    // Domains
    domainsList: document.getElementById("domains-list"),
    testDomainsBtn: document.getElementById("test-domains-btn"),
    manualDomainBtn: document.getElementById("manual-domain-btn"),
    sourceDomainInput: document.getElementById("source-domain-input"),
    addSourceDomainBtn: document.getElementById("add-source-domain-btn"),
    sourceDomainsList: document.getElementById("source-domains-list"),

    // Library
    libraryList: document.getElementById("library-list"),
    librarySearch: document.getElementById("library-search"),
    libraryType: document.getElementById("library-type"),
    libraryOrder: document.getElementById("library-order"),
    saveLibraryBtn: document.getElementById("save-library-btn"),

    // Downloads
    downloadsList: document.getElementById("downloads-list"),
    
    // Toast
    toast: document.getElementById("toast")
};

// Toast notification helper
function showToast(message, duration = 3000) {
    el.toast.textContent = message;
    el.toast.classList.remove("hidden");
    setTimeout(() => {
        el.toast.classList.add("hidden");
    }, duration);
}

// 1. Initial Load & Settings
async function init() {
    try {
        const resp = await fetch("/api/settings");
        if (resp.ok) {
            const data = await resp.json();
            el.domainInput.value = data.domain;
            if (el.proxyInput) el.proxyInput.value = data.proxy || "";
        }
    } catch (e) {
        console.error("Failed to load settings:", e);
    }

    // Setup event listeners
    el.saveSettingsBtn.addEventListener("click", updateSettings);
    if (el.refreshDomainBtn) el.refreshDomainBtn.addEventListener("click", manualRefreshDomain);
    el.saveProxyBtn.addEventListener("click", updateProxy);
    el.proxyInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") updateProxy();
    });
    el.loadUrlBtn.addEventListener("click", handleMainInput);
    el.convertUrlBtn.addEventListener("click", convertDirectUrl);
    el.openFolderBtn.addEventListener("click", openDownloadsFolder);
    if (el.shutdownBtn) el.shutdownBtn.addEventListener("click", shutdownApp);
    if (el.privacyCleanBtn) el.privacyCleanBtn.addEventListener("click", privacyClean);
    if (el.privacyShieldBtn) el.privacyShieldBtn.addEventListener("click", openPrivacyPanel);
    el.urlInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") handleMainInput();
    });
    el.closeModalBtn.addEventListener("click", closeModal);
    if (el.favModalBtn) el.favModalBtn.addEventListener("click", toggleModalFavorite);
    el.closePlayerBtn.addEventListener("click", closePlayer);
    
    // Setup detail actions
    if (el.streamMovieBtn) el.streamMovieBtn.addEventListener("click", () => startStream(currentTitle.id, currentTitle.name));
    el.downloadMovieBtn.addEventListener("click", () => triggerDownload(currentTitle.name, currentTitle.id));
    el.seasonSelect.addEventListener("change", loadSeasonEpisodes);
    
    if (el.testDomainsBtn) el.testDomainsBtn.addEventListener("click", testDomains);
    if (el.manualDomainBtn) el.manualDomainBtn.addEventListener("click", updateDomainFromLink);
    if (el.addSourceDomainBtn) el.addSourceDomainBtn.addEventListener("click", addSourceDomain);
    if (el.sourceDomainInput) el.sourceDomainInput.addEventListener("keypress", (e) => { if (e.key === "Enter") addSourceDomain(); });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && el.playerSection && !el.playerSection.classList.contains("hidden")) closePlayer();
    });
    if (el.refreshDownloadsBtn) el.refreshDownloadsBtn.addEventListener("click", refreshDownloads);
    if (el.castBtn) el.castBtn.addEventListener("click", castToTV);
    if (el.ccBtn) el.ccBtn.addEventListener("click", toggleCC);
    if (el.fsBtn) el.fsBtn.addEventListener("click", requestPlayerFullscreen);
    if (el.phonecastBtn) el.phonecastBtn.addEventListener("click", openPhoneCast);
    if (el.headerCastBtn) el.headerCastBtn.addEventListener("click", openPhoneCast);
    if (el.headerRemoteBtn) el.headerRemoteBtn.addEventListener("click", openRemoteQr);
    if (el.videoPlayer && "disableRemotePlayback" in el.videoPlayer) el.videoPlayer.disableRemotePlayback = false;
    if (el.videoPlayer) {
        el.videoPlayer.addEventListener("loadedmetadata", _resumePlayback);
        el.videoPlayer.addEventListener("timeupdate", _savePlayback);
        el.videoPlayer.addEventListener("pause", _savePlayback);
        el.videoPlayer.addEventListener("ended", function () { _clearPlayback(_playKey); });
    }
    const _closeMini = () => { if (el.miniSearch) el.miniSearch.classList.add("hidden"); if (el.headerSearchBtn) el.headerSearchBtn.classList.remove("active"); };
    if (el.headerSearchBtn && el.miniSearch) el.headerSearchBtn.addEventListener("click", () => {
        const nowHidden = el.miniSearch.classList.toggle("hidden");
        el.headerSearchBtn.classList.toggle("active", !nowHidden);
        if (!nowHidden) { el.miniSearch.value = el.urlInput ? el.urlInput.value : ""; setTimeout(() => el.miniSearch.focus(), 30); }
    });
    if (el.miniSearch) el.miniSearch.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { if (el.urlInput) el.urlInput.value = el.miniSearch.value; _vpnGuardBeforeOnline(); handleMainInput(); }
        else if (e.key === "Escape") _closeMini();
    });
    if (el.headerLibraryBtn) el.headerLibraryBtn.addEventListener("click", () => {
        const target = document.querySelector("#library-list .cat-group") || el.libraryList;
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    if (el.headerFavoritesBtn) el.headerFavoritesBtn.addEventListener("click", () => {
        const target = document.querySelector("#library-list .fav-block") || el.libraryList;
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    if (el.headerDownloadsBtn) el.headerDownloadsBtn.addEventListener("click", () => {
        refreshDownloads();
        if (el.downloadsList) el.downloadsList.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    // Le icone di navigazione in cima sono SEMPRE visibili (non solo scorrendo).
    [el.headerSearchBtn, el.headerFavoritesBtn, el.headerLibraryBtn, el.headerDownloadsBtn]
        .forEach(b => { if (b) b.classList.remove("hidden"); });
    if (el.prevTitleBtn) el.prevTitleBtn.addEventListener("click", () => navigatePlayback(-1));
    if (el.nextTitleBtn) el.nextTitleBtn.addEventListener("click", () => navigatePlayback(1));
    const logo = document.querySelector(".logo-container");
    if (logo) {
        logo.style.cursor = "pointer";
        logo.title = "Ricarica SC Portal";
        logo.addEventListener("click", () => location.reload());
    }
    if (el.librarySearch) el.librarySearch.addEventListener("input", () => {
        librarySearch = el.librarySearch.value;
        if (lastLibraryData) renderLibrary(lastLibraryData);
    });
    if (el.libraryType) el.libraryType.addEventListener("change", () => {
        librarySearchType = el.libraryType.value;
        if (lastLibraryData) renderLibrary(lastLibraryData);
    });
    if (el.libraryOrder) el.libraryOrder.addEventListener("change", () => {
        librarySearchOrder = el.libraryOrder.value;
        if (lastLibraryData) renderLibrary(lastLibraryData);
    });
    if (el.saveLibraryBtn) el.saveLibraryBtn.addEventListener("click", saveAll);
    if (el.searchSort) el.searchSort.addEventListener("change", rerunSearchIfAny);
    if (el.searchGenre) el.searchGenre.addEventListener("change", rerunSearchIfAny);
    if (el.searchType) el.searchType.addEventListener("change", rerunSearchIfAny);
    if (el.srcSc) el.srcSc.addEventListener("change", rerunSearchIfAny);
    if (el.srcAw) el.srcAw.addEventListener("change", rerunSearchIfAny);
    var _dismissPrivacy = function () {
        _proxyWarned = true;   // solo per questa sessione: riappare al prossimo avvio
        if (el.privacyBanner) el.privacyBanner.classList.add("hidden");
    };
    if (el.privacyDismiss) el.privacyDismiss.addEventListener("click", _dismissPrivacy);
    if (el.privacyVpnOk) el.privacyVpnOk.addEventListener("click", _dismissPrivacy);
    if (el.privacyCheckIp) el.privacyCheckIp.addEventListener("click", checkEgressIp);
    _setupPwa();
    _ensureServerUp();
    refreshProxyState();
    startRemoteHost();
    setupCastLock();
    document.addEventListener("fullscreenchange", _syncCinema);
    document.addEventListener("webkitfullscreenchange", _syncCinema);
    if (el.remoteBtn) el.remoteBtn.addEventListener("click", openRemoteQr);
    // Vista "solo download" per telefono/tablet (aperta dal QR): mostra soltanto
    // la sezione "I tuoi download" e carica i file gia' scaricati.
    try {
        if (new URLSearchParams(location.search).get("view") === "downloads") {
            document.body.classList.add("downloads-only");
            if (typeof refreshDownloads === "function") refreshDownloads();
            setupMobileDownloadsUX();
            setTimeout(renderContinueWatching, 800);
        }
    } catch (e) {}
    if (el.searchClear) el.searchClear.addEventListener("click", clearSearch);
    if (el.urlInput) el.urlInput.addEventListener("input", toggleClearBtn);
    toggleClearBtn();

    try {
        const mc = document.querySelector(".main-container");
        if (mc && el.searchResultsSection) mc.insertBefore(el.searchResultsSection, mc.firstChild);
        const cs = document.getElementById("continue-section"), ls = document.getElementById("library-section");
        if (cs && ls && ls.parentNode) ls.parentNode.insertBefore(cs, ls);
    } catch (e) {}
    startDownloadsPolling();
    setupPlayerGestures();
    setupDragScroll();
    setTimeout(openWelcomeBanner, 500);

    // Load the saved/recent titles library and the remembered domains
    fetchLibrary();
    fetchDomains();
    fetchSourceDomains();
    setupCollapsibles();
    refreshLocalDownloads();
    if (el.videoPlayer) el.videoPlayer.addEventListener("timeupdate", checkNextBanner);
    if (el.videoPlayer) el.videoPlayer.addEventListener("ended", () => {
        const nx = currentNextItem();
        if (nx && getPlayableId(nx)) navigatePlayback(1);
    });
}

async function updateSettings() {
    const domain = el.domainInput.value.trim();
    if (!domain) return;
    
    try {
        const resp = await fetch("/api/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ domain })
        });
        if (resp.ok) {
            showToast("Dominio StreamingCommunity salvato!");
            fetchDomains();
        } else {
            showToast("Errore durante il salvataggio");
        }
    } catch (e) {
        showToast("Errore di connessione");
    }
}

async function updateProxy() {
    const domain = el.domainInput.value.trim();
    const proxy = el.proxyInput.value.trim();
    try {
        const resp = await fetch("/api/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ domain, proxy })
        });
        if (resp.ok) {
            showToast(proxy ? "Proxy salvato e attivo!" : "Proxy disattivato (connessione diretta)");
        } else {
            showToast("Errore durante il salvataggio del proxy");
        }
    } catch (e) {
        showToast("Errore di connessione");
    }
}

// --- Dynamic domain handling ---------------------------------------------
// StreamingCommunity domains get seized/parked frequently. When a native call
// fails with a 503 domain_error, we offer to auto-find the new live domain.

// Returns true if the response was a dead-domain error and was handled here.
async function checkDomainError(resp) {
    if (!resp || resp.status !== 503) return false;
    let detail = {};
    try { detail = (await resp.clone().json()).detail || {}; } catch (e) {}
    if (!detail.domain_error) return false;
    await promptDomainRefresh(detail.message);
    return true;
}

async function promptDomainRefresh(message) {
    const base = message || "Il dominio StreamingCommunity non è più attivo.";
    const titled = lastTitleContext
        ? `"${lastTitleContext}" non è raggiungibile: il suo dominio non è più attivo.\n\n${base}`
        : base;
    const ok = confirm(titled +
        "\n\nVuoi che cerchi automaticamente il nuovo dominio attivo adesso?");
    if (!ok) {
        showToast("Suggerimento: incolla un link con un dominio funzionante e verrà impostato in automatico.", 6000);
        return;
    }
    await runDomainRefresh(true);
}

async function manualRefreshDomain() {
    await runDomainRefresh(false);
}

async function runDomainRefresh(retryHint) {
    showToast("Ricerca del dominio attivo in corso… (può richiedere qualche secondo)", 8000);
    try {
        const r = await fetch("/api/domain/refresh", { method: "POST" });
        const data = await r.json();
        if (data.found) {
            if (el.domainInput) el.domainInput.value = data.domain;
            fetchDomains();
            showToast(`Dominio aggiornato: ${data.domain}.` +
                (retryHint ? " Riprova l'operazione." : ""), 5000);
        } else {
            showToast("Nessun dominio attivo trovato. Incolla un link funzionante per impostarlo manualmente.", 7000);
        }
    } catch (e) {
        showToast("Errore durante l'aggiornamento del dominio.");
    }
}

function looksLikeUrl(value) {
    return /^https?:\/\//i.test(value) || /^(www\.|streamingcommunity|v\.vidxgo|[^@\s]+\.(m3u8|mp4|ts)(\?|$))/i.test(value);
}

async function handleMainInput() {
    const value = el.urlInput.value.trim();
    if (!value) return;
    _vpnGuardBeforeOnline();
    if (looksLikeUrl(value)) {
        await resolveDirectUrl(value);
    } else if (value.includes(";")) {
        await searchList(value);
    } else {
        await searchCatalog(value);
    }
}

async function searchCatalog(query) {
    showToast("Ricerca in corso...");
    const _li = document.getElementById("search-listinfo"); if (_li) _li.remove();
    if (el.searchResultsSection) el.searchResultsSection.classList.remove("hidden");
    if (el.searchResultsTitle) el.searchResultsTitle.textContent = `Risultati per "${query}"`;
    if (el.searchResults) {
        el.searchResults.innerHTML = '<div class="empty-state">Ricerca nel catalogo...</div>';
    }
    try {
        const params = new URLSearchParams({ q: query });
        if (el.searchSort && el.searchSort.value) params.set("sort", el.searchSort.value);
        if (el.searchGenre && el.searchGenre.value) params.set("genre", el.searchGenre.value);
        if (el.searchType && el.searchType.value) params.set("type", el.searchType.value);
        const srcs = [];
        if (!el.srcSc || el.srcSc.checked) srcs.push("sc");
        if (el.srcAw && el.srcAw.checked) srcs.push("aw");
        if (!srcs.length) srcs.push("sc");
        params.set("sources", srcs.join(","));
        const resp = await fetch(`/api/search?${params.toString()}`);
        if (!resp.ok) {
            if (await checkDomainError(resp)) return;
            showToast("Nessun risultato o ricerca non disponibile");
            if (el.searchResults) el.searchResults.innerHTML = '<div class="empty-state">Nessun risultato trovato.</div>';
            return;
        }
        const results = await resp.json();
        renderSearchResults(results, query);
    } catch (e) {
        showToast("Errore durante la ricerca");
        if (el.searchResults) el.searchResults.innerHTML = '<div class="empty-state">Errore durante la ricerca.</div>';
    }
}

function rerunSearchIfAny() {
    const value = el.urlInput.value.trim();
    if (value && !looksLikeUrl(value) && !value.includes(";")) searchCatalog(value);
}

// --- Ricerca a LISTA: titoli separati da ";" (saghe/collezioni dall'AI) ---
async function searchList(query) {
    const terms = query.split(";").map(t => t.trim()).filter(Boolean);
    if (!terms.length) return;
    showToast(`Ricerca lista: ${terms.length} titoli...`);
    if (el.searchResultsSection) el.searchResultsSection.classList.remove("hidden");
    if (el.searchResultsTitle) el.searchResultsTitle.textContent = `Lista: ${terms.length} titoli`;
    if (el.searchResults) el.searchResults.innerHTML = '<div class="empty-state">Cerco i titoli della lista...</div>';
    try {
        const resp = await fetch(`/api/search/list?q=${encodeURIComponent(query)}`);
        if (!resp.ok) { if (await checkDomainError(resp)) return; showToast("Ricerca lista non disponibile"); return; }
        const data = await resp.json();
        const found = (data || []).filter(d => d && d._found && d.id_and_slug);
        const missing = (data || []).filter(d => d && !d._found).map(d => d._term || d.name || "?");
        renderSearchResults(found, `Lista (${found.length}/${terms.length})`);
        // auto-seleziona tutti i titoli trovati: pronti per "Nuova cartella"
        found.forEach(it => { if (it.id_and_slug) searchSel.set(it.id_and_slug, it); });
        renderSearchPage();
        updateSelBar();
        showListBanner(found.length, terms.length, missing);
        if (!found.length) showToast("Nessun titolo della lista trovato");
    } catch (e) { showToast("Errore ricerca lista"); }
}

function showListBanner(found, total, missingNames) {
    const section = el.searchResultsSection; if (!section || !el.searchResults) return;
    let b = document.getElementById("search-listinfo");
    if (!b) { b = document.createElement("div"); b.id = "search-listinfo"; b.className = "list-info"; section.insertBefore(b, el.searchResults); }
    let html = `Lista: trovati <b>${found}</b> su <b>${total}</b>. Sono gia' selezionati: usa <b>Nuova cartella</b> in basso per creare la collezione (o togli le spunte indesiderate).`;
    if (missingNames && missingNames.length) html += `<div class="list-missing">Non trovati: ${missingNames.map(escapeHtml).join(", ")}</div>`;
    b.innerHTML = html;
}

function renderSearchResults(results, query) {
    searchAll = Array.isArray(results) ? results : [];
    searchQ = query || "";
    searchPage = 1;
    searchSel.clear();
    renderSearchPage();
    updateSelBar();
}

function renderSearchPage() {
    if (!el.searchResults) return;
    el.searchResults.innerHTML = "";
    if (!searchAll.length) {
        el.searchResults.innerHTML = '<div class="empty-state">Nessun risultato trovato.</div>';
        renderPager(1, 0);
        return;
    }
    const total = searchAll.length;
    // Scroll orizzontale UNICO: mostra tutti i risultati, niente pagine.
    searchAll.forEach(item => { el.searchResults.appendChild(buildResultCard(item)); });
    if (el.searchResultsTitle) el.searchResultsTitle.textContent = `Risultati per "${searchQ}" — ${total} titoli`;
    renderPager(1, total);
}

function buildResultCard(item) {
    const card = document.createElement("div");
    card.className = "media-card";
    const selected = item.id_and_slug && searchSel.has(item.id_and_slug);
    if (selected) card.classList.add("selected");
    const type = item.type === "tv" ? "Serie" : (item.type === "movie" ? "Film" : "Titolo");
    const cover = item.cover
        ? `<img class="media-cover" src="${escapeHtml(item.cover)}" alt="" loading="lazy">`
        : `<div class="media-cover"></div>`;
    const score = item.score ? ` · ${escapeHtml(item.score)}` : "";
    const date = item.release_date ? ` · ${escapeHtml(item.release_date)}` : "";
    card.innerHTML = `
        ${cover}
        <label class="media-select" title="Seleziona">
            <input type="checkbox" ${selected ? "checked" : ""}>
        </label>
        <div class="media-actions">
            <button class="icon-btn fav-q-btn" title="Salva nei preferiti">☆</button>
            <button class="icon-btn folder-q-btn" title="Metti in una cartella">📂</button>
            <button class="icon-btn newfolder-q-btn" title="Crea una cartella per questo titolo">📁+</button>
        </div>
        <div class="media-info">
            <span class="media-type">${type}${score}${date}</span>
            <span class="media-title">${escapeHtml(item.name || "Senza titolo")}</span>
        </div>`;
    card.addEventListener("click", (e) => {
        if (e.target.closest(".media-actions") || e.target.closest(".media-select")) return;
        openSearchResult(item);
    });
    const selWrap = card.querySelector(".media-select");
    selWrap.addEventListener("click", (e) => e.stopPropagation());
    const selCb = selWrap.querySelector("input");
    selCb.addEventListener("change", (e) => {
        e.stopPropagation();
        toggleResultSelection(item, card, selCb.checked);
    });
    card.querySelector(".fav-q-btn").addEventListener("click", (e) => { e.stopPropagation(); quickFavoriteSearch(item); });
    card.querySelector(".folder-q-btn").addEventListener("click", (e) => { e.stopPropagation(); quickFolderSearch(item); });
    card.querySelector(".newfolder-q-btn").addEventListener("click", (e) => { e.stopPropagation(); quickNewFolderSearch(item); });
    card.draggable = true;
    card.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("application/json", JSON.stringify({ src: "search", item }));
        e.dataTransfer.effectAllowed = "copy";
    });
    return card;
}

function toggleResultSelection(item, card, on) {
    if (!item.id_and_slug) return;
    if (on) { searchSel.set(item.id_and_slug, item); if (card) card.classList.add("selected"); }
    else { searchSel.delete(item.id_and_slug); if (card) card.classList.remove("selected"); }
    updateSelBar();
}

function renderPager(pages, total) {
    const section = el.searchResultsSection;
    if (!section) return;
    let pager = document.getElementById("search-pager");
    if (pages <= 1) { if (pager) pager.remove(); return; }
    if (!pager) {
        pager = document.createElement("div");
        pager.id = "search-pager";
        pager.className = "pager";
        section.appendChild(pager);
    }
    const nums = new Set([1, pages, searchPage, searchPage - 1, searchPage + 1]);
    const list = [...nums].filter(n => n >= 1 && n <= pages).sort((a, b) => a - b);
    let html = `<button class="pager-btn" data-go="prev" ${searchPage <= 1 ? "disabled" : ""}>‹ Prec</button>`;
    let prev = 0;
    list.forEach(n => {
        if (prev && n - prev > 1) html += `<span class="pager-gap">…</span>`;
        html += `<button class="pager-btn pager-num ${n === searchPage ? "active" : ""}" data-go="${n}">${n}</button>`;
        prev = n;
    });
    html += `<button class="pager-btn" data-go="next" ${searchPage >= pages ? "disabled" : ""}>Succ ›</button>`;
    pager.innerHTML = html;
    pager.querySelectorAll(".pager-btn").forEach(b => b.addEventListener("click", () => {
        const go = b.dataset.go;
        if (go === "prev") searchPage--;
        else if (go === "next") searchPage++;
        else searchPage = parseInt(go, 10);
        renderSearchPage();
        if (section.scrollIntoView) section.scrollIntoView({ behavior: "smooth", block: "start" });
    }));
}

function updateSelBar() {
    let bar = document.getElementById("search-selbar");
    const n = searchSel.size;
    if (!n) { if (bar) bar.remove(); return; }
    if (!bar) {
        bar = document.createElement("div");
        bar.id = "search-selbar";
        bar.className = "selbar";
        document.body.appendChild(bar);
    }
    bar.innerHTML = `
        <span class="selbar-count">${n} selezionati</span>
        <button class="primary-btn selbar-existing">📂 Salva in cartella</button>
        <button class="secondary-btn selbar-new">📁+ Nuova cartella</button>
        <button class="secondary-btn selbar-clear">Deseleziona</button>`;
    bar.querySelector(".selbar-existing").addEventListener("click", () => openBulkFolderPicker([...searchSel.values()]));
    bar.querySelector(".selbar-new").addEventListener("click", () => bulkNewFolder([...searchSel.values()]));
    bar.querySelector(".selbar-clear").addEventListener("click", () => { searchSel.clear(); renderSearchPage(); updateSelBar(); });
}

async function bulkSaveItems(items) {
    // Save every selected search result into the library; return their stable keys.
    const keys = [];
    for (const it of items) {
        if (!it.id_and_slug) continue;
        await addToLibrary(it.url || "", {
            key: it.id_and_slug, name: it.name || "", cover: it.cover || "",
            type: it.type || "", release_date: it.release_date || "", is_clone: !!it.is_clone
        });
        keys.push(it.id_and_slug);
    }
    return keys;
}

async function bulkNewFolder(items) {
    if (!items.length) return;
    const name = prompt(`Nome della nuova cartella per ${items.length} titoli:`, "");
    if (name === null || !name.trim()) return;
    showToast("Salvataggio in corso…");
    const keys = await bulkSaveItems(items);
    try {
        const r = await fetch("/api/folders/create", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: name.trim() })
        });
        if (!r.ok) { showToast("Errore creazione cartella"); return; }
        const data = await r.json();
        const folder = (data.folders || [])[(data.folders || []).length - 1];
        if (folder) {
            await fetch("/api/folders/add-items", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: folder.id, keys })
            });
            openFolders.add(folder.id);
        }
        await fetchLibrary();
        searchSel.clear(); renderSearchPage(); updateSelBar();
        showToast(`Cartella "${name.trim()}" creata con ${keys.length} titoli`);
    } catch (e) { showToast("Errore creazione cartella"); }
}

async function openBulkFolderPicker(items) {
    if (!items.length) return;
    let data;
    try { data = await (await fetch("/api/folders")).json(); }
    catch (e) { showToast("Errore caricamento cartelle"); return; }
    const folders = data.folders || [];
    const overlay = document.createElement("div");
    overlay.className = "picker-overlay";
    const rows = folders.map(f => {
        const kindB = f.kind ? ` <span class="picker-note">${escapeHtml(f.kind)}</span>` : "";
        return `<label class="picker-row">
            <input type="checkbox" data-fid="${f.id}">
            <span>${escapeHtml(f.name || "Cartella")}</span>${kindB}
        </label>`;
    }).join("");
    overlay.innerHTML = `
        <div class="picker-panel glass">
            <h3>Salva ${items.length} titoli nelle cartelle</h3>
            <p class="picker-hint">Spunta una o più cartelle in cui aggiungere i titoli selezionati.</p>
            <input type="text" class="picker-search" placeholder="Cerca una cartella…" autocomplete="off" spellcheck="false">
            <div class="picker-list">${rows || '<div class="no-downloads">Nessuna cartella. Usa "Nuova cartella".</div>'}</div>
            <div class="picker-actions">
                <button class="secondary-btn picker-cancel">Annulla</button>
                <button class="primary-btn picker-confirm">Conferma</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    overlay.querySelector(".picker-cancel").addEventListener("click", close);
    const ps = overlay.querySelector(".picker-search");
    if (ps) ps.addEventListener("input", () => {
        const qq = ps.value.trim().toLowerCase();
        overlay.querySelectorAll(".picker-row").forEach(r => {
            r.style.display = r.textContent.toLowerCase().includes(qq) ? "" : "none";
        });
    });
    overlay.querySelector(".picker-confirm").addEventListener("click", async () => {
        const fids = Array.from(overlay.querySelectorAll('input[type="checkbox"]:checked')).map(c => c.dataset.fid);
        if (!fids.length) { showToast("Seleziona almeno una cartella"); return; }
        showToast("Salvataggio in corso…");
        const keys = await bulkSaveItems(items);
        try {
            for (const fid of fids) {
                await fetch("/api/folders/add-items", {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ id: fid, keys })
                });
                openFolders.add(fid);
            }
            await fetchLibrary();
            searchSel.clear(); renderSearchPage(); updateSelBar();
            showToast(`${keys.length} titoli salvati in ${fids.length} cartella/e`);
        } catch (e) { showToast("Errore salvataggio"); }
        close();
    });
}

function openSearchResult(item) {
    if (!item || !item.id_and_slug) {
        showToast("Risultato non apribile");
        return;
    }
    lastTitleContext = item.name || "";
    if (item.is_clone && item.url) {
        resolveDirectUrl(item.url, item.name || "");
        return;
    }
    loadDetails(item.id_and_slug, item.url || "");
}

// --- Quick actions from search result posters (no need to open the title) ---
async function saveSearchItem(item) {
    // Save the searched title into the library (key = id-slug; backend regenerates
    // the URL from the current domain). Returns true on success.
    if (!item || !item.id_and_slug) { showToast("Titolo non valido"); return false; }
    await addToLibrary(item.url || "", {
        key: item.id_and_slug, name: item.name || "", cover: item.cover || "",
        type: item.type || "", release_date: item.release_date || "", is_clone: !!item.is_clone
    });
    return true;
}

async function quickFavoriteSearch(item) {
    if (!(await saveSearchItem(item))) return;
    const cur = libraryCache.find(e => e.key === item.id_and_slug);
    if (!cur || !cur.favorite) await toggleFavorite(item.id_and_slug);
    showToast(`"${item.name || "Titolo"}" salvato nei preferiti ★`);
}

async function quickFolderSearch(item) {
    if (!(await saveSearchItem(item))) return;
    openTitleFolderPicker({ key: item.id_and_slug, name: item.name || "" });
}

async function quickNewFolderSearch(item) {
    if (!item || !item.id_and_slug) { showToast("Titolo non valido"); return; }
    const name = prompt("Nome della nuova cartella (es. saga):", item.name || "");
    if (name === null) return;
    await saveSearchItem(item);
    try {
        const r = await fetch("/api/folders/create", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name })
        });
        if (!r.ok) { showToast("Errore creazione cartella"); return; }
        const data = await r.json();
        const folder = (data.folders || [])[(data.folders || []).length - 1];
        if (folder) {
            await fetch("/api/folders/toggle", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: folder.id, key: item.id_and_slug })
            });
            openFolders.add(folder.id);
        }
        await fetchLibrary();
        showToast(`Cartella "${name}" creata con "${item.name || "il titolo"}"`);
    } catch (e) { showToast("Errore creazione cartella"); }
}

// 2. Resolve Direct URL
// urlArg/titleName are set when reopening a saved library entry; when called as
// a click handler the first arg is an Event, so we only accept strings.
async function resolveDirectUrl(urlArg, titleName) {
    const url = ((typeof urlArg === "string" ? urlArg : "") || el.urlInput.value).trim();
    if (!url) return;
    lastTitleContext = (typeof titleName === "string") ? titleName : "";

    showToast("Analisi URL in corso...");
    try {
        const resp = await fetch("/api/resolve-url", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url })
        });
        if (resp.ok) {
            const data = await resp.json();
            if (data.is_animeworld) {
                renderAnimeWorld(data, url);
            } else if (data.is_clone) {
                addToLibrary(url, {
                    key: url, name: data.title, cover: data.cover,
                    type: data.is_series ? "tv" : "movie", is_clone: true
                });
                renderCloneDetails(data, url);
            } else {
                loadDetails(data.id_and_slug, url);
            }
            if (typeof urlArg !== "string") el.urlInput.value = "";
        } else {
            if (await checkDomainError(resp)) return;
            showToast("Impossibile risolvere questo link");
        }
    } catch (e) {
        showToast("Errore durante l'analisi dell'URL");
    }
}

async function convertDirectUrl() {
    const url = el.urlInput.value.trim();
    if (!url) return;
    if (!looksLikeUrl(url)) {
        await searchCatalog(url);
        return;
    }
    
    showToast("Analisi URL per download immediato...");
    try {
        const resp = await fetch("/api/resolve-url", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url })
        });
        if (resp.ok) {
            const data = await resp.json();
            el.urlInput.value = "";
            if (data.is_animeworld) { renderAnimeWorld(data, url); return; }
            if (data.is_clone) {
                addToLibrary(url, {
                    key: url, name: data.title, cover: data.cover,
                    type: data.is_series ? "tv" : "movie", is_clone: true
                });
                if (data.is_series) {
                    // Series: open the season/episode picker to choose what to download
                    renderCloneDetails(data, url);
                } else if (data.stream_url) {
                    showToast("Download clone avviato!");
                    currentTitle = {
                        is_clone: true,
                        name: data.title,
                        cover: data.cover,
                        plot: data.plot,
                        iframe_url: data.iframe_url,
                        stream_url: data.stream_url,
                        stream_headers: data.stream_headers || null,
                        vidxgo: data.vidxgo || null,
                        type: "movie",
                        id: data.id_and_slug
                    };
                    triggerDownload(data.title, data.id_and_slug);
                } else {
                    showToast("Download non disponibile per questo link clonato (nessun flusso video diretto estratto)");
                }
            } else {
                addToLibrary(url, { key: data.id_and_slug, name: "", type: "", is_clone: false });
                if (data.episode_id) {
                    var titleId = data.title_id || parseInt(data.id_and_slug.split("-")[0]);
                    triggerDownload("", titleId, data.episode_id);
                } else {
                    loadDetails(data.id_and_slug, url);
                }
            }
        } else {
            if (await checkDomainError(resp)) return;
            showToast("Impossibile risolvere questo link");
        }
    } catch (e) {
        showToast("Errore durante l'analisi dell'URL");
    }
}

async function checkEgressIp() {
    const out = el.privacyIpResult;
    if (out) { out.textContent = "Verifico\u2026"; out.className = "privacy-ip-result"; }
    if (el.privacyCheckIp) el.privacyCheckIp.disabled = true;
    try {
        const r = await fetch("/api/ip-check");
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d.ip) throw new Error(d.detail || "no ip");
        const warp = (d.warp === "on" || d.warp === "plus") ? " \u00b7 WARP attivo" : (d.warp === "off" ? " \u00b7 WARP off" : "");
        const country = d.country ? " (" + d.country + ")" : "";
        const msg = "IP visto dai siti: " + d.ip + country + warp;
        if (out) { out.textContent = "\u2705 " + msg; out.className = "privacy-ip-result ok"; }
        showToast(msg + " \u2014 se e' quello della tua VPN, sei protetto.", 8000);
    } catch (e) {
        if (out) { out.textContent = "\u26a0 Verifica non riuscita"; out.className = "privacy-ip-result err"; }
        showToast("Verifica IP non riuscita (connessione assente?)", 5000);
    } finally {
        if (el.privacyCheckIp) el.privacyCheckIp.disabled = false;
    }
}

function showPrivacyBannerIfNeeded() {
    if (!el.privacyBanner) return;
    // Nessuna persistenza: l'avviso ricompare a OGNI avvio dell'app (a meno che
    // non sia impostato un proxy nel campo dedicato). La chiusura vale solo per
    // la sessione corrente.
    el.privacyBanner.classList.toggle("hidden", proxyConfigured);
}

function refreshProxyState() {
    fetch("/api/settings").then(function (r) { return r.json(); }).then(function (s) {
        proxyConfigured = !!(s && (s.proxy || "").trim());
        showPrivacyBannerIfNeeded();
    }).catch(function () {});
}

function warnNoProxyOnce() {
    if (proxyConfigured || _proxyWarned) return;
    _proxyWarned = true;
    showToast("⚠ Nessun proxy/VPN: il tuo IP e visibile ai siti. Valuta una VPN o imposta un proxy.", 6000);
}

function _lanToken() {
    try {
        var t = new URLSearchParams(location.search).get("t");
        if (t) { try { localStorage.setItem("sc_tok", t); } catch (e) {} return t; }
        var m = document.cookie.match(/(?:^|;\s*)sc_token=([^;]+)/);
        if (m) return decodeURIComponent(m[1]);
        return localStorage.getItem("sc_tok") || "";
    } catch (e) { return ""; }
}

// PWA: manifest col token (per ripartire autenticati dall'app in home) + service worker.
function _setupPwa() {
    try {
        var tok = _lanToken();
        var mf = document.getElementById("mf-link");
        if (mf && tok) mf.href = "/api/pwa/manifest?kind=mobile&t=" + encodeURIComponent(tok);
    } catch (e) {}
    if ("serviceWorker" in navigator) { try { navigator.serviceWorker.register("/sw.js"); } catch (e) {} }
}

// Le app in home cercano SC Portal sulla stessa Wi-Fi: se non risponde, avvisano.
function _showServerOffline(retry) {
    var id = "sc-offline";
    if (document.getElementById(id)) return;
    var o = document.createElement("div");
    o.id = id;
    o.style.cssText = "position:fixed;inset:0;z-index:9999;background:#0a0a10;color:#f2f2f7;" +
        "display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:28px;text-align:center;font-family:system-ui,sans-serif;";
    o.innerHTML = '<img src="/sc-192.png" width="76" height="76" style="border-radius:18px;opacity:.9" alt="">' +
        '<div style="font-size:1.15rem;font-weight:700">SC Portal non raggiungibile</div>' +
        '<div style="color:#8b8ba3;max-width:320px;line-height:1.5">Apri SC Portal sul computer e assicurati che telefono e PC siano sulla stessa rete Wi-Fi.</div>' +
        '<button id="sc-offline-retry" style="margin-top:6px;background:linear-gradient(180deg,#9d7bff,#7c5cff);color:#fff;border:none;border-radius:14px;padding:14px 26px;font-size:1rem;font-weight:600;cursor:pointer">Riprova</button>';
    document.body.appendChild(o);
    o.querySelector("#sc-offline-retry").addEventListener("click", function () { o.remove(); retry(); });
}
function _ensureServerUp() {
    if (!isRemoteDevice()) return;   // sul PC il server c'e' sempre
    fetch("/api/ping", { cache: "no-store" })
        .then(function (r) { if (!r.ok) throw 0; })
        .catch(function () { _showServerOffline(_ensureServerUp); });
}

function isRemoteDevice() {
    return location.hostname !== "localhost" && location.hostname !== "127.0.0.1";
}

// --- TELECOMANDO: il PC fa da "host", il telefono (remote.html) comanda -------
function _remoteNav() {
    const c = playbackCtx;
    if (!c || !c.items || !c.items.length) return { canPrev: false, canNext: false, moreExists: false, moreLabel: "" };
    const prevItem = c.index > 0 ? c.items[c.index - 1] : null;
    const nextItem = c.index < c.items.length - 1 ? c.items[c.index + 1] : null;
    const canPrev = !!(prevItem && getPlayableId(prevItem));
    const canNext = !!(nextItem && getPlayableId(nextItem));
    // esiste un "prossimo" concettuale non ancora scaricato? (episodio successivo di una serie,
    // oppure una voce in coda presente ma senza file locale) -> il telefono avvisa di scaricarlo dal PC
    const moreExists = (!canNext) && (!!c.isEpisode || (!!nextItem && /^\d+-/.test(nextItem.key || "")));
    const moreLabel = (nextItem && nextItem.name) ? nextItem.name : "";
    return { canPrev, canNext, moreExists, moreLabel };
}
let _remoteHost = null;
let _remoteSeq = 0;
function startRemoteHost() {
    if (isRemoteDevice() || _remoteHost) return;   // solo il PC ospita il player
    _remoteHost = setInterval(async () => {
        const v = el.videoPlayer;
        if (!v || !el.playerSection || el.playerSection.classList.contains("hidden")) return;
        try {
            await fetch("/api/remote/state", { method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    title: (currentPlayTitle || _castTitle() || "SC Portal"),
                    playing: !v.paused, time: v.currentTime || 0, duration: v.duration || 0,
                    canPrev: _remoteNav().canPrev,
                    canNext: _remoteNav().canNext,
                    moreExists: _remoteNav().moreExists,
                    moreLabel: _remoteNav().moreLabel,
                    muted: !!v.muted,
                    volume: (typeof v.volume === "number" ? v.volume : 1),
                    rate: (typeof v.playbackRate === "number" ? v.playbackRate : 1)
                }) });
        } catch (e) {}
        try {
            const r = await fetch("/api/remote/cmd?since=" + _remoteSeq, { cache: "no-store" });
            const c = await r.json();
            if (c && c.action && c.seq > _remoteSeq) { _remoteSeq = c.seq; execRemoteCmd(c.action, c.value, c.arg, c.label); }
            else if (c && typeof c.seq === "number") { _remoteSeq = Math.max(_remoteSeq, c.seq); }
        } catch (e) {}
    }, 1000);
}
function execRemoteCmd(action, value, arg, label) {
    const v = el.videoPlayer; if (!v) return;
    if (action === "playId") { try { playDownloaded(arg, label || "SC Portal", null, { inPlace: !!(el.playerSection && !el.playerSection.classList.contains("hidden")) }); } catch (e) {} return; }
    if (action === "play") v.play().catch(() => {});
    else if (action === "pause") v.pause();
    else if (action === "toggle") { v.paused ? v.play().catch(() => {}) : v.pause(); }
    else if (action === "seek") { try { v.currentTime = value || 0; } catch (e) {} }
    else if (action === "seekBy") { try { v.currentTime = Math.max(0, (v.currentTime || 0) + (value || 0)); } catch (e) {} }
    else if (action === "next") { try { navigatePlayback(1); } catch (e) {} }
    else if (action === "prev") { try { navigatePlayback(-1); } catch (e) {} }
    else if (action === "stop") { try { closePlayer(); } catch (e) {} }
    else if (action === "fs") { requestPlayerFullscreen(); }
    else if (action === "mute") { v.muted = !v.muted; }
    else if (action === "volUp") { v.muted = false; try { v.volume = Math.min(1, (v.volume || 0) + 0.1); } catch (e) {} }
    else if (action === "volDown") { try { v.volume = Math.max(0, (v.volume || 0) - 0.1); } catch (e) {} }
    else if (action === "vol") { try { var _vv = Math.max(0, Math.min(1, value || 0)); v.volume = _vv; v.muted = (_vv <= 0); } catch (e) {} }
    else if (action === "rate") { try { v.playbackRate = Math.max(0.25, Math.min(4, value || 1)); } catch (e) {} }
}

function withLanToken(url) {
    // Sul PC (loopback) niente token. Da telefono/tablet (host di rete) accoda il
    // token: serve alla TV per scaricare il video quando trasmetti (casting).
    if (!url || location.hostname === "localhost" || location.hostname === "127.0.0.1") return url;
    var tok = _lanToken();
    if (!tok) return url;
    return url + (url.indexOf("?") >= 0 ? "&" : "?") + "t=" + encodeURIComponent(tok);
}

function playStreamMp4(streamUrl, title) {
    closePlayer();
    currentPlayTitle = title || "";
    if (el.playingTitle) el.playingTitle.textContent = `Riproduzione: ${title || "episodio"}`;
    el.playerSection.classList.remove("hidden");
    if (el.qualityBar) el.qualityBar.classList.remove("hidden");
    setQualityControls(false);
    if (el.iframePlayer) el.iframePlayer.classList.add("hidden");
    el.videoPlayer.classList.remove("hidden");
    el.videoPlayer.src = withLanToken(streamUrl);
    el.videoPlayer.play().catch(() => {});
    currentMediaForCast = { src: streamUrl, hls: false, title: title || "SC Portal" };
    playbackCtx = null;
    updatePlaybackNav();
}

function renderAnimeWorld(data, url) {
    const host = data.host || "www.animeworld.ac";
    const eps = data.episodes || [];
    const overlay = document.createElement("div");
    overlay.className = "picker-overlay";
    const epRows = eps.map(e => `
        <div class="aw-ep" data-epurl="${escapeHtml(e.url)}" data-epid="${escapeHtml(e.id)}">
            <span class="aw-epn">Ep ${escapeHtml(e.num || "")}</span>
            <span class="aw-ep-actions">
                <button class="secondary-btn small-btn aw-play">\u25b6 Riproduci</button>
                <button class="secondary-btn small-btn aw-dl">\u2b07 Scarica</button>
            </span>
        </div>`).join("");
    overlay.innerHTML = `
      <div class="picker-panel glass aw-panel">
        <div class="aw-head">
          ${data.cover ? `<img class="aw-cover" src="${escapeHtml(data.cover)}" alt="">` : ""}
          <div class="aw-head-meta">
            <h3>${escapeHtml(data.title || "AnimeWorld")}</h3>
            <p class="picker-hint">${eps.length} episodi \u00b7 fonte AnimeWorld</p>
            <button class="secondary-btn small-btn aw-save">\u2605 Salva in libreria</button>
          </div>
        </div>
        <input type="text" class="picker-search aw-search" placeholder="Filtra episodi (numero)\u2026" autocomplete="off">
        <div class="picker-list aw-list">${epRows || '<div class="no-downloads">Nessun episodio trovato.</div>'}</div>
        <div class="picker-actions"><button class="secondary-btn picker-cancel">Chiudi</button></div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    overlay.querySelector(".picker-cancel").addEventListener("click", close);
    const save = overlay.querySelector(".aw-save");
    if (save) save.addEventListener("click", () => {
        addToLibrary(url, { key: data.id_and_slug || url, name: data.title, cover: data.cover, type: "tv", is_clone: true });
        showToast("Serie salvata in libreria");
    });
    const sr = overlay.querySelector(".aw-search");
    if (sr) sr.addEventListener("input", () => {
        const q = sr.value.trim().toLowerCase();
        overlay.querySelectorAll(".aw-ep").forEach(r => {
            const n = r.querySelector(".aw-epn");
            r.style.display = (!q || (n && n.textContent.toLowerCase().includes(q))) ? "" : "none";
        });
    });
    overlay.querySelectorAll(".aw-ep").forEach(row => {
        const epurl = row.getAttribute("data-epurl"), epid = row.getAttribute("data-epid");
        const num = row.querySelector(".aw-epn").textContent;
        row.querySelector(".aw-play").addEventListener("click", async () => {
            showToast("Risolvo l'episodio\u2026");
            try {
                const r = await fetch(`/api/animeworld/stream?url=${encodeURIComponent(epurl)}`);
                const d = await r.json().catch(() => ({}));
                if (r.ok && d.stream_url) playStreamMp4(d.stream_url, `${data.title} ${num}`);
                else showToast(d.detail || "Episodio non disponibile");
            } catch (e) { showToast("Errore risoluzione episodio"); }
        });
        row.querySelector(".aw-dl").addEventListener("click", async () => {
            warnNoProxyOnce();
            showToast("Avvio download episodio\u2026");
            try {
                const r = await fetch("/api/animeworld/download", {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        url: epurl,
                        id: epid,
                        host: host,
                        title: `${data.title} ${num}`,
                        lib_key: data.id_and_slug || url,
                        cover: data.cover || ""
                    })
                });
                const d = await r.json().catch(() => ({}));
                showToast(r.ok ? "Download avviato" : (d.detail || "Download non disponibile"));
            } catch (e) { showToast("Errore download"); }
        });
    });
}

function renderCloneDetails(data, libKey) {
    const isSeries = !!data.is_series;
    currentLibKey = libKey || data.id_and_slug || "";
    currentTitle = {
        is_clone: true,
        is_series: isSeries,
        name: data.title,
        cover: data.cover,
        plot: data.plot,
        iframe_url: data.iframe_url,
        stream_url: data.stream_url,
        stream_headers: data.stream_headers || null,
        vidxgo: data.vidxgo || null,
        seasons: data.seasons || [],
        type: isSeries ? "tv" : "movie",
        id: data.id_and_slug,
        genres: [],
        release_date: "",
        score: "",
        runtime: ""
    };

    // Populate modal data
    el.detailTitle.textContent = data.title;
    el.detailCover.src = data.cover ? data.cover : "https://via.placeholder.com/200x300?text=No+Cover";
    el.detailPlot.textContent = data.plot || "Nessuna trama disponibile.";
    el.detailYear.textContent = "N/D";
    el.detailScore.textContent = "★ N/D";
    el.detailRuntime.textContent = "N/D";
    el.detailGenres.innerHTML = "";

    if (isSeries) {
        // Show season/episode picker, hide single movie buttons
        el.movieActions.classList.add("hidden");
        el.seriesContainer.classList.remove("hidden");

        el.seasonSelect.innerHTML = "";
        (data.seasons || []).forEach(s => {
            const opt = document.createElement("option");
            opt.value = s.number;
            opt.textContent = `Stagione ${s.number} (${s.count} ep)`;
            el.seasonSelect.appendChild(opt);
        });

        if ((data.seasons || []).length > 0) {
            el.seasonSelect.value = data.seasons[0].number;
            loadSeasonEpisodes();
        }
    } else {
        // Movie: single download button
        el.movieActions.classList.remove("hidden");
        el.seriesContainer.classList.add("hidden");
        el.downloadMovieBtn.classList.remove("hidden");
    }

    // Show Modal
    el.detailsModal.classList.remove("hidden");
    updateModalStar();
}

// 4. Details
async function loadDetails(idAndSlug, sourceUrl) {
    try {
        const resp = await fetch(`/api/details/${idAndSlug}`);
        if (!resp.ok) {
            if (await checkDomainError(resp)) return;
            showToast("Errore nel caricamento dei dettagli");
            return;
        }

        const details = await resp.json();
        currentTitle = details;

        // Save/refresh this title in the library (history).
        currentLibKey = idAndSlug;
        if (sourceUrl) {
            addToLibrary(sourceUrl, {
                key: idAndSlug, name: details.name, cover: details.cover,
                type: details.type, is_clone: false
            });
        }
        updateModalStar();
        
        // Populate modal data
        el.detailTitle.textContent = details.name;
        el.detailCover.src = details.cover ? details.cover : "https://via.placeholder.com/200x300?text=No+Cover";
        el.detailPlot.textContent = details.plot || "Nessuna trama disponibile.";
        el.detailYear.textContent = details.release_date ? details.release_date.split("-")[0] : "N/D";
        el.detailScore.textContent = details.score ? `★ ${details.score}` : "★ N/D";
        el.detailRuntime.textContent = details.runtime ? `${details.runtime} min` : "N/D";
        
        // Genres
        el.detailGenres.innerHTML = "";
        details.genres.forEach(g => {
            const span = document.createElement("span");
            span.className = "tag";
            span.textContent = g;
            el.detailGenres.appendChild(span);
        });
        
        // Show/Hide Movie vs Series controls
        if (details.type === "movie") {
            el.movieActions.classList.remove("hidden");
            el.seriesContainer.classList.add("hidden");
        } else {
            el.movieActions.classList.add("hidden");
            el.seriesContainer.classList.remove("hidden");
            
            // Populate seasons dropdown
            el.seasonSelect.innerHTML = "";
            details.seasons.forEach(s => {
                const opt = document.createElement("option");
                opt.value = s.number;
                opt.textContent = `Stagione ${s.number} (${s.episodes_count} ep)`;
                el.seasonSelect.appendChild(opt);
            });
            
            if (details.seasons.length > 0) {
                el.seasonSelect.value = details.seasons[0].number;
                loadSeasonEpisodes();
            }
        }
        
        // Show Modal
        el.detailsModal.classList.remove("hidden");
    } catch (e) {
        showToast("Errore caricamento dettagli");
    }
}

async function loadSeasonEpisodes() {
    const season = el.seasonSelect.value;
    if (!season) return;

    el.episodesList.innerHTML = "<p>Caricamento episodi...</p>";

    // Clone (vidxgo) series: fetch episodes from the clone endpoint
    if (currentTitle.is_clone && currentTitle.vidxgo) {
        try {
            const v = currentTitle.vidxgo;
            const url = `/api/clone/episodes?tmdb_tv_id=${v.tmdb_tv_id}&season=${season}` +
                        `&iframe_url=${encodeURIComponent(v.iframe_url)}`;
            const resp = await fetch(url);
            if (resp.ok) {
                const episodes = await resp.json();
                if (!episodes || episodes.length === 0) {
                    // Fallback: build a plain numbered list from the season's episode count
                    const seasonInfo = (currentTitle.seasons || []).find(s => String(s.number) === String(season));
                    const count = seasonInfo ? seasonInfo.count : 0;
                    const list = [];
                    for (let i = 1; i <= count; i++) list.push({ number: i, name: `Episodio ${i}` });
                    renderEpisodes(list);
                } else {
                    renderEpisodes(episodes);
                }
            } else {
                el.episodesList.innerHTML = "<p>Errore nel caricamento degli episodi.</p>";
            }
        } catch (e) {
            el.episodesList.innerHTML = "<p>Errore di connessione.</p>";
        }
        return;
    }

    // Native StreamingCommunity series
    try {
        const resp = await fetch(`/api/details/${currentTitle.id}-${currentTitle.slug}/season/${season}?version=${currentTitle.version}`);
        if (resp.ok) {
            const episodes = await resp.json();
            renderEpisodes(episodes);
        } else {
            if (await checkDomainError(resp)) { el.episodesList.innerHTML = "<p>Dominio non attivo: aggiornalo e riprova.</p>"; return; }
            el.episodesList.innerHTML = "<p>Errore nel caricamento degli episodi.</p>";
        }
    } catch (e) {
        el.episodesList.innerHTML = "<p>Errore di connessione.</p>";
    }
}

function renderEpisodes(episodes) {
    el.episodesList.innerHTML = "";
    const isClone = !!(currentTitle && currentTitle.is_clone);

    // Barra download di massa: stagione intera / serie intera
    const season = el.seasonSelect ? el.seasonSelect.value : "";
    const bulkBar = document.createElement("div");
    bulkBar.className = "bulk-dl-bar";
    const nSeasons = (currentTitle && currentTitle.seasons) ? currentTitle.seasons.length : 0;
    bulkBar.innerHTML =
        '<button class="secondary-btn bulk-season-btn" type="button">⬇ Scarica stagione ' + season + '</button>' +
        (nSeasons > 1 ? '<button class="secondary-btn bulk-series-btn" type="button">⬇ Scarica intera serie (' + nSeasons + ' stagioni)</button>' : '');
    el.episodesList.appendChild(bulkBar);
    bulkBar.querySelector(".bulk-season-btn").addEventListener("click", () => downloadSeason(season, episodes));
    const seriesBtn = bulkBar.querySelector(".bulk-series-btn");
    if (seriesBtn) seriesBtn.addEventListener("click", () => downloadWholeSeries());
    episodes.forEach(ep => {
        const item = document.createElement("div");
        item.className = "episode-item";

        const epTitle = ep.name ? ep.name : `Episodio ${ep.number}`;
        const duration = ep.duration ? `${ep.duration}m` : "";
        const plot = ep.plot ? ep.plot : "Nessuna trama disponibile.";

        const buttons = `<button class="primary-btn download-ep-btn">Scarica</button>`;

        item.innerHTML = `
            <div class="episode-header">
                <div class="episode-title-group">
                    <span class="episode-number">${ep.number}</span>
                    <span class="episode-title">${epTitle}</span>
                </div>
                <span class="episode-dur">${duration}</span>
            </div>
            <p class="episode-plot">${plot}</p>
            <div class="episode-actions">
                ${buttons}
            </div>
        `;

        const season = el.seasonSelect.value;
        const fullEpName = `${currentTitle.name} S${String(season).padStart(2, '0')}E${String(ep.number).padStart(2, '0')}`;

        if (isClone) {
            item.querySelector(".download-ep-btn").addEventListener("click", () => {
                cloneEpisodeDownload(parseInt(season, 10), ep.number, fullEpName);
            });
        } else {
            item.querySelector(".download-ep-btn").addEventListener("click", () => {
                triggerDownload(fullEpName, currentTitle.id, ep.id);
            });
        }

        el.episodesList.appendChild(item);
    });
}

// --- Download di massa: stagione / serie intera ---------------------------
function _epLabel(season, ep) {
    return `${currentTitle.name} S${String(season).padStart(2, '0')}E${String(ep.number).padStart(2, '0')}`;
}

async function _fetchEpisodesForSeason(season) {
    if (currentTitle.is_clone && currentTitle.vidxgo) {
        const v = currentTitle.vidxgo;
        const url = `/api/clone/episodes?tmdb_tv_id=${v.tmdb_tv_id}&season=${season}` +
                    `&iframe_url=${encodeURIComponent(v.iframe_url)}`;
        const resp = await fetch(url);
        if (resp.ok) {
            let eps = await resp.json();
            if (!eps || eps.length === 0) {
                const si = (currentTitle.seasons || []).find(s => String(s.number) === String(season));
                const count = si ? si.count : 0;
                eps = [];
                for (let i = 1; i <= count; i++) eps.push({ number: i, name: `Episodio ${i}` });
            }
            return eps;
        }
        return [];
    }
    const resp = await fetch(`/api/details/${currentTitle.id}-${currentTitle.slug}/season/${season}?version=${currentTitle.version}`);
    return resp.ok ? await resp.json() : [];
}

async function _enqueueEpisode(season, ep, hold) {
    const label = _epLabel(season, ep);
    if (_dupExists(label)) return false;   // gia' presente: salta in silenzio
    if (currentTitle.is_clone) {
        await cloneEpisodeDownload(parseInt(season, 10), ep.number, label, hold);
    } else {
        await triggerDownload(label, currentTitle.id, ep.id, hold);
    }
    return true;
}

async function downloadSeason(season, episodes) {
    let eps = episodes;
    if (!eps || !eps.length) eps = await _fetchEpisodesForSeason(season);
    if (!eps || !eps.length) { showToast("Nessun episodio da scaricare"); return; }
    showToast(`Metto in coda la stagione ${season}...`, 4000);
    let added = 0, skipped = 0;
    for (const ep of eps) {
        try { (await _enqueueEpisode(season, ep, false)) ? added++ : skipped++; } catch (e) {}
        await new Promise(r => setTimeout(r, 400));
    }
    showToast(`Stagione ${season}: ${added} aggiunti${skipped ? `, ${skipped} già presenti` : ""}.`, 5000);
}

async function downloadWholeSeries() {
    const seasons = (currentTitle && currentTitle.seasons) ? currentTitle.seasons : [];
    if (!seasons.length) { showToast("Nessuna stagione trovata"); return; }
    // Una serie intera e' pesante: la PREPARIAMO in coda senza scaricarla subito.
    showToast(`Preparo l'intera serie in coda (${seasons.length} stagioni)...`, 5000);
    let total = 0, skipped = 0;
    for (const s of seasons) {
        const eps = await _fetchEpisodesForSeason(s.number);
        for (const ep of eps) {
            try { (await _enqueueEpisode(s.number, ep, true)) ? total++ : skipped++; } catch (e) {}
            await new Promise(r => setTimeout(r, 250));
        }
    }
    showToast(`Serie: ${total} episodi preparati in coda${skipped ? `, ${skipped} già presenti` : ""}. Avviali da "I tuoi download".`, 7000);
}

// Download a specific episode of a clone (vidxgo) series
async function cloneEpisodeDownload(season, episode, label, hold) {
    if (!currentTitle || !currentTitle.vidxgo) {
        showToast("Dati episodio non disponibili");
        return;
    }
    if (_dupExists(label)) { showToast(`«${label}» è già scaricato o in coda: non lo riscarico.`, 4500); return; }
    showToast(`Preparazione download: ${label}...`);
    try {
        const v = currentTitle.vidxgo;
        const resp = await fetch("/api/clone/download", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                id: v.id,
                iframe_url: v.iframe_url,
                mode: "tv",
                season: season,
                episode: episode,
                title: label,
                lib_key: currentLibKey || currentTitle.id || "",
                cover: currentTitle.cover || "",
                hold: !!hold
            })
        });
        if (resp.ok) {
            showToast("Download episodio avviato in background!");
        } else {
            const err = await resp.json().catch(() => ({}));
            showToast(`Errore: ${err.detail || "impossibile avviare il download"}`, 5000);
        }
    } catch (e) {
        showToast("Errore durante l'avvio del download");
    }
}

function closeModal() {
    el.detailsModal.classList.add("hidden");
}

// 5. Streaming Player ---------------------------------------------------------
let streamReloadAttempts = 0;
let fragErrCount = 0;
let netRetryCount = 0;

function buildHls() {
    return new Hls({
        manifestLoadingMaxRetry: 4, manifestLoadingRetryDelay: 800,
        levelLoadingMaxRetry: 4, levelLoadingRetryDelay: 800,
        fragLoadingMaxRetry: 6, fragLoadingRetryDelay: 800,
        maxBufferLength: 30, maxMaxBufferLength: 90, enableWorker: true,
    });
}

function populateQuality() {
    if (!activeHls || !el.qualitySelect) return;
    const levels = activeHls.levels || [];
    el.qualitySelect.innerHTML = "";
    const auto = document.createElement("option");
    auto.value = "-1"; auto.textContent = "Auto";
    el.qualitySelect.appendChild(auto);
    levels.forEach((lv, i) => {
        const o = document.createElement("option");
        o.value = String(i);
        o.textContent = lv.height ? `${lv.height}p` : `${Math.round((lv.bitrate || 0) / 1000)}k`;
        el.qualitySelect.appendChild(o);
    });
    el.qualitySelect.value = String(activeHls.currentLevel);
    el.qualitySelect.onchange = () => { activeHls.currentLevel = parseInt(el.qualitySelect.value, 10); };
    if (el.qualityBar) el.qualityBar.classList.remove("hidden");
    setQualityControls(true);
}

function populateAudio() {
    if (!activeHls || !el.audioSelect) return;
    const tracks = activeHls.audioTracks || [];
    const show = tracks.length > 1;
    el.audioSelect.classList.toggle("hidden", !show);
    if (el.audioLabel) el.audioLabel.classList.toggle("hidden", !show);
    if (!show) return;
    el.audioSelect.innerHTML = "";
    tracks.forEach((t, i) => {
        const o = document.createElement("option");
        o.value = String(i);
        o.textContent = t.name || t.lang || `Traccia ${i + 1}`;
        el.audioSelect.appendChild(o);
    });
    el.audioSelect.value = String(activeHls.audioTrack);
    el.audioSelect.onchange = () => { activeHls.audioTrack = parseInt(el.audioSelect.value, 10); };
}

function handleHlsError(data, onRefetch) {
    if (!data) return;
    if (!data.fatal) {
        if (data.details === "fragLoadError" || data.details === "keyLoadError" || data.details === "fragParsingError") {
            fragErrCount++;
            if (fragErrCount >= 5 && onRefetch) { fragErrCount = 0; onRefetch(); }
        }
        return;
    }
    if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        if (netRetryCount < 2 && activeHls) { netRetryCount++; try { activeHls.startLoad(); } catch (e) {} }
        else if (onRefetch) { netRetryCount = 0; onRefetch(); }
    } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        try { activeHls.recoverMediaError(); } catch (e) { if (onRefetch) onRefetch(); }
    } else if (onRefetch) {
        onRefetch();
    }
}

// Carica una sorgente HLS con recupero errori. getSrc() rifornisce un master
// "fresco" (token rigenerati) quando lo stream cade per scadenza token o rete,
// e la riproduzione riprende dalla stessa posizione.
function playStream(streamSrc, getSrc, iframeFallback) {
    streamSrc = withLanToken(streamSrc);
    streamReloadAttempts = 0; fragErrCount = 0; netRetryCount = 0;
    currentMediaForCast = { src: streamSrc, hls: true, title: _castTitle() };
    el.videoPlayer.classList.remove("hidden");
    if (el.iframePlayer) el.iframePlayer.classList.add("hidden");

    // Watchdog: se la riproduzione non parte entro ~9s (proxy HLS bloccato),
    // passa automaticamente al player embed ufficiale (che riproduce sempre).
    let _started = false;
    let _watchdog = null;
    const _markStarted = () => { _started = true; if (_watchdog) clearTimeout(_watchdog); };
    el.videoPlayer.addEventListener("playing", _markStarted, { once: true });
    _watchdog = setTimeout(() => {
        if (_started || (el.videoPlayer.currentTime > 0)) return;
        if (el.playerSection.classList.contains("hidden")) return;
        if (iframeFallback) {
            showToast("Lo stream diretto non parte: passo al lettore integrato.");
            if (activeHls) { try { activeHls.destroy(); } catch (e) {} activeHls = null; }
            playIframe(iframeFallback);
        } else {
            showToast("Lo stream non parte. Prova a scaricare il titolo.");
        }
    }, 9000);

    const onRefetch = async () => {
        streamReloadAttempts++;
        if (streamReloadAttempts > 3) {
            if (iframeFallback) { showToast("Passo al lettore alternativo..."); playIframe(iframeFallback); }
            else showToast("Stream interrotto. Riprova tra poco.");
            return;
        }
        const t = el.videoPlayer.currentTime || 0;
        showToast("Riconnessione allo stream...");
        let src = null;
        try { src = getSrc ? withLanToken(await getSrc()) : streamSrc; } catch (e) { src = null; }
        if (!src) { if (iframeFallback) playIframe(iframeFallback); return; }
        if (activeHls) { try { activeHls.destroy(); } catch (e) {} activeHls = null; }
        if (Hls.isSupported()) {
            activeHls = buildHls();
            activeHls.loadSource(src);
            activeHls.attachMedia(el.videoPlayer);
            activeHls.on(Hls.Events.MANIFEST_PARSED, () => {
                try { if (t > 0) el.videoPlayer.currentTime = t; } catch (e) {}
                el.videoPlayer.play().catch(() => {});
                populateQuality(); populateAudio(); _updateCCVisibility();
            });
            activeHls.on(Hls.Events.AUDIO_TRACKS_UPDATED, populateAudio);
            activeHls.on(Hls.Events.ERROR, (e, d) => handleHlsError(d, onRefetch));
        }
    };

    if (Hls.isSupported()) {
        activeHls = buildHls();
        activeHls.loadSource(streamSrc);
        activeHls.attachMedia(el.videoPlayer);
        activeHls.on(Hls.Events.MANIFEST_PARSED, () => {
            streamReloadAttempts = 0;
            el.videoPlayer.play().catch(() => {});
            populateQuality(); populateAudio(); _updateCCVisibility();
        });
        activeHls.on(Hls.Events.AUDIO_TRACKS_UPDATED, populateAudio);
        activeHls.on(Hls.Events.ERROR, (e, d) => handleHlsError(d, onRefetch));
    } else if (el.videoPlayer.canPlayType("application/vnd.apple.mpegurl")) {
        el.videoPlayer.src = streamSrc;
        el.videoPlayer.addEventListener("loadedmetadata", () => el.videoPlayer.play().catch(() => {}), { once: true });
    } else if (iframeFallback) {
        playIframe(iframeFallback);
    } else {
        showToast("Il tuo browser non supporta la riproduzione HLS.");
    }
}

async function startStream(titleId, label, episodeId = null) {
    showToast("Generazione stream in corso...");
    closePlayer();
    _playKey = "sc:" + titleId + (episodeId ? ":" + episodeId : "");

    // Titoli clone: lo stream e' gia' risolto sull'oggetto title.
    if (currentTitle && currentTitle.is_clone && currentTitle.id === titleId) {
        el.playingTitle.textContent = `Riproduzione: ${label}`;
        el.playerSection.classList.remove("hidden");
        el.playerSection.scrollIntoView({ behavior: "smooth" });
        if (currentTitle.stream_url) {
            playStream(currentTitle.stream_url, async () => currentTitle.stream_url, currentTitle.iframe_url || null);
        } else if (currentTitle.iframe_url) {
            playIframe(currentTitle.iframe_url);
        } else {
            showToast("Video non disponibile");
        }
        return;
    }

    let url = `/api/stream/url?id=${titleId}`;
    if (episodeId) url += `&episode_id=${episodeId}`;

    try {
        const resp = await fetch(url);
        if (!resp.ok) {
            if (await checkDomainError(resp)) return;
            showToast("Video non disponibile");
            return;
        }
        const data = await resp.json();
        el.playingTitle.textContent = `Riproduzione: ${label}`;
        el.playerSection.classList.remove("hidden");
        el.playerSection.scrollIntoView({ behavior: "smooth" });

        if (!data.master_url) { showToast("Stream non disponibile"); return; }
        // getSrc rifetcha lo stesso endpoint -> master fresco con token nuovi
        const getSrc = async () => {
            try { const r = await fetch(url); if (!r.ok) return null; const d = await r.json(); return d.master_url || null; }
            catch (e) { return null; }
        };
        playStream(data.master_url, getSrc, data.iframe_url || null);
    } catch (e) {
        showToast("Errore durante la configurazione dello streaming");
    }
}

function playIframe(url) {
    el.videoPlayer.classList.add("hidden");
    if (el.iframePlayer) {
        el.iframePlayer.classList.remove("hidden");
        el.iframePlayer.src = url;
    }
}

function closePlayer() {
    if (activeHls) { try { activeHls.destroy(); } catch (e) {} activeHls = null; }
    el.videoPlayer.pause();
    el.videoPlayer.src = "";
    if (_deviceBlobUrl) { try { URL.revokeObjectURL(_deviceBlobUrl); } catch (e) {} _deviceBlobUrl = null; }
    el.videoPlayer.classList.remove("hidden");
    if (el.iframePlayer) { el.iframePlayer.src = ""; el.iframePlayer.classList.add("hidden"); }
    if (el.audioSelect) el.audioSelect.classList.add("hidden");
    if (el.audioLabel) el.audioLabel.classList.add("hidden");
    streamReloadAttempts = 0; fragErrCount = 0; netRetryCount = 0;
    playbackCtx = null;
    hideNextBanner();
    _bannerDismissed = false; _bannerReshown = false;
    if (el.prevTitleBtn) el.prevTitleBtn.classList.add("hidden");
    if (el.nextTitleBtn) el.nextTitleBtn.classList.add("hidden");
    if (el.ccBtn) { el.ccBtn.classList.add("hidden"); el.ccBtn.classList.remove("cc-on"); }
    el.playerSection.classList.add("hidden");
}

// 6. Downloads Triggering
// Anti-duplicati: un titolo e' "gia' presente" se e' un file locale scaricato
// oppure se e' gia' in lista download (in corso/coda/pausa/pronto/completato).
function _dupExists(title) {
    const n = normName(title || "");
    if (!n) return false;
    if (localByName && localByName[n]) return true;
    const busy = ["pending", "queued", "downloading", "merging", "paused", "held", "completed"];
    return (_downloadsSnapshot || []).some(d => normName(d.title || "") === n && busy.includes(d.status));
}

async function triggerDownload(label, titleId, episodeId = null, hold = false) {
    _vpnGuardBeforeOnline();
    if (_dupExists(label)) { showToast(`«${label}» è già scaricato o in coda: non lo riscarico.`, 4500); return; }
    warnNoProxyOnce();
    showToast("Preparazione download...");
    
    if (currentTitle && currentTitle.is_clone && currentTitle.id === titleId) {
        if (!currentTitle.stream_url) {
            showToast("Download automatico non disponibile per questo link. Copia l'URL .m3u8/.mp4 da Strumenti Sviluppatori (F12 > Rete) e incollalo sopra.", 6000);
            return;
        }
        
        try {
            const payload = {
                title: label || currentTitle.name || "Video",
                m3u8_video: currentTitle.stream_url,
                m3u8_audio: null,
                key_info: null,
                stream_headers: currentTitle.stream_headers || null,
                vidxgo: currentTitle.vidxgo || null,
                lib_key: currentLibKey || currentTitle.id || "",
                cover: currentTitle.cover || "",
                hold: !!hold
            };
            
            const dlResp = await fetch("/api/download", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            
            if (dlResp.ok) {
                showToast("Download avviato in background!");
            } else {
                showToast("Errore nell'avviare il download");
            }
        } catch (e) {
            showToast("Errore durante l'avvio del download");
        }
        return;
    }
    
    let url = `/api/stream/url?id=${titleId}`;
    if (episodeId) {
        url += `&episode_id=${episodeId}`;
    }
    
    try {
        const streamResp = await fetch(url);
        if (!streamResp.ok) {
            var _detail = "";
            try { _detail = ((await streamResp.clone().json()) || {}).detail || ""; } catch (e) {}
            if (await checkDomainError(streamResp)) return;
            showToast("Impossibile scaricare: " + (_detail || "video non disponibile") + " (codice " + streamResp.status + ")", 9000);
            return;
        }
        const data = await streamResp.json();
        const finalTitle = label || data.title || "Video";

        if (data.download && data.download.video_url) {
            const payload = {
                title: finalTitle,
                m3u8_video: data.download.video_url,
                m3u8_audio: data.download.audio_url || null,
                key_info: null,
                stream_headers: data.download.headers || null,
                sc_id: titleId,
                episode_id: episodeId || null,
                lib_key: currentLibKey || "",
                cover: (currentTitle && currentTitle.cover) || "",
                hold: !!hold,
                subtitles: (data.download && data.download.subtitles) || null
            };
            const dlResp = await fetch("/api/download", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            if (dlResp.ok) {
                showToast("Download avviato in background!");
            } else {
                showToast("Errore nell'avviare il download");
            }
            return;
        }
        
        // Legacy fallback for old Vixcloud embeds that still expose per-quality tokens.
        const bestQuality = data.qualities[0] || "720p";
        const tokenQualityKey = `token${bestQuality}`;
        const renderToken = data.params[tokenQualityKey];
        if (!renderToken) {
            showToast("Impossibile preparare la playlist video: token non disponibile");
            return;
        }
        
        const payload = {
            title: finalTitle,
            m3u8_video: `https://vixcloud.co/playlist/${data.video_id}?type=video&rendition=${bestQuality}&token=${renderToken}&expires=${data.params.expires}`,
            m3u8_audio: `https://vixcloud.co/playlist/${data.video_id}?token=${data.params.token}&${tokenQualityKey}=${renderToken}&expires=${data.params.expires}`,
            key_info: {
                key_url: "https://vixcloud.co/storage/enc.key",
                referer: `https://vixcloud.co/embed/${data.video_id}?token=${renderToken}&referer=1&expires=${data.params.expires}`
            },
            lib_key: currentLibKey || "",
            cover: (currentTitle && currentTitle.cover) || "",
            hold: !!hold
        };
        
        const dlResp = await fetch("/api/download", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        
        if (dlResp.ok) {
            showToast("Download avviato in background!");
        } else {
            showToast("Errore nell'avviare il download");
        }
    } catch (e) {
        showToast("Errore durante l'avvio del download");
    }
}

// 7. Polling Downloads Status
function setupPlayerGestures() {
    const v = el.videoPlayer;
    if (!v || !("ontouchstart" in window)) return;
    let lastT = 0;
    v.addEventListener("touchend", (e) => {
        if (!e.changedTouches || !e.changedTouches.length) return;
        const now = Date.now();
        const rect = v.getBoundingClientRect();
        const x = e.changedTouches[0].clientX - rect.left;
        const frac = x / (rect.width || 1);
        if (now - lastT < 320) {   // doppio tap
            if (frac < 0.35) { try { v.currentTime = Math.max(0, (v.currentTime || 0) - 10); } catch (e2) {} showToast("⏪ −10s"); }
            else if (frac > 0.65) { try { v.currentTime = (v.currentTime || 0) + 10; } catch (e2) {} showToast("⏩ +10s"); }
            else { v.paused ? v.play().catch(() => {}) : v.pause(); }
            lastT = 0;
            e.preventDefault();
        } else { lastT = now; }
    }, { passive: false });
}

function startDownloadsPolling() {
    setInterval(async () => {
        try {
            const resp = await fetch("/api/download/status");
            if (resp.ok) {
                const list = await resp.json();
                renderDownloads(list);
                carouselizeDownloads();
                renderContinueWatching();
                renderMobileTitles();
                applyDownloadFilter();
            }
        } catch (e) {
            console.error("Error polling downloads:", e);
        }
    }, 2000);
}

function formatDuration(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60), s = sec % 60;
    if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
    const h = Math.floor(m / 60), mm = m % 60;
    return mm ? `${h}h ${mm}m` : `${h}h`;
}

function formatBytes(bytes) {
    if (!bytes) return "";
    const units = ["B", "KB", "MB", "GB"];
    let i = 0, v = bytes;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function renderDownloads(downloads) {
    if (Array.isArray(downloads)) _downloadsSnapshot = downloads;
    downloadedKeys = new Set();
    downloadByKey = {};
    downloads.forEach(d => { if (d.status === "completed" && d.key) { downloadedKeys.add(d.key); downloadByKey[d.key] = d.id; } });
    const activeTitles = new Set(downloads.map(d => (d.title || "").toLowerCase()));
    const extra = (localDownloads || []).filter(l => !activeTitles.has((l.title || "").toLowerCase()));
    if (downloads.length === 0 && extra.length === 0) {
        el.downloadsList.innerHTML = '<div class="no-downloads">Nessun download. Usa 🔄 Aggiorna per mostrare i titoli già presenti in /downloads.</div>';
        return;
    }

    const allRows = [...downloads].reverse().concat(extra);
    // Anti-flicker: firma calcolata sul CONTENUTO REALE (id/stato/progresso/cover).
    // Ricostruiamo il DOM solo se e' cambiato qualcosa; da fermo le locandine non
    // vengono ricreate ogni 2s (niente "pulsare"). Poiche' la firma riflette
    // esattamente cio' che si vede, non puo' "perdere" le locandine.
    const _contentSig = JSON.stringify(allRows.map(d => [d.id, d.status, d.progress, d.cover || "", d.title || ""]));
    if (_contentSig === _dlSig && el.downloadsList.children.length) return;
    _dlSig = _contentSig;

    const isActiveRow = (dl) => ["pending", "queued", "downloading", "merging", "paused", "held"].includes(dl.status);
    const isRunning = (dl) => ["pending", "queued", "downloading", "merging"].includes(dl.status);

    el.downloadsList.innerHTML = "";
    const buildDownloadItem = (dl, full = false) => {
        const item = document.createElement("div");
        item.dataset.dlid = dl.id;
        if (dl.status === "completed" && typeof _isWatched === "function" && _isWatched(dl.id)) item.classList.add("dl-watched");
        const isActive = isActiveRow(dl);
        // Dentro le cartelle (full) mostriamo la riga completa (locandina + nome +
        // azioni rapide); solo in cima resta la griglia a sole locandine.
        const posterOnly = dl.status === "completed" && !full;
        item.className = `download-item state-${dl.status}${posterOnly ? " poster-only" : ""}`;

        let statusText = dl.status;
        if (dl.status === "pending") statusText = "In attesa…";
        else if (dl.status === "queued") statusText = "In coda…";
        else if (dl.status === "downloading") statusText = `Scaricamento ${dl.progress}%` + (dl.eta != null ? ` · ~${formatDuration(dl.eta)} rimanenti` : "");
        else if (dl.status === "merging") statusText = "Unione tracce (FFmpeg)…";
        else if (dl.status === "completed") statusText = "Completato" + (dl.size ? ` · ${formatBytes(dl.size)}` : "") + (dl.elapsed != null ? ` · in ${formatDuration(dl.elapsed)}` : "");
        else if (dl.status === "failed") statusText = `Fallito: ${dl.error || "errore sconosciuto"}`;
        else if (dl.status === "cancelled") statusText = "Annullato";
        else if (dl.status === "paused") statusText = `In pausa · ${dl.progress || 0}%`;
        else if (dl.status === "held") statusText = "Pronto in coda (non avviato)";

        const showBar = isRunning(dl) || dl.status === "paused";

        // "Scarica/Prepara il seguente" disponibile anche mentre un titolo e' in
        // download/coda: da un titolo NON completato il successivo viene PREPARATO
        // in coda (held), cosi' non parte finche' non lo avvii tu.
        const nextInfo = nextTitleForDownload(dl);
        const nextHold = dl.status !== "completed";
        const nextLabel = nextHold ? "Prepara il seguente" : "Scarica il seguente";
        let nextBtn = "";
        if (nextInfo && !nextInfo.playId) {
            if (nextInfo.isEpisode && nextInfo.series) nextBtn = `<button class="secondary-btn small-btn dl-next-btn" title="${nextLabel}">${nextLabel}</button>`;
            else if (!nextInfo.isEpisode && /^\d+-/.test(nextInfo.key || "")) nextBtn = `<button class="secondary-btn small-btn dl-next-btn" title="${escapeHtml(nextInfo.name || "")}">${nextLabel}</button>`;
        }
        const actions = dl.status === "completed"
            ? `<div class="download-actions">
                   <button class="primary-btn small-btn play-file-btn">
                       <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M8 5v14l11-7z"/></svg> Riproduci
                   </button>
                   <button class="secondary-btn small-btn save-file-btn" title="Salva sul telefono/tablet per guardarlo offline anche fuori casa">
                       <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> Salva
                   </button>
                   ${nextBtn}
                   <button class="secondary-btn small-btn open-card-btn" title="Apri la scheda del titolo">Scheda</button>
                   <button class="secondary-btn small-btn reveal-file-btn">
                       <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg> Cartella
                   </button>
               </div>`
            : isRunning(dl)
            ? `<div class="download-actions">
                   <button class="secondary-btn small-btn pause-dl-btn" title="Metti in pausa (riprende da qui)">⏸ Pausa</button>
                   ${nextBtn}
                   <button class="secondary-btn small-btn cancel-dl-btn" title="Interrompi il download">✕ Annulla</button>
               </div>`
            : (dl.status === "paused" || dl.status === "held" || dl.status === "failed")
            ? `<div class="download-actions">
                   <button class="primary-btn small-btn resume-dl-btn">${dl.status === "held" ? "▶ Avvia" : (dl.status === "failed" ? "↻ Riprova" : "▶ Riprendi")}</button>
                   ${nextBtn}
                   <button class="secondary-btn small-btn cancel-dl-btn" title="Rimuovi dalla coda">✕ Rimuovi</button>
               </div>`
            : "";

        const info = libInfoForDownload(dl);
        const coverSrc = (dl && dl.cover) || (info && info.cover) || "";
        const cover = coverSrc
            ? `<img class="library-cover dl-cover" src="${escapeHtml(coverSrc)}" alt="" loading="lazy">`
            : `<div class="library-cover placeholder dl-cover"></div>`;
        const typeBadge = info ? (info.type === "tv" ? "Serie" : (info.type === "movie" ? "Film" : "")) : "";
        const _ep = parseEpisode(dl.title);
        const displayName = _ep ? episodeLabel(dl.title) : ((info && info.name) || dl.title || "");
        item.title = dl.file || dl.title || "";
        item.innerHTML = posterOnly
            ? `${cover}`
            : `
                ${cover}
                <div class="download-meta">
                    <span class="download-name" title="${escapeHtml(dl.file || dl.title || "")}">${escapeHtml(displayName)}</span>
                    <span class="download-status status-${dl.status}">${statusText}${typeBadge ? ` \u00b7 ${typeBadge}` : ""}</span>
                    ${showBar ? `<div class="progress-container"><div class="progress-bar" style="width: ${dl.progress}%"></div></div>` : ""}
                </div>
                ${actions}
            `;

        const _mobile = document.body.classList.contains("downloads-only");
        if (dl.status === "completed") {
            const _openOrPlay = () => { if (_mobile) openMobilePlayChoice(dl); else playDownloaded(dl.id, dl.title, dl.key); };
            item.addEventListener("click", _openOrPlay);
            item.addEventListener("keydown", (e) => {
                if (e.key === "Enter" || e.key === " ") { e.preventDefault(); _openOrPlay(); }
            });
            item.tabIndex = 0;
            item.setAttribute("role", "button");
            item.setAttribute("aria-label", dl.title ? `Riproduci ${dl.title}` : "Riproduci download");
            const pf = item.querySelector(".play-file-btn");
            if (pf) pf.addEventListener("click", (e) => { e.stopPropagation(); playDownloaded(dl.id, dl.title, dl.key); });
            const sf = item.querySelector(".save-file-btn");
            if (sf) sf.addEventListener("click", (e) => { e.stopPropagation(); saveDownloadToDevice(dl.id, dl.file || dl.title); });
            const nb = item.querySelector(".dl-next-btn");
            if (nb) nb.addEventListener("click", (e) => {
                e.stopPropagation();
                if (nextInfo && nextInfo.isEpisode) downloadNextEpisode(nextInfo.series, nextInfo.season, nextInfo.episode);
                else if (nextInfo) downloadTitles([{ key: nextInfo.key, name: nextInfo.name }]);
            });
            // Mobile: per una puntata di una serie, offri "Scarica stagione" (prepara
            // in coda il resto della stagione, avviabile quando vuoi dal telefono).
            const _ep2 = parseEpisode(dl.title);
            if (_mobile && _ep2 && _ep2.series) {
                const acts = item.querySelector(".download-actions");
                if (acts) {
                    const sb = document.createElement("button");
                    sb.className = "secondary-btn small-btn dl-season-btn";
                    sb.textContent = "⬇ Scarica stagione";
                    sb.title = "Prepara in coda il resto della stagione";
                    sb.addEventListener("click", (e) => { e.stopPropagation(); mobileDownloadRestOfSeason(_ep2.series, _ep2.season, _ep2.episode); });
                    acts.appendChild(sb);
                }
            }
            const cardBtn = item.querySelector(".open-card-btn");
            if (cardBtn) cardBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                const inf = libInfoForDownload(dl);
                if (inf && inf.url) openFromLibrary(inf);
                else showToast("Scheda non disponibile per questo titolo");
            });
            const revealBtn = item.querySelector(".reveal-file-btn");
            if (revealBtn) revealBtn.addEventListener("click", (e) => { e.stopPropagation(); revealDownloadFile(dl.id); });
        } else if (isActive) {
            const cbtn = item.querySelector(".cancel-dl-btn");
            if (cbtn) cbtn.addEventListener("click", () => cancelDownload(dl.id));
            const pbtn = item.querySelector(".pause-dl-btn");
            if (pbtn) pbtn.addEventListener("click", () => pauseDownload(dl.id));
            const rbtn = item.querySelector(".resume-dl-btn");
            if (rbtn) rbtn.addEventListener("click", () => resumeDownload(dl.id));
            const nb2 = item.querySelector(".dl-next-btn");
            if (nb2) nb2.addEventListener("click", (e) => {
                e.stopPropagation();
                if (nextInfo && nextInfo.isEpisode) downloadNextEpisode(nextInfo.series, nextInfo.season, nextInfo.episode, nextHold);
                else if (nextInfo) downloadTitles([{ key: nextInfo.key, name: nextInfo.name }], nextHold);
            });
        }

        return item;
    };

    const activeRows = allRows.filter(isActiveRow);
    activeRows.forEach(dl => el.downloadsList.appendChild(buildDownloadItem(dl)));

    const completedRows = allRows.filter(dl => !isActiveRow(dl));
    _renderDownloadPosters(completedRows, buildDownloadItem);
}

// --- Download a LOCANDINE: film diretti, serie -> stagioni -> episodi --------
let _dlView = { level: "root", series: "", season: 0 };
function _dlGroup(rows) {
    const movies = [], series = new Map();
    rows.forEach(dl => {
        const ep = parseEpisode(dl.title);
        if (ep && ep.series) {
            const k = normName(ep.series);
            let s = series.get(k);
            if (!s) { s = { name: ep.series, cover: dl.cover || "", seasons: new Map() }; series.set(k, s); }
            if (!s.cover && dl.cover) s.cover = dl.cover;
            if (!s.seasons.has(ep.season)) s.seasons.set(ep.season, []);
            s.seasons.get(ep.season).push(dl);
        } else movies.push(dl);
    });
    return { movies, series };
}
function _dlPosterTile(name, cover, sub, onClick, badge) {
    const t = document.createElement("div");
    t.className = "download-item dl-poster";
    t.innerHTML =
        (cover ? `<img class="library-cover dl-cover" src="${escapeHtml(cover)}" loading="lazy">` : `<div class="library-cover placeholder dl-cover"></div>`) +
        (badge ? `<span class="dl-poster-badge">${escapeHtml(badge)}</span>` : "") +
        `<div class="download-meta"><span class="download-name">${escapeHtml(name)}</span>${sub ? `<span class="download-status">${escapeHtml(sub)}</span>` : ""}</div>`;
    t.addEventListener("click", onClick);
    return t;
}
function _dlReRender() { _dlSig = ""; renderDownloads(_downloadsSnapshot); }
function _dlBack(label, onClick) {
    const b = document.createElement("button");
    b.className = "secondary-btn small-btn dl-back";
    b.textContent = "‹ " + label;
    b.addEventListener("click", onClick);
    el.downloadsList.appendChild(b);
}
function _renderDownloadPosters(rows, buildDownloadItem) {
    const g = _dlGroup(rows);
    const byEp = (a, b) => { const ea = parseEpisode(a.title), eb = parseEpisode(b.title); return (ea && eb) ? (ea.episode - eb.episode) : 0; };
    const row = document.createElement("div"); row.className = "disney-row dl-poster-row";

    if (_dlView.level !== "root" && !g.series.get(normName(_dlView.series))) _dlView = { level: "root" };

    if (_dlView.level === "root") {
        g.movies.sort((a, b) => (a.title || "").localeCompare(b.title || "")).forEach(dl => row.appendChild(buildDownloadItem(dl)));
        [...g.series.values()].sort((a, b) => a.name.localeCompare(b.name)).forEach(s => {
            const sn = [...s.seasons.keys()].sort((a, b) => a - b);
            const sub = sn.length > 1 ? `${sn.length} stagioni` : `${s.seasons.get(sn[0]).length} episodi`;
            row.appendChild(_dlPosterTile(s.name, s.cover, sub, () => {
                _dlView = (sn.length > 1) ? { level: "series", series: s.name } : { level: "season", series: s.name, season: sn[0] };
                _dlReRender();
            }, "SERIE"));
        });
        if (!row.children.length) { el.downloadsList.appendChild(Object.assign(document.createElement("div"), { className: "no-downloads", textContent: "Nessun download ancora." })); return; }
        el.downloadsList.appendChild(row);
        return;
    }
    const s = g.series.get(normName(_dlView.series));
    if (_dlView.level === "series") {
        _dlBack("Tutti i download", () => { _dlView = { level: "root" }; _dlReRender(); });
        el.downloadsList.appendChild(Object.assign(document.createElement("div"), { className: "dl-crumb-title", textContent: s.name }));
        [...s.seasons.keys()].sort((a, b) => a - b).forEach(sN => {
            row.appendChild(_dlPosterTile("Stagione " + sN, s.cover, s.seasons.get(sN).length + " episodi", () => { _dlView = { level: "season", series: s.name, season: sN }; _dlReRender(); }, "S" + sN));
        });
        el.downloadsList.appendChild(row);
        return;
    }
    // livello stagione: episodi
    const multi = [...s.seasons.keys()].length > 1;
    _dlBack(multi ? s.name : "Tutti i download", () => { _dlView = multi ? { level: "series", series: s.name } : { level: "root" }; _dlReRender(); });
    el.downloadsList.appendChild(Object.assign(document.createElement("div"), { className: "dl-crumb-title", textContent: s.name + " · Stagione " + _dlView.season }));
    (s.seasons.get(_dlView.season) || []).slice().sort(byEp).forEach(dl => row.appendChild(buildDownloadItem(dl, true)));
    el.downloadsList.appendChild(row);
}

// --- "Titoli offline": video salvati DENTRO l'app (IndexedDB), riproducibili
// anche nelle sessioni successive. I metadati stanno in localStorage (lista
// veloce), il blob del video in IndexedDB (caricato solo quando serve). --------
function _mobStore() { try { return JSON.parse(localStorage.getItem("scp_mobile") || "[]"); } catch (e) { return []; } }
function _mobSave(list) { try { localStorage.setItem("scp_mobile", JSON.stringify(list)); } catch (e) {} }

function _idb() {
    return new Promise((res, rej) => {
        const r = indexedDB.open("scp_media", 1);
        r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains("blobs")) r.result.createObjectStore("blobs"); };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
    });
}
async function _idbPut(id, blob) {
    const db = await _idb();
    return new Promise((res, rej) => { const tx = db.transaction("blobs", "readwrite"); tx.objectStore("blobs").put(blob, id); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}
async function _idbGet(id) {
    const db = await _idb();
    return new Promise((res, rej) => { const tx = db.transaction("blobs", "readonly"); const rq = tx.objectStore("blobs").get(id); rq.onsuccess = () => res(rq.result || null); rq.onerror = () => rej(rq.error); });
}
async function _idbDel(id) {
    const db = await _idb();
    return new Promise((res, rej) => { const tx = db.transaction("blobs", "readwrite"); tx.objectStore("blobs").delete(id); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}

async function addMobileTitle(name, cover, blob) {
    const id = "mob:" + Date.now() + ":" + Math.random().toString(36).slice(2, 7);
    try { await _idbPut(id, blob); }
    catch (e) { showToast("Spazio insufficiente sul telefono per salvarlo (memoria dell'app piena).", 7000); return null; }
    const list = _mobStore();
    list.unshift({ id: id, name: (name || "Video").replace(/\.(mp4|mkv|webm|m4v|mov)$/i, ""), cover: cover || "", size: (blob && blob.size) || 0, date: Date.now() });
    _mobSave(list);
    _cwSig = "";
    showToast("Salvato in «Titoli offline» — lo ritrovi anche la prossima volta.", 6000);
    renderMobileTitles(true);
    renderContinueWatching(true);
    return id;
}

async function playMobileTitle(id, name) {
    let blob = null;
    try { blob = await _idbGet(id); } catch (e) {}
    if (!blob) { showToast("File non più disponibile in memoria."); return; }
    _playBlob(blob, name || "Video", "mob:" + id);
}

async function deleteMobileTitle(id, name) {
    if (!confirm(`Eliminare «${name || "questo titolo"}» da Titoli offline?\n\nVerrà cancellato dalla memoria dell'app per liberare spazio.`)) return;
    try { await _idbDel(id); } catch (e) {}
    _mobSave(_mobStore().filter(m => m.id !== id));
    _removeProgress("mob:" + id);
    _cwSig = "";
    showToast("Eliminato da Titoli offline");
    renderMobileTitles(true);
    renderContinueWatching(true);
}

// --- Mobile: "Continua a guardare" + ricerca tra i download -----------------
function _isMobileView() { return document.body.classList.contains("downloads-only"); }

function _removeProgress(key) {
    const s = _progressStore(); if (s[key]) { delete s[key]; _saveProgressStore(s); }
}

function _cwItems() {
    const store = (typeof _progressStore === "function") ? _progressStore() : {};
    const items = [], seen = new Set();
    const add = (o) => { const k = normName(o.name || ""); if (!k || seen.has(k)) return; seen.add(k); items.push(o); };
    // Download completati (chiave dl:)
    (localFiles || []).forEach(f => {
        const rec = store["dl:" + f.id];
        if (rec && rec.t > 15 && !_isWatched(f.id)) add({ key: "dl:" + f.id, id: f.id, name: f.name, cover: f.cover || "", dlkey: f.key || "", t: rec.t, kind: "pc" });
    });
    // Titoli guardati in streaming (chiave sc:) mappati alla libreria
    Object.keys(store).forEach(k => {
        if (k.indexOf("sc:") !== 0) return;
        const rec = store[k]; if (!(rec && rec.t > 15)) return;
        const tid = k.split(":")[1];
        const item = (libraryCache || []).find(t => String(t.key || "").split("-")[0] === String(tid));
        if (item) add({ key: k, id: item.key, name: item.name, cover: item.cover || "", t: rec.t, kind: "sc", libItem: item });
    });
    // Titoli offline (chiave mob:)
    _mobStore().forEach(m => {
        const rec = store["mob:" + m.id];
        if (rec && rec.t > 15) add({ key: "mob:" + m.id, id: m.id, name: m.name, cover: m.cover || "", t: rec.t, kind: "mob" });
    });
    return items;
}

function _cwRemoveMenu(item) {
    const ex = document.querySelector(".m-sheet-ov"); if (ex) ex.remove();
    const ov = document.createElement("div"); ov.className = "m-sheet-ov";
    let html = '<div class="m-sheet"><div class="m-sheet-title">' + escapeHtml(item.name) + '</div>' +
        '<button class="secondary-btn m-sheet-btn" data-x="list">Rimuovi da «Continua a guardare»</button>';
    if (item.kind === "pc") html += '<button class="secondary-btn m-sheet-btn m-sheet-danger" data-x="delpc">🗑 Elimina il file scaricato</button>';
    if (item.kind === "mob") html += '<button class="secondary-btn m-sheet-btn m-sheet-danger" data-x="delmob">🗑 Elimina da Titoli offline</button>';
    html += '<button class="secondary-btn m-sheet-btn m-sheet-cancel" data-x="close">Annulla</button></div>';
    ov.innerHTML = html; document.body.appendChild(ov);
    const close = () => ov.remove();
    ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
    ov.querySelector('[data-x="list"]').addEventListener("click", () => { close(); _removeProgress(item.key); renderContinueWatching(true); showToast("Rimosso da Continua a guardare"); });
    const dpc = ov.querySelector('[data-x="delpc"]');
    if (dpc) dpc.addEventListener("click", () => { close(); deleteDownload(item.id, item.name); });
    const dmob = ov.querySelector('[data-x="delmob"]');
    if (dmob) dmob.addEventListener("click", () => { close(); deleteMobileTitle(item.id, item.name); });
    ov.querySelector('[data-x="close"]').addEventListener("click", close);
}

function renderContinueWatching(force) {
    if (!document.getElementById("continue-list")) return;
    const items = _cwItems();
    const sig = items.map(i => i.key + ":" + Math.round(i.t)).join("|");
    const sec = document.getElementById("continue-section");
    const box = document.getElementById("continue-list");
    if (!box || !sec) return;
    if (!items.length) { box.innerHTML = ""; sec.classList.remove("has-items"); _cwSig = ""; return; }
    sec.classList.add("has-items");
    // Anti-flicker: ricostruisci SOLO se qualcosa e' cambiato davvero.
    if (!force && sig === _cwSig && box.children.length) return;
    _cwSig = sig;
    box.innerHTML = '<div class="cw-row"></div>';
    const row = box.querySelector(".cw-row");
    items.forEach(item => {
        const card = document.createElement("div");
        card.className = "cw-card";
        const nm = (typeof parseEpisode === "function" && parseEpisode(item.name)) ? episodeLabel(item.name) : (item.name || "");
        card.innerHTML =
            '<span class="cw-x" title="Rimuovi">✕</span>' +
            (item.cover ? `<img src="${escapeHtml(item.cover)}" alt="" loading="lazy">` : `<div class="cw-ph">${item.kind === "mob" ? "📱" : ""}</div>`) +
            `<span class="cw-nm">${escapeHtml(nm)}</span>` +
            `<span class="cw-time">▶ Riprendi da ${_fmtTime(item.t)}</span>`;
        card.querySelector(".cw-x").addEventListener("click", (e) => { e.stopPropagation(); _cwRemoveMenu(item); });
        card.addEventListener("click", () => {
            if (item.kind === "mob") playMobileTitle(item.id, item.name);
            else if (item.kind === "sc") openFromLibrary(item.libItem);
            else playDownloaded(item.id, item.name, item.dlkey);
        });
        row.appendChild(card);
    });
}

function setupMobileDownloadsUX() {
    if (!_isMobileView() || !el.downloadsList) return;
    if (document.getElementById("dl-search-wrap")) return;
    const parent = el.downloadsList.parentNode;
    // Ordine in cima alla vista: ricerca+strumenti, Continua a guardare,
    // Titoli offline, poi la lista "Titoli su PC".
    const wrap = document.createElement("div");
    wrap.id = "dl-search-wrap";
    wrap.innerHTML = '<input type="search" id="dl-search" placeholder="Cerca tra i titoli…" autocomplete="off">' +
        '<div id="dl-tools-row">' +
        '<label id="hide-watched-lbl"><input type="checkbox" id="hide-watched"> Nascondi visti</label>' +
        '<label class="device-open-btn"><input type="file" accept="video/*" id="device-file" hidden>💾 Salva titoli scaricati</label>' +
        '</div>';
    parent.insertBefore(wrap, el.downloadsList);
    wrap.querySelector("#dl-search").addEventListener("input", applyDownloadFilter);
    wrap.querySelector("#hide-watched").addEventListener("change", applyDownloadFilter);
    wrap.querySelector("#device-file").addEventListener("change", async (e) => {
        const fl = e.target.files && e.target.files[0];
        e.target.value = "";
        if (fl) { showToast("Salvo in Titoli offline…", 3000); await addMobileTitle(fl.name, "", fl); }
    });
    renderMobileTitles(true);
}

let _mobSig = "";
function _offCard(m, label) {
    return '<div class="cw-card" data-mid="' + escapeHtml(m.id) + '" data-mname="' + escapeHtml(m.name) + '">' +
        '<span class="cw-x" title="Elimina">✕</span>' +
        (m.cover ? `<img src="${escapeHtml(m.cover)}" alt="" loading="lazy">` : `<div class="cw-ph">📱</div>`) +
        `<span class="cw-nm">${escapeHtml(label)}</span>` +
        `<span class="cw-time">${m.size ? formatBytes(m.size) : "sul telefono"}</span></div>`;
}
function renderMobileTitles(force) {
    const box = document.getElementById("offline-list");
    if (!box) return;
    const list = _mobStore();
    const sig = list.map(m => m.id).join("|");
    if (!list.length) { if (_mobSig !== "" || !box.children.length) box.innerHTML = '<div class="no-downloads">Nessun titolo offline. Salva un download o usa «Salva titoli scaricati».</div>'; _mobSig = ""; return; }
    if (!force && sig === _mobSig && box.querySelector(".off-grp")) return;
    _mobSig = sig;
    // Raggruppa: film a se', episodi divisi per SERIE e poi per STAGIONE, cosi'
    // senza locandina non si fa confusione (niente "Episodio 1" isolato).
    const movies = [], series = {};
    list.forEach(m => {
        const ep = parseEpisode(m.name);
        if (ep && ep.series) {
            const sk = normName(ep.series) || "?";
            const s = series[sk] || (series[sk] = { name: ep.series, seasons: {} });
            (s.seasons[ep.season] || (s.seasons[ep.season] = [])).push({ m: m, ep: ep.episode });
        } else movies.push(m);
    });
    let html = "";
    if (movies.length) {
        html += '<div class="off-grp"><div class="cw-row">' +
            movies.map(m => _offCard(m, m.name)).join("") + '</div></div>';
    }
    Object.keys(series).sort((a, b) => series[a].name.localeCompare(series[b].name, "it")).forEach(sk => {
        const s = series[sk];
        html += '<div class="off-grp off-series"><div class="off-series-name">' + escapeHtml(s.name) + '</div>';
        Object.keys(s.seasons).map(Number).sort((a, b) => a - b).forEach(sn => {
            const eps = s.seasons[sn].slice().sort((a, b) => a.ep - b.ep);
            html += '<div class="off-season">Stagione ' + sn + '</div><div class="cw-row">' +
                eps.map(e => _offCard(e.m, "Ep " + e.ep)).join("") + '</div>';
        });
        html += '</div>';
    });
    box.innerHTML = html;
    box.querySelectorAll(".cw-card").forEach(card => {
        const id = card.getAttribute("data-mid"), nm = card.getAttribute("data-mname");
        card.querySelector(".cw-x").addEventListener("click", (e) => { e.stopPropagation(); deleteMobileTitle(id, nm); });
        card.addEventListener("click", () => playMobileTitle(id, nm));
    });
}

function applyDownloadFilter() {
    const inp = document.getElementById("dl-search");
    const q = (inp ? inp.value : "").trim().toLowerCase();
    const hideW = !!(document.getElementById("hide-watched") || {}).checked;
    document.querySelectorAll("#downloads-list .download-item").forEach(it => {
        const nm = (it.querySelector(".download-name") || {}).textContent || it.title || "";
        const id = it.dataset.dlid || "";
        const isW = hideW && id && typeof _isWatched === "function" && _isWatched(id);
        const okText = !q || nm.toLowerCase().includes(q);
        it.style.display = (okText && !isW) ? "" : "none";
    });
    // Nasconde i gruppi/cartelle rimasti senza elementi visibili
    document.querySelectorAll("#downloads-list .download-folder").forEach(g => {
        const any = [...g.querySelectorAll(".download-item")].some(it => it.style.display !== "none");
        g.style.display = any ? "" : "none";
    });
}

async function cancelDownload(id) {
    if (!confirm("Interrompere questo download? I file parziali verranno eliminati.")) return;
    try {
        const r = await fetch("/api/download/cancel", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id })
        });
        if (r.ok) showToast("Download annullato");
        else showToast("Impossibile annullare il download");
    } catch (e) { showToast("Errore durante l'annullamento"); }
    refreshDownloads();
}

async function pauseDownload(id) {
    try {
        const r = await fetch("/api/download/pause", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id })
        });
        if (r.ok) showToast("Download in pausa");
        else if (r.status === 404) showToast("Funzione non disponibile: chiudi e RIAVVIA SC Portal.");
        else showToast("Impossibile mettere in pausa");
    } catch (e) { showToast("Errore durante la pausa"); }
    refreshDownloads();
}

async function resumeDownload(id) {
    try {
        const r = await fetch("/api/download/resume", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id })
        });
        if (r.ok) showToast("Download ripreso");
        else if (r.status === 404) showToast("Funzione non disponibile: chiudi e RIAVVIA SC Portal.");
        else showToast("Impossibile riprendere");
    } catch (e) { showToast("Errore durante la ripresa"); }
    refreshDownloads();
}

function setQualityControls(show) {
    if (el.qualitySelect) el.qualitySelect.classList.toggle("hidden", !show);
    if (el.qualityLabel) el.qualityLabel.classList.toggle("hidden", !show);
    if (!show) {
        if (el.audioSelect) el.audioSelect.classList.add("hidden");
        if (el.audioLabel) el.audioLabel.classList.add("hidden");
    }
}

// Riproduce un file GIA' scaricato direttamente nel player (file locale: niente
// HLS, niente selettori qualita'/audio). Funziona anche da telefono.
function _isVideoFs() {
    var v = el.videoPlayer;
    return !!(document.fullscreenElement === v || document.webkitFullscreenElement === v || (v && v.webkitDisplayingFullscreen));
}

function requestPlayerFullscreen() {
    // "Cinema": una classe CSS che fa riempire l'intera scheda al contenitore
    // del video. Funziona SEMPRE (anche dal telecomando, che non ha il "gesto
    // utente" richiesto dall'API Fullscreen) ed e' perfetto col mirroring della
    // scheda alla TV. Sul PC proviamo in piu' lo schermo intero reale (col
    // gesto del click funziona), cosi' si nasconde anche la cornice del browser.
    var box = el.videoContainer; if (!box) return;
    var on = !document.body.classList.contains("cinema-on");
    // "cinema": espande l'overlay del player fino a riempire il viewport (funziona
    // sempre, anche dal telecomando senza gesto). Sul PC proviamo in piu' lo
    // schermo intero reale (col clic il gesto c'e') per nascondere la cornice.
    document.body.classList.toggle("cinema-on", on);
    try {
        if (on) {
            var fn = box.requestFullscreen || box.webkitRequestFullscreen;
            if (fn) { var p = fn.call(box); if (p && p.catch) p.catch(function () {}); }
        } else if (document.fullscreenElement || document.webkitFullscreenElement) {
            (document.exitFullscreen || document.webkitExitFullscreen || function () {}).call(document);
        }
    } catch (e) {}
}

function _syncCinema() {
    // Se esco dallo schermo intero reale (es. tasto Esc) tolgo anche la modalita' cinema.
    if (!(document.fullscreenElement || document.webkitFullscreenElement)) {
        document.body.classList.remove("cinema-on");
    }
}

function openMobilePlayChoice(dl) {
    // Chiede all'utente se guardare il file DENTRO SC Portal (senza uscire) o
    // salvarlo sul telefono. Foglio in stile "action sheet" dal basso.
    const ex = document.getElementById("m-sheet-ov");
    if (ex) ex.remove();
    const name = escapeHtml((dl && (dl.title || dl.file)) || "Video");
    const ov = document.createElement("div");
    ov.id = "m-sheet-ov";
    ov.className = "m-sheet-ov";
    const watched = _isWatched(dl.id);
    ov.innerHTML =
        '<div class="m-sheet">' +
        '<div class="m-sheet-title">' + name + '</div>' +
        '<button class="primary-btn m-sheet-btn" data-x="play">▶ Riproduci qui in SC Portal</button>' +
        '<button class="secondary-btn m-sheet-btn" data-x="save">⬇ Salva sul telefono</button>' +
        '<button class="secondary-btn m-sheet-btn" data-x="watch">' + (watched ? "◻ Segna come non visto" : "✓ Segna come visto") + '</button>' +
        '<button class="secondary-btn m-sheet-btn m-sheet-danger" data-x="del">🗑 Elimina dal telefono</button>' +
        '<button class="secondary-btn m-sheet-btn m-sheet-cancel" data-x="close">Annulla</button>' +
        '</div>';
    document.body.appendChild(ov);
    const close = () => ov.remove();
    ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
    ov.querySelector('[data-x="play"]').addEventListener("click", () => { close(); playDownloaded(dl.id, dl.title, dl.key); });
    ov.querySelector('[data-x="save"]').addEventListener("click", () => { close(); saveDownloadToDevice(dl.id, dl.file || dl.title, dl.cover || ""); });
    ov.querySelector('[data-x="watch"]').addEventListener("click", () => { close(); _toggleWatched(dl.id); showToast(_isWatched(dl.id) ? "Segnato come visto" : "Segnato come non visto"); renderContinueWatching(); applyDownloadFilter(); });
    ov.querySelector('[data-x="del"]').addEventListener("click", () => { close(); deleteDownload(dl.id, dl.title); });
    ov.querySelector('[data-x="close"]').addEventListener("click", close);
}

// --- "Visto" (solo lato client, per non lasciare tracce sul server) ---------
function _watchedStore() { try { return JSON.parse(localStorage.getItem("scp_watched") || "{}"); } catch (e) { return {}; } }
function _isWatched(id) { return !!_watchedStore()["dl:" + id]; }
function _toggleWatched(id) {
    const s = _watchedStore();
    if (s["dl:" + id]) delete s["dl:" + id]; else s["dl:" + id] = 1;
    try { localStorage.setItem("scp_watched", JSON.stringify(s)); } catch (e) {}
    _dlSig = ""; _cwSig = "";   // forza un rebuild per aggiornare badge/CW
}

async function deleteDownload(id, title) {
    if (!confirm(`Eliminare «${title || "questo download"}» dal telefono?\n\nIl file verrà cancellato definitivamente per liberare spazio.`)) return;
    try {
        const r = await fetch(withLanToken("/api/download/delete"), {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id })
        });
        if (r.ok) showToast("Download eliminato");
        else if (r.status === 404) showToast("File non trovato (forse già eliminato)");
        else showToast("Impossibile eliminare");
    } catch (e) { showToast("Errore durante l'eliminazione"); }
    _removeProgress("dl:" + id);
    _dlSig = ""; _cwSig = "";
    await refreshLocalDownloads();
    refreshDownloads();
    renderContinueWatching(true);
}

async function mobileDownloadRestOfSeason(series, season, episode) {
    showToast("Preparo il resto della stagione in coda…", 4000);
    let ep = episode, added = 0, guard = 0;
    while (guard++ < 80) {
        let d = {};
        try {
            const r = await fetch("/api/download/next-episode", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ series, season, episode: ep, hold: true })
            });
            d = await r.json().catch(() => ({}));
            if (!r.ok) break;
        } catch (e) { break; }
        added++;
        if (d.season !== season) break;   // arrivati alla stagione successiva: stop
        ep = d.episode;
        await new Promise(r => setTimeout(r, 300));
    }
    showToast(added ? `Stagione: ${added} episodi preparati in coda. Avviali da qui quando vuoi.` : "Nessun altro episodio in questa stagione", 6000);
    refreshDownloads();
}

function _makeBusyOverlay(name) {
    const ov = document.createElement("div");
    ov.className = "save-ov";
    ov.innerHTML =
        '<div class="save-box">' +
        '<div class="save-title">Scaricamento nell\'app…</div>' +
        '<div class="save-name">' + escapeHtml(name) + '</div>' +
        '<div class="save-bar"><div class="save-bar-fill indet"></div></div>' +
        '<div class="save-pct">Attendi, non chiudere l\'app…</div>' +
        '<button class="secondary-btn save-cancel">Annulla</button>' +
        '</div>';
    document.body.appendChild(ov);
    return { cancelBtn: ov.querySelector(".save-cancel"), close() { ov.remove(); } };
}

async function _fetchBlobThen(id, name, cb) {
    // Scarica SENZA bufferizzare a mano in memoria: resp.blob() su WebKit viene
    // appoggiato su DISCO, quindi non fa esaurire la RAM della scheda (era la
    // causa del crash "la pagina si ricarica" al 100%).
    const url = withLanToken("/api/download/play/" + encodeURIComponent(id));
    const ov = _makeBusyOverlay(name);
    const ctrl = new AbortController();
    ov.cancelBtn.onclick = () => ctrl.abort();
    try {
        const resp = await fetch(url, { signal: ctrl.signal });
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        const blob = await resp.blob();
        ov.close();
        await cb(blob);
    } catch (e) {
        ov.close();
        if (e && e.name === "AbortError") showToast("Annullato");
        else showToast("Errore nel salvataggio: " + ((e && e.message) || e), 6000);
    }
}

function _nativeFileDownload(id, name) {
    // Download NATIVO in streaming: il browser scrive su disco senza tenere il
    // file in memoria -> affidabile a QUALSIASI dimensione. Su iPhone finisce nel
    // gestore Download di Safari (icona in alto) e quindi nell'app File.
    const a = document.createElement("a");
    a.href = withLanToken("/api/download/play/" + encodeURIComponent(id) + "?dl=1");
    a.download = name; a.rel = "noopener";
    document.body.appendChild(a); a.click(); a.remove();
    showToast("Download avviato. iPhone: tocca l'icona ⬇ in alto in Safari → lo trovi nell'app File. Non serve la barra qui.", 8000);
}

function saveDownloadToDevice(id, filename, cover) {
    let name = (filename || "video").replace(/[\\/:*?"<>|]+/g, "_");
    if (!/\.(mp4|mkv|webm|m4v)$/i.test(name)) name += ".mp4";
    const ex = document.querySelector(".m-sheet-ov"); if (ex) ex.remove();
    const ov = document.createElement("div"); ov.className = "m-sheet-ov";
    ov.innerHTML =
        '<div class="m-sheet">' +
        '<div class="m-sheet-title">Come vuoi tenerlo?</div>' +
        '<div class="save-name" style="text-align:center">' + escapeHtml(name) + '</div>' +
        '<button class="primary-btn m-sheet-btn" data-x="file">⬇ Scarica come file (consigliato)</button>' +
        '<button class="secondary-btn m-sheet-btn" data-x="share">📤 Salva su File o in Foto…</button>' +
        '<button class="secondary-btn m-sheet-btn" data-x="mob">📱 Salva in «Titoli offline» (nell\'app)</button>' +
        '<button class="secondary-btn m-sheet-btn m-sheet-cancel" data-x="close">Annulla</button>' +
        '</div>';
    document.body.appendChild(ov);
    const close = () => ov.remove();
    ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
    ov.querySelector('[data-x="file"]').addEventListener("click", () => { close(); _nativeFileDownload(id, name); });
    ov.querySelector('[data-x="mob"]').addEventListener("click", () => { close(); _fetchBlobThen(id, name, (blob) => addMobileTitle(name, cover || "", blob)); });
    ov.querySelector('[data-x="share"]').addEventListener("click", () => {
        close();
        _fetchBlobThen(id, name, async (blob) => {
            let file = null;
            try { file = new File([blob], name, { type: blob.type || "video/mp4" }); } catch (e) {}
            if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
                try { await navigator.share({ files: [file], title: name }); showToast("Scegli «Salva su File» o «Salva video».", 6000); }
                catch (e) { if (!e || e.name !== "AbortError") showToast("Condivisione annullata."); }
            } else {
                showToast("Condivisione file non supportata qui: usa «Scarica come file».", 6000);
            }
        });
    });
    ov.querySelector('[data-x="close"]').addEventListener("click", close);
}
function _playBlob(blob, name, key) {
    // Riproduce nel player INTERNO un video da un blob locale (file del telefono
    // o "Titolo su Mobile" da IndexedDB). Funziona anche offline, con ripresa.
    if (!blob) return;
    closePlayer();   // revoca l'eventuale blob precedente
    _deviceBlobUrl = URL.createObjectURL(blob);
    const nm = (name || "Video").replace(/\.(mp4|mkv|webm|m4v|mov)$/i, "");
    currentPlayTitle = nm;
    _playKey = key || ("dev:" + nm);
    if (el.playingTitle) el.playingTitle.textContent = `Riproduzione: ${nm}`;
    el.playerSection.classList.remove("hidden");
    if (el.qualityBar) el.qualityBar.classList.remove("hidden");
    setQualityControls(false);
    if (el.iframePlayer) el.iframePlayer.classList.add("hidden");
    el.videoPlayer.classList.remove("hidden");
    el.videoPlayer.src = _deviceBlobUrl;
    currentMediaForCast = null;   // un blob locale non e' trasmettibile alla TV
    el.videoPlayer.play().catch(() => {});
    playbackCtx = null;
    updatePlaybackNav();
    if (el.playerSection) el.playerSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function _loadDownloadSubs(id) {
    const v = el.videoPlayer; if (!v) return;
    [...v.querySelectorAll("track")].forEach(t => t.remove());
    try {
        const r = await fetch(withLanToken("/api/download/subs/" + encodeURIComponent(id)));
        if (!r.ok) return;
        const subs = await r.json();
        (subs || []).forEach((s, i) => {
            const tr = document.createElement("track");
            tr.kind = "subtitles";
            tr.label = s.name || s.lang || "Sottotitoli";
            tr.srclang = (s.lang || "sub").slice(0, 12);
            tr.src = withLanToken(s.url);
            if (i === 0) tr.default = true;
            v.appendChild(tr);
        });
        _updateCCVisibility();
        if (subs && subs.length) showToast("Sottotitoli italiani disponibili: premi CC per attivarli.", 5000);
    } catch (e) {}
}

function _setCCActive(on) { if (el.ccBtn) el.ccBtn.classList.toggle("cc-on", !!on); }

function _updateCCVisibility() {
    if (!el.ccBtn) return;
    let has = false;
    try { if (el.videoPlayer.textTracks && el.videoPlayer.textTracks.length) has = true; } catch (e) {}
    if (activeHls && activeHls.subtitleTracks && activeHls.subtitleTracks.length) has = true;
    el.ccBtn.classList.toggle("hidden", !has);
    if (!has) _setCCActive(false);
}

function toggleCC() {
    const v = el.videoPlayer;
    const tts = v.textTracks;
    if (tts && tts.length) {
        let idx = -1;
        for (let i = 0; i < tts.length; i++) { if (/^it|ital/i.test(tts[i].language || tts[i].label || "")) { idx = i; break; } }
        if (idx < 0) idx = 0;
        const on = tts[idx].mode !== "showing";
        for (let i = 0; i < tts.length; i++) tts[i].mode = (i === idx && on) ? "showing" : "disabled";
        _setCCActive(on);
        showToast(on ? "Sottotitoli italiani attivati" : "Sottotitoli disattivati");
        return;
    }
    if (activeHls && activeHls.subtitleTracks && activeHls.subtitleTracks.length) {
        if (activeHls.subtitleTrack >= 0) { activeHls.subtitleTrack = -1; _setCCActive(false); showToast("Sottotitoli disattivati"); }
        else {
            let idx = activeHls.subtitleTracks.findIndex(x => /^it|ital/i.test(x.lang || x.name || ""));
            if (idx < 0) idx = 0;
            try { activeHls.subtitleDisplay = true; } catch (e) {}
            activeHls.subtitleTrack = idx; _setCCActive(true); showToast("Sottotitoli italiani attivati");
        }
        return;
    }
    showToast("Nessun sottotitolo disponibile per questo titolo.");
}

function playDownloaded(id, title, key, opts) {
    opts = opts || {};
    // "inPlace": cambia episodio SENZA smontare il player, cosi' la TV
    // (AirPlay/schermo intero via HDMI) non si disconnette al passaggio.
    var inPlace = opts.inPlace && el.playerSection && !el.playerSection.classList.contains("hidden");
    if (!inPlace) {
        closePlayer();
    } else if (activeHls) {
        try { activeHls.destroy(); } catch (e) {}
        activeHls = null;
    }
    currentPlayTitle = title || "";
    _playKey = "dl:" + id;
    if (el.playingTitle) el.playingTitle.textContent = `Riproduzione: ${title || "download"}`;
    el.playerSection.classList.remove("hidden");
    if (el.qualityBar) el.qualityBar.classList.remove("hidden");
    setQualityControls(false);
    if (el.iframePlayer) el.iframePlayer.classList.add("hidden");
    el.videoPlayer.classList.remove("hidden");
    el.videoPlayer.src = withLanToken(`/api/download/play/${encodeURIComponent(id)}`);
    _loadDownloadSubs(id);
    currentMediaForCast = { src: `/api/download/play/${encodeURIComponent(id)}`, hls: false, title: title || "SC Portal" };
    // NB: nessun load() qui. Impostare .src avvia gia' il caricamento del nuovo
    // episodio; evitando load() la sessione TV (Remote Playback/Chromecast o
    // schermo intero sul contenitore) puo' proseguire invece di chiudersi.
    el.videoPlayer.play().catch(() => {});
    const ep = parseEpisode(title);
    if (ep) {
        playbackCtx = buildEpisodeContext(title);   // serie: naviga tra le puntate
    } else {
        const k = key || libKeyForName(title);      // film: ricava la chiave dal nome se manca
        const fc = k ? folderContextForKey(k) : null;
        playbackCtx = fc ? { folderId: fc.folderId, items: fc.items, index: fc.items.findIndex(it => it.key === k) } : null;
    }
    updatePlaybackNav();
    _bannerDismissed = false; _bannerReshown = false;
    showBannerIfAny();   // banner suggerimento subito all'avvio
}

// --- Precedente/Successivo dalla cartella -----------------------------------
function _castTitle() {
    var t = (el.playingTitle && el.playingTitle.textContent || "").replace(/^Riproduzione:\s*/, "");
    return t || "SC Portal";
}

async function openPhoneCast() {
    let info;
    try { info = await (await fetch("/api/cast/info")).json(); }
    catch (e) { showToast("Errore nel recupero dei dati di trasmissione"); return; }
    if (!info || !info.lan_enabled) {
        if (!confirm("Per usare telefono/tablet devi attivare l'accesso dalla rete locale (protetto da un codice segreto). Attivarlo ora? Poi dovrai chiudere e RIAVVIARE SC Portal.")) return;
        try {
            await fetch("/api/cast/enable", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: true }) });
            showToast("Accesso di rete attivato. Chiudi e RIAVVIA SC Portal, poi ripremi \ud83d\udcf1 Telefono/Tablet.", 9000);
        } catch (e) { showToast("Errore nell'attivazione"); }
        return;
    }
    const base = "http://" + info.lan_ip + ":" + info.port;
    const tok = encodeURIComponent(info.token || "");
    // QR UNICO: apre sul telefono/tablet SOLO "I tuoi download".
    const url = base + "/?t=" + tok + "&view=downloads";
    showPhoneCastOverlay(url);
}

async function openRemoteQr() {
    let info;
    try { info = await (await fetch("/api/cast/info")).json(); }
    catch (e) { showToast("Errore nel recupero dei dati"); return; }
    if (!info || !info.lan_enabled) {
        if (!confirm("Per usare il telefono come telecomando devi attivare l'accesso dalla rete locale (protetto da un codice). Attivarlo ora? Poi RIAVVIA SC Portal.")) return;
        try {
            await fetch("/api/cast/enable", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: true }) });
            showToast("Accesso di rete attivato. Chiudi e RIAVVIA SC Portal, poi ripremi Telecomando.", 9000);
        } catch (e) { showToast("Errore nell'attivazione"); }
        return;
    }
    const url = "http://" + info.lan_ip + ":" + info.port + "/remote.html?t=" + encodeURIComponent(info.token || "");
    showQrOverlay(url, "\ud83d\udcf1 Telecomando (telefono \u2192 TV)",
        "Il PC riproduce (anche sulla TV via HDMI). Scansiona col telefono: diventa il telecomando del player \u2014 play/pausa, avanti/indietro, episodio prec./succ. Stessa Wi-Fi.");
}

function showPhoneCastOverlay(url) {
    showQrOverlay(url, "\ud83d\udcf1 I tuoi download su telefono/tablet",
        "Inquadra il QR col telefono o tablet (anche Apple): si apriranno SOLO i tuoi download, pronti da riprodurre. Stessa rete Wi-Fi di questo PC.");
}

function showQrOverlay(url, heading, hint) {
    const overlay = document.createElement("div");
    overlay.className = "picker-overlay";
    overlay.innerHTML = `
      <div class="picker-panel glass phonecast-panel">
        <h3>${escapeHtml(heading)}</h3>
        <p class="picker-hint">${escapeHtml(hint)}</p>
        <div class="phonecast-qr"><img alt="QR" src="/api/cast/qr?data=${encodeURIComponent(url)}"></div>
        <input type="text" class="phonecast-link" readonly value="${escapeHtml(url)}">
        <div class="picker-actions">
          <button class="secondary-btn phonecast-copy">Copia link</button>
          <button class="secondary-btn picker-cancel">Chiudi</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    overlay.querySelector(".picker-cancel").addEventListener("click", close);
    const inp = overlay.querySelector(".phonecast-link");
    overlay.querySelector(".phonecast-copy").addEventListener("click", () => {
        try { inp.select(); } catch (e) {}
        try { navigator.clipboard.writeText(inp.value); }
        catch (e) { try { document.execCommand("copy"); } catch (_) {} }
        showToast("Link copiato");
    });
}

function _mountOverlay(ov) {
    // Deve comparire SOPRA il player anche a schermo intero: in fullscreen un
    // overlay figlio di <body> non si vede, quindi lo agganciamo all'elemento
    // realmente a schermo intero.
    ov.style.zIndex = "100000";
    var host = document.fullscreenElement || document.webkitFullscreenElement || document.body;
    host.appendChild(ov);
}

function castToTV() {
    var v = el.videoPlayer;
    var hasCast = v && v.remote && typeof v.remote.prompt === "function";
    var ov = document.createElement("div");
    ov.className = "picker-overlay"; ov.id = "cast-choice-overlay";
    ov.innerHTML = '<div class="picker-panel glass"><h3>\ud83d\udcfa Trasmetti alla TV</h3>' +
        '<p class="picker-hint">Cosa vuoi guardare?</p>' +
        '<div class="cast-choice">' +
        '<button class="secondary-btn cast-one">\u25b6 Un solo titolo<small>Trasmette questo video alla TV</small></button>' +
        '<button class="secondary-btn cast-many">\ud83d\udcfa Pi\u00f9 titoli di fila<small>Serie/pi\u00f9 film senza tornare al PC</small></button>' +
        '</div><div class="picker-actions"><button class="secondary-btn picker-cancel">Annulla</button></div></div>';
    _mountOverlay(ov);
    var close = function () { ov.remove(); };
    ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
    ov.querySelector(".picker-cancel").addEventListener("click", close);
    ov.querySelector(".cast-one").addEventListener("click", function () {
        close();
        if (hasCast) {
            v.remote.prompt().then(function () { showToast("Trasmissione avviata sulla TV."); })
                .catch(function () { showToast("Trasmissione annullata o nessun dispositivo trovato."); });
        } else {
            showToast("Il browser non supporta la trasmissione diretta. Usa Chrome.");
        }
    });
    ov.querySelector(".cast-many").addEventListener("click", function () {
        close();
        var g = document.createElement("div");
        g.className = "picker-overlay";
        g.innerHTML = '<div class="picker-panel glass"><h3>\ud83d\udcfa Pi\u00f9 titoli di fila</h3>' +
            '<p class="picker-hint" style="text-align:left;line-height:1.6">Trasmettendo il singolo video, la TV si stacca a ogni cambio. Per una maratona senza tornare al PC trasmetti l\u2019intera scheda:</p>' +
            '<ol style="text-align:left;color:var(--dim,#8b8ba3);line-height:1.8;margin:0 0 6px 18px;padding:0">' +
            '<li>In Chrome: menu <b>\u22ee</b> \u2192 <b>Trasmetti\u2026</b></li>' +
            '<li>In \u201cSorgenti\u201d scegli <b>Trasmetti scheda</b>, poi la TV</li>' +
            '<li>Premi <b>\u26f6 Schermo intero</b> qui nel player</li>' +
            '<li>Dal <b>telefono-telecomando</b> scegli e cambia i titoli</li></ol>' +
            '<div class="picker-actions"><button class="secondary-btn picker-cancel">Ho capito</button></div></div>';
        _mountOverlay(g);
        var gc = function () { g.remove(); };
        g.addEventListener("click", function (e) { if (e.target === g) gc(); });
        g.querySelector(".picker-cancel").addEventListener("click", gc);
    });
}

// Blocca il player sul PC mentre si trasmette il singolo video (Remote Playback):
// muta l'audio locale (niente doppio audio) e mostra un velo di "in riproduzione
// sulla TV" sopra al video.
function setupCastLock() {
    var v = el.videoPlayer; if (!v || !v.remote) return;
    var apply = function (connected) {
        v.muted = !!connected;
        var box = el.videoContainer;
        if (!box) return;
        var lock = document.getElementById("cast-lock");
        if (connected) {
            if (!lock) {
                lock = document.createElement("div");
                lock.id = "cast-lock";
                lock.innerHTML = '<div class="cast-lock-inner"><span class="cast-lock-tv">\ud83d\udcfa</span>' +
                    '<span>In riproduzione sulla TV</span>' +
                    '<small>Controlla dal telefono-telecomando o dai tasti qui sotto</small></div>';
                box.appendChild(lock);
            }
        } else if (lock) { lock.remove(); }
    };
    try {
        v.remote.addEventListener("connect", function () { apply(true); });
        v.remote.addEventListener("connecting", function () { apply(true); });
        v.remote.addEventListener("disconnect", function () { apply(false); });
    } catch (e) {}
}

function normName(str) { return (str || "").toLowerCase().replace(/[^a-z0-9]+/g, ""); }

function getPlayableId(item) {
    if (!item) return null;
    if (item.key && downloadByKey[item.key]) return downloadByKey[item.key];
    const n = normName(item.name);
    if (n && localByName[n]) return localByName[n];
    return null;
}

async function refreshLocalDownloads() {
    try {
        const r = await fetch("/api/downloads/local");
        if (!r.ok) return;
        localFiles = await r.json() || [];
        localByName = {};
        localFiles.forEach(f => { const n = normName(f.name); if (n) localByName[n] = f.id; });
        // popola anche la lista download (così i titoli gia' scaricati compaiono
        // automaticamente all'avvio, con la locandina)
        localDownloads = localFiles.map(f => ({ id: f.id, title: f.name, key: f.key || "", cover: f.cover || "", status: "completed", progress: 100, local: true }));
        if (typeof renderHeroBillboard === "function") renderHeroBillboard();
    } catch (e) {}
}

async function refreshDownloads() {
    showToast("Aggiorno i download…");
    await refreshLocalDownloads();
    localDownloads = (localFiles || []).map(f => ({ id: f.id, title: f.name, key: f.key || "", cover: f.cover || "", status: "completed", progress: 100, local: true }));
    try { const sresp = await fetch("/api/download/status"); renderDownloads(sresp.ok ? await sresp.json() : []); }
    catch (e) { renderDownloads([]); }
    carouselizeDownloads();
    showToast(`Trovati ${localDownloads.length} titoli scaricati in /downloads`);
}

// --- Riconoscimento episodi (serie) dai nomi file --------------------------
function parseEpisode(name) {
    const s = name || "";
    const m = s.match(/^(.*?)[\s._-]*s(\d{1,2})[\s._-]*e(\d{1,3})/i)
        || s.match(/^(.*?)[\s._-]*(\d{1,2})x(\d{1,3})/i)
        || s.match(/^(.*?)stagione\s*(\d{1,3}).*?(?:episodio|ep\.?|puntata)\s*(\d{1,3})/i);
    if (!m) return null;
    return { series: (m[1] || "").trim(), season: parseInt(m[2], 10), episode: parseInt(m[3], 10) };
}

// Etichetta breve di un episodio: "N · Titolo puntata" (o "Episodio N").
function episodeLabel(title) {
    const s = (title || "").replace(/\.(mp4|mkv|webm|m4v)$/i, "");
    const ep = parseEpisode(s);
    if (!ep) return s;
    const m = s.match(/s\d{1,2}[\s._-]*e\d{1,3}/i) || s.match(/\d{1,2}x\d{1,3}/i)
        || s.match(/(?:episodio|ep\.?|puntata)\s*\d{1,3}/i);
    let rest = m ? s.slice(s.indexOf(m[0]) + m[0].length) : "";
    rest = rest.replace(/^[\s._\-\u2013\u2014]+/, "").trim();
    return rest ? `${ep.episode} \u00b7 ${rest}` : `Episodio ${ep.episode}`;
}

function buildEpisodeContext(currentName) {
    const cur = parseEpisode(currentName);
    if (!cur) return null;
    const sk = normName(cur.series);
    const eps = (localFiles || []).map(f => ({ f, p: parseEpisode(f.name) }))
        .filter(x => x.p && normName(x.p.series) === sk)
        .sort((a, b) => (a.p.season - b.p.season) || (a.p.episode - b.p.episode));
    if (!eps.length) return null;
    let items = eps.map(x => ({ name: x.f.name, key: "" }));
    let idx = eps.findIndex(x => x.p.season === cur.season && x.p.episode === cur.episode);
    if (idx < 0) { items = [{ name: currentName, key: "" }]; idx = 0; }
    return { folderId: "", items, index: idx, isEpisode: true, ep: cur };
}

// --- Banner "prossimo titolo" oltre i 3/4 della durata ---------------------
function hideNextBanner() { if (el.nextBanner) el.nextBanner.classList.add("hidden"); }

function currentNextItem() {
    if (!playbackCtx || !playbackCtx.items) return null;
    const ni = playbackCtx.index + 1;
    return ni < playbackCtx.items.length ? playbackCtx.items[ni] : null;
}

function showBannerIfAny() {
    // Banner "Prossimo" rimosso su richiesta: non mostrare nulla.
    hideNextBanner();
}

function checkNextBanner() {
    // Il suggerimento viene mostrato SOLO all'avvio del titolo (non ai 3/4).
}

function showNextBanner(next) {
    const b = el.nextBanner; if (!b) return;
    const has = !!getPlayableId(next);
    b.innerHTML = `<span class="nb-text">Prossimo: <b>${escapeHtml(next.name || "titolo")}</b></span>`
        + `<button class="primary-btn small-btn nb-go">${has ? "▶ Riproduci prossimo" : "⬇ Scarica prossimo"}</button>`
        + `<button class="icon-btn nb-close" title="Chiudi">✕</button>`;
    b.classList.remove("hidden");
    b.querySelector(".nb-go").addEventListener("click", () => {
        if (getPlayableId(next)) navigatePlayback(1);
        else { downloadTitles([next]); hideNextBanner(); }
    });
    b.querySelector(".nb-close").addEventListener("click", () => { _bannerDismissed = true; hideNextBanner(); });
}

function libKeyForName(name) {
    const n = normName(name);
    if (!n) return "";
    const hit = (libraryCache || []).find(it => normName(it.name) === n);
    return hit ? hit.key : "";
}

function downloadGroupKey(group) {
    return group && (group.id || group.name || "");
}

function buildDownloadFolderNode(meta, count, level) {
    const key = `dl:${level}:${downloadGroupKey(meta)}`;
    const wrap = document.createElement("div");
    wrap.className = `download-folder download-folder-${level}`;
    const head = document.createElement("div");
    head.className = "download-folder-head";
    const cover = document.createElement("div");
    cover.className = `download-group-cover${meta.cover ? "" : " placeholder"}`;
    if (meta.cover) cover.style.backgroundImage = `url("${String(meta.cover).replace(/"/g, "%22")}")`;
    const title = document.createElement("div");
    title.className = "download-folder-title";
    title.innerHTML = `<span>${escapeHtml(meta.name || "Cartella")}</span><small>${count} download</small>`;
    const toggle = document.createElement("button");
    toggle.className = "icon-btn download-folder-toggle";
    toggle.type = "button";
    toggle.title = "Apri/chiudi";
    toggle.textContent = openDownloadGroups.has(key) ? "▾" : "▸";
    head.appendChild(cover);
    head.appendChild(title);
    head.appendChild(toggle);
    const body = document.createElement("div");
    body.className = "download-folder-body";
    body.classList.toggle("hidden", !openDownloadGroups.has(key));
    head.addEventListener("click", () => {
        const nowHidden = body.classList.toggle("hidden");
        touchedDownloadGroups.add(key);
        if (nowHidden) openDownloadGroups.delete(key); else openDownloadGroups.add(key);
        toggle.textContent = body.classList.contains("hidden") ? "▸" : "▾";
    });
    wrap.appendChild(head);
    wrap.appendChild(body);
    return { wrap, body };
}

function downloadPlacementFor(dl) {
    const actual = downloadGroupFor(dl);
    const info = libInfoForDownload(dl);
    const epEarly = parseEpisode(dl.title);
    if (!actual || !actual.id || !lastLibraryData) {
        if (epEarly) {
            const si = (libraryCache || []).find(x => normName(x.name) === normName(epEarly.series));
            return { root: null, sub: {
                id: `series:${normName(epEarly.series)}`,
                name: epEarly.series || (info && info.name) || "Serie",
                cover: (si && si.cover) || (info && info.cover) || "",
            } };
        }
        const single = info ? { id: `single:${info.key || normName(info.name)}`, name: info.name, cover: info.cover || "" } : null;
        return { root: null, sub: single };
    }
    const folders = lastLibraryData.folders || [];
    const byId = {};
    folders.forEach(f => { if (f && f.id) byId[f.id] = f; });
    let root = actual;
    let cur = byId[actual.id];
    while (cur && cur.parent && byId[cur.parent]) {
        cur = byId[cur.parent];
        root = { id: cur.id, name: cur.name || "Cartella", cover: cur.cover || "" };
    }
    let sub = null;
    const ep = parseEpisode(dl.title);
    if (ep) {
        const seriesInfo = (libraryCache || []).find(x => normName(x.name) === normName(ep.series));
        sub = {
            id: `series:${normName(ep.series)}`,
            name: ep.series || (info && info.name) || "Serie",
            cover: (seriesInfo && seriesInfo.cover) || (info && info.cover) || "",
        };
    } else if (root.id !== actual.id) {
        sub = actual;
    } else if (info) {
        sub = { id: `title:${info.key || normName(info.name)}`, name: info.name || dl.title, cover: info.cover || "" };
    }
    return { root, sub };
}

function downloadGroupFor(dl) {
    if (!lastLibraryData || !dl) return null;
    const info = libInfoForDownload(dl);
    const key = (info && info.key) || dl.key || libKeyForName(dl.title);
    const ep = parseEpisode(dl.title);
    const seriesNorm = ep ? normName(ep.series) : "";
    for (const f of (lastLibraryData.folders || [])) {
        const items = f.items || [];
        const byKey = key && items.some(it => it.key === key);
        const bySeries = seriesNorm && items.some(it => normName(it.name) === seriesNorm);
        if (byKey || bySeries) {
            return { id: f.id, name: f.name || "Cartella", cover: f.cover || ((items[0] || {}).cover || "") };
        }
    }
    return info ? { id: "", name: "Titoli singoli", cover: "" } : null;
}

function libInfoForDownload(dl) {
    if (!dl) return null;
    if (dl.key) { const it = (libraryCache || []).find(x => x.key === dl.key); if (it) return it; }
    const n = normName(dl.title);
    if (!n) return null;
    let it = (libraryCache || []).find(x => normName(x.name) === n);
    if (it) return it;
    const ep = parseEpisode(dl.title);
    if (ep) { const sn = normName(ep.series); it = (libraryCache || []).find(x => normName(x.name) === sn); if (it) return it; }
    it = (libraryCache || []).find(x => { const xn = normName(x.name); return xn.length > 2 && (n.includes(xn) || xn.includes(n)); });
    return it || null;
}

// Determina il "prossimo" per un download completato: puntata successiva (serie)
// o titolo successivo nella cartella (film). Ritorna {name, playId, key, isEpisode}.
function nextTitleForDownload(dl) {
    const title = (dl && dl.title) || "";
    const ep = parseEpisode(title);
    if (ep) {
        const octx = buildEpisodeContext(title);
        if (octx && octx.index + 1 < octx.items.length) {
            const nx = octx.items[octx.index + 1];
            const pid = getPlayableId(nx);
            if (pid) return { name: nx.name, playId: pid, key: "", isEpisode: true };
        }
        // prossimo episodio non presente: proponi il download (risoluzione online)
        return { name: `${ep.series} S${ep.season}E${ep.episode + 1}`, playId: null, isEpisode: true,
                 series: ep.series, season: ep.season, episode: ep.episode };
    }
    const k = (dl && dl.key) || libKeyForName(title);
    const fc = k ? folderContextForKey(k) : null;
    if (!fc) return null;
    const idx = fc.items.findIndex(it => it.key === k);
    if (idx < 0 || idx + 1 >= fc.items.length) return null;
    const nx = fc.items[idx + 1];
    return { name: nx.name, playId: getPlayableId(nx), key: nx.key, isEpisode: false };
}

function folderContextForKey(key) {
    const data = lastLibraryData;
    if (!data || !key) return null;
    for (const f of (data.folders || [])) {
        const items = f.items || [];
        if (items.some(it => it.key === key)) return { folderId: f.id, items };
    }
    return null;
}

function updatePlaybackNav() {
    const has = !!(playbackCtx && playbackCtx.items && (playbackCtx.items.length > 1 || playbackCtx.isEpisode));
    if (el.prevTitleBtn) { el.prevTitleBtn.classList.toggle("hidden", !has); if (has) el.prevTitleBtn.disabled = (!playbackCtx.isEpisode && playbackCtx.index <= 0); }
    if (el.nextTitleBtn) { el.nextTitleBtn.classList.toggle("hidden", !has); if (has) el.nextTitleBtn.disabled = (!playbackCtx.isEpisode && playbackCtx.index >= playbackCtx.items.length - 1); }
}

function navigatePlayback(delta) {
    if (!playbackCtx || !playbackCtx.items) return;
    const ni = playbackCtx.index + delta;
    const next = (ni >= 0 && ni < playbackCtx.items.length) ? playbackCtx.items[ni] : null;
    if (next) {
        const pid = getPlayableId(next);
        if (pid) { playbackCtx.index = ni; playDownloaded(pid, next.name, next.key, { inPlace: true }); return; }
    }
    if (playbackCtx.isEpisode) {
        const cur = parseEpisode((playbackCtx.items[playbackCtx.index] || {}).name || "") || playbackCtx.ep;
        if (cur) { downloadAdjEpisode(cur.series, cur.season, cur.episode, delta > 0 ? "next" : "prev"); return; }
    }
    if (next && next.key && /^\d+-/.test(next.key)) { downloadTitles([{ key: next.key, name: next.name }]); return; }
    showToast(delta > 0 ? "Nessun successivo" : "Nessun precedente");
}

function promptDownloadFrom(startIndex) {
    const items = playbackCtx.items;
    const remaining = items.slice(startIndex).filter(it => !getPlayableId(it) && /^\d+-/.test(it.key || ""));
    if (!remaining.length) { showToast("Da qui non c'e' nulla da scaricare (gia' scaricati o non validi)"); return; }
    const first = items[startIndex];
    const ans = prompt(`"${first.name}" non e' ancora scaricato.\nQuanti titoli scaricare da qui in poi? (max ${remaining.length}, 0 = annulla)`, "1");
    if (ans === null) return;
    const n = Math.max(0, Math.min(remaining.length, parseInt(ans, 10) || 0));
    if (!n) return;
    downloadTitles(remaining.slice(0, n));
}

async function downloadTitles(items, hold = false) {
    warnNoProxyOnce();
    const _before = (items || []).length;
    items = (items || []).filter(it => !_dupExists(it.name));
    const _dups = _before - items.length;
    if (!items.length) { showToast(_dups ? "Già presenti: niente da scaricare." : "Niente da scaricare."); return; }
    let started = 0;
    for (const it of items) {
        const m = /^(\d+)-/.exec(it.key || "");
        if (!m) continue;
        try {
            const r = await fetch("/api/download/title", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: parseInt(m[1], 10), title: it.name || "Video", key: it.key, hold: !!hold })
            });
            if (r.ok) started++;
        } catch (e) {}
    }
    if (hold) showToast(started ? `Preparati ${started} in coda. Avviali da "I tuoi download".` : "Impossibile preparare i download", 5000);
    else showToast(started ? `Avviati ${started} download. Riproducibili quando pronti.` : "Impossibile avviare i download");
}

async function downloadNextEpisode(series, season, episode, hold = false) {
    showToast(hold ? "Preparo il prossimo episodio in coda…" : "Cerco il prossimo episodio…");
    try {
        const r = await fetch("/api/download/next-episode", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ series, season, episode, hold: !!hold })
        });
        const d = await r.json().catch(() => ({}));
        if (r.ok) showToast((d.held ? "Preparato in coda: " : "Scarico: ") + (d.label || "prossimo episodio"), 5000);
        else showToast(d.detail || "Prossimo episodio non trovato");
    } catch (e) { showToast("Errore nel download del prossimo episodio"); }
}

async function downloadAdjEpisode(series, season, episode, direction) {
    showToast(direction === "prev" ? "Cerco l'episodio precedente…" : "Cerco il prossimo episodio…");
    try {
        const r = await fetch("/api/download/next-episode", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ series, season, episode, direction })
        });
        const d = await r.json().catch(() => ({}));
        if (r.ok) showToast(`Scarico: ${d.label || "episodio"}`);
        else showToast(d.detail || "Episodio non trovato");
    } catch (e) { showToast("Errore nel download dell'episodio"); }
}

function playLibraryTitle(item) {
    const pid = getPlayableId(item);
    if (pid) playDownloaded(pid, item.name, item.key);
    else openFromLibrary(item);
}

async function openDownloadFile(id) {
    try {
        const r = await fetch("/api/download/open", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id })
        });
        if (!r.ok) {
            const e = await r.json().catch(() => ({}));
            showToast(e.detail || "Impossibile aprire il file");
        }
    } catch (e) { showToast("Errore nell'apertura del file"); }
}

async function revealDownloadFile(id) {
    try {
        const r = await fetch("/api/download/reveal", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id })
        });
        if (!r.ok) {
            const e = await r.json().catch(() => ({}));
            showToast(e.detail || "Impossibile aprire la cartella");
        }
    } catch (e) { showToast("Errore nell'apertura della cartella"); }
}

async function openDownloadsFolder() {
    try {
        const r = await fetch("/api/downloads/open-folder", { method: "POST" });
        if (!r.ok) showToast("Impossibile aprire la cartella");
    } catch (e) { showToast("Errore nell'apertura della cartella"); }
}

// 8. Library with content folders (playlists of titles) -------------------
function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g,
        c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function saveAll() {
    if (el.saveLibraryBtn) el.saveLibraryBtn.disabled = true;
    showToast("Salvataggio in corso…", 4000);
    try {
        const r = await fetch("/api/save", { method: "POST" });
        if (r.ok) {
            const d = await r.json();
            showToast(`Salvato \u2713  ${d.titles} titoli · ${d.folders} cartelle · ${d.favorites} preferiti`, 4000);
        } else {
            const e = await r.json().catch(() => ({}));
            showToast(e.detail || "Errore durante il salvataggio", 6000);
        }
    } catch (e) {
        showToast("Errore di connessione durante il salvataggio", 6000);
    } finally {
        if (el.saveLibraryBtn) el.saveLibraryBtn.disabled = false;
    }
}

async function fetchLibrary() {
    try {
        const r = await fetch("/api/folders");
        if (r.ok) renderLibrary(await r.json());
    } catch (e) { console.error("library fetch failed", e); }
}

async function addToLibrary(url, data) {
    if (!url || !data) return;
    const entry = {
        key: data.key || url, url: url,
        name: data.name || "", cover: data.cover || "",
        type: data.type || "", release_date: data.release_date || "", is_clone: !!data.is_clone
    };
    try {
        const r = await fetch("/api/library", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(entry)
        });
        if (r.ok) { await fetchLibrary(); updateModalStar(); }
    } catch (e) { /* non-fatal */ }
}

function titleRow(item, ctx) {
    const row = document.createElement("div");
    row.className = "library-item" + (item.favorite ? " is-fav" : "") + (librarySel.has(item.key) ? " selected" : "");
    const typeBadge = item.type === "tv" ? "Serie" : (item.type === "movie" ? "Film" : "");
    const cover = item.cover
        ? `<img class="library-cover" src="${item.cover}" alt="" loading="lazy">`
        : `<div class="library-cover placeholder"></div>`;
    const name = item.name && item.name.trim() ? item.name : "Senza titolo";
    // Up/down reorder controls only inside a folder (ctx provided).
    const _clen = ctx ? (ctx.combined ? (ctx.tokens ? ctx.tokens.length : 0) : (ctx.keys ? ctx.keys.length : 0)) : 0;
    const moveBtns = (ctx && !ctx.noReorder) ? `
            <button class="icon-btn moveup-btn" title="Sposta a sinistra"${ctx.index === 0 ? " disabled" : ""}>‹</button>
            <button class="icon-btn movedown-btn" title="Sposta a destra"${ctx.index >= _clen - 1 ? " disabled" : ""}>›</button>` : "";
    row.innerHTML = `
        ${cover}
        <div class="library-meta">
            <span class="library-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
            <span class="library-sub">${typeBadge}${item.is_clone ? " · clone" : ""}</span>
        </div>
        <div class="library-actions"><label class="lib-select" title="Seleziona"><input type="checkbox" ${librarySel.has(item.key) ? "checked" : ""}></label>${moveBtns}
            <button class="icon-btn play-title-btn" title="Riproduci">▶</button>
            <button class="icon-btn tofolder-btn" title="Metti in cartelle">📂</button>
            <label class="icon-btn" title="Cambia locandina">🖼️<input type="file" accept="image/*" class="libcover-input" hidden></label>
            <button class="icon-btn ren-title-btn" title="Rinomina titolo">✎</button>
            <button class="icon-btn fav-btn" title="${item.favorite ? "Rimuovi dai preferiti" : "Aggiungi ai preferiti"}">${item.favorite ? "★" : "☆"}</button>
            <button class="icon-btn del-btn" title="Rimuovi dalla libreria">✕</button>
        </div>`;
    row.addEventListener("click", (e) => { if (e.target.closest(".library-actions") || e.target.closest(".lib-select")) return; openFromLibrary(item); });
    const _selWrap = row.querySelector(".lib-select");
    if (_selWrap) {
        _selWrap.addEventListener("click", (e) => e.stopPropagation());
        _selWrap.querySelector("input").addEventListener("change", (e) => {
            e.stopPropagation();
            if (e.target.checked) librarySel.set(item.key, item); else librarySel.delete(item.key);
            row.classList.toggle("selected", e.target.checked);
            updateLibrarySelBar();
        });
    }
    row.querySelector(".tofolder-btn").addEventListener("click", (e) => { e.stopPropagation(); openTitleFolderPicker(item); });
    row.querySelector(".play-title-btn").addEventListener("click", (e) => { e.stopPropagation(); playLibraryTitle(item); });
    row.querySelector(".libcover-input").addEventListener("change", (e) => { e.stopPropagation(); uploadTitleCover(item.key, e.target); });
    row.querySelector(".ren-title-btn").addEventListener("click", (e) => { e.stopPropagation(); if (ctx && ctx.folderId) renameInFolder(ctx.folderId, item.key, item.name); else renameTitle(item.key, item.name); });
    row.querySelector(".fav-btn").addEventListener("click", (e) => { e.stopPropagation(); toggleFavorite(item.key); });
    row.querySelector(".del-btn").addEventListener("click", (e) => { e.stopPropagation(); removeFromLibrary(item.key, item.name); });
    if (ctx && !ctx.noReorder) {
        const up = row.querySelector(".moveup-btn");
        const dn = row.querySelector(".movedown-btn");
        const _mv = (delta) => { if (ctx.combined) reorderCombined(ctx.folderId, ctx.tokens, ctx.index, delta); else moveInFolder(ctx.folderId, ctx.keys, ctx.index, delta); };
        if (up && !up.disabled) up.addEventListener("click", (e) => { e.stopPropagation(); _mv(-1); });
        if (dn && !dn.disabled) dn.addEventListener("click", (e) => { e.stopPropagation(); _mv(1); });
    }
    // Drag & drop: every row is draggable (onto a folder = add); inside a folder
    // a row is also a reorder drop-target.
    row.draggable = true;
    row.addEventListener("dragstart", (e) => {
        e.stopPropagation();
        e.dataTransfer.setData("application/json", JSON.stringify({
            src: "lib", key: item.key, fromFolder: ctx ? ctx.folderId : "",
            item: { id_and_slug: item.key, key: item.key, name: item.name, cover: item.cover, type: item.type, url: item.url, release_date: item.release_date }
        }));
        e.dataTransfer.effectAllowed = "move";
        row.classList.add("dragging");
    });
    row.addEventListener("dragend", () => row.classList.remove("dragging"));
    if (ctx && !ctx.noReorder) {
        row.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; row.classList.add("drop-target"); });
        row.addEventListener("dragleave", () => row.classList.remove("drop-target"));
        row.addEventListener("drop", (e) => { e.preventDefault(); e.stopPropagation(); row.classList.remove("drop-target"); handleRowDrop(e, ctx); });
    }
    return row;
}

async function moveInFolder(folderId, keys, index, delta) {
    const j = index + delta;
    if (j < 0 || j >= keys.length) return;
    const arr = keys.slice();
    [arr[index], arr[j]] = [arr[j], arr[index]];
    try {
        const r = await fetch("/api/folders/set", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: folderId, items: arr })
        });
        if (r.ok) renderLibrary(await r.json());
    } catch (e) { showToast("Errore riordino titoli"); }
}

async function reorderFolder(id, beforeId) {
    try {
        const r = await fetch("/api/folders/reorder", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, before: beforeId })
        });
        if (r.ok) { renderLibrary(await r.json()); showToast("Cartelle riordinate"); }
        else showToast("Errore riordino cartelle");
    } catch (e) { showToast("Errore riordino cartelle"); }
}

// Riordino combinato (titoli + sottocartelle) dentro una cartella, via token.
async function reorderCombined(folderId, tokens, index, delta) {
    const j = index + delta;
    if (!tokens || j < 0 || j >= tokens.length) return;
    const arr = allTokensForFolder(folderId, tokens);
    const a = tokens[index], b = tokens[j];
    const ai = arr.indexOf(a), bi = arr.indexOf(b);
    if (ai < 0 || bi < 0) return;
    arr.splice(ai, 1);
    arr.splice(bi, 0, a);
    try {
        const r = await fetch("/api/folders/order", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: folderId, order: arr })
        });
        if (r.ok) renderLibrary(await r.json());
    } catch (e) { showToast("Errore riordino"); }
}

function allTokensForFolder(folderId, fallbackTokens) {
    const folders = (lastLibraryData && lastLibraryData.folders) || [];
    const f = folders.find(x => x.id === folderId);
    if (!f) return (fallbackTokens || []).slice();
    const valid = new Set([]
        .concat((f.items || []).map(it => it.key))
        .concat(folders.filter(x => (x.parent || "") === folderId).map(x => "f:" + x.id)));
    const out = [];
    (f.order || []).forEach(t => { if (valid.has(t) && !out.includes(t)) out.push(t); });
    valid.forEach(t => { if (!out.includes(t)) out.push(t); });
    (fallbackTokens || []).forEach(t => { if (valid.has(t) && !out.includes(t)) out.push(t); });
    return out;
}

// Drop di riordino combinato: sposta il token trascinato prima del target.
// Ritorna true se ha gestito il drop (elemento dello stesso genitore).
async function combinedDropReorder(folderId, tokens, targetToken, data) {
    if (!tokens) return false;
    const dragToken = data && data.src === "folder" ? ("f:" + data.id)
        : (data && data.src === "lib" ? data.key : null);
    if (!dragToken || dragToken === targetToken) return false;
    if (!tokens.includes(dragToken)) return false; // non appartiene a questa cartella
    const arr = allTokensForFolder(folderId, tokens);
    arr.splice(arr.indexOf(dragToken), 1);
    const ti = arr.indexOf(targetToken);
    arr.splice(ti < 0 ? arr.length : ti, 0, dragToken);
    try {
        const r = await fetch("/api/folders/order", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: folderId, order: arr })
        });
        if (r.ok) { renderLibrary(await r.json()); return true; }
    } catch (e) {}
    return false;
}

// Su/giù per cartelle in radice (dentro i gruppi per tipologia / "Altre").
async function reorderRoot(list, index, delta) {
    const j = index + delta;
    if (!list || j < 0 || j >= list.length) return;
    let beforeId;
    if (delta < 0) beforeId = list[index - 1].id;
    else beforeId = (index + 2 < list.length) ? list[index + 2].id : "";
    await reorderFolder(list[index].id, beforeId);
}

function updateLibrarySelBar() {
    let bar = document.getElementById("library-selbar");
    const n = librarySel.size;
    if (!n) { if (bar) bar.remove(); return; }
    if (!bar) { bar = document.createElement("div"); bar.id = "library-selbar"; bar.className = "selbar"; document.body.appendChild(bar); }
    bar.innerHTML = `<span class="selbar-count">${n} selezionati</span>`
        + `<button class="primary-btn lsel-folder">📂 Sposta in cartella</button>`
        + `<button class="secondary-btn lsel-new">📁+ Nuova cartella</button>`
        + `<button class="secondary-btn lsel-clear">Deseleziona</button>`;
    bar.querySelector(".lsel-folder").addEventListener("click", () => openKeysFolderPicker([...librarySel.keys()]));
    bar.querySelector(".lsel-new").addEventListener("click", () => bulkNewFolderKeys([...librarySel.keys()]));
    bar.querySelector(".lsel-clear").addEventListener("click", () => { librarySel.clear(); if (lastLibraryData) renderLibrary(lastLibraryData); updateLibrarySelBar(); });
}

async function openKeysFolderPicker(keys) {
    if (!keys.length) return;
    let data;
    try { data = await (await fetch("/api/folders")).json(); }
    catch (e) { showToast("Errore caricamento cartelle"); return; }
    const folders = data.folders || [];
    const overlay = document.createElement("div");
    overlay.className = "picker-overlay";
    const rows = folders.map(f => `<label class="picker-row"><input type="checkbox" data-fid="${f.id}"><span>${escapeHtml(f.name || "Cartella")}</span>${f.kind ? ` <span class="picker-note">${escapeHtml(f.kind)}</span>` : ""}</label>`).join("");
    overlay.innerHTML = `
        <div class="picker-panel glass">
            <h3>Sposta ${keys.length} titoli in…</h3>
            <p class="picker-hint">Spunta una o più cartelle (anche sottocartelle) dove aggiungere i titoli selezionati.</p>
            <input type="text" class="picker-search" placeholder="Cerca una cartella…" autocomplete="off" spellcheck="false">
            <div class="picker-list">${rows || '<div class="no-downloads">Nessuna cartella. Usa Nuova cartella.</div>'}</div>
            <div class="picker-actions">
                <button class="secondary-btn picker-cancel">Annulla</button>
                <button class="primary-btn picker-confirm">Conferma</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    overlay.querySelector(".picker-cancel").addEventListener("click", close);
    const ps = overlay.querySelector(".picker-search");
    if (ps) ps.addEventListener("input", () => {
        const q = ps.value.trim().toLowerCase();
        overlay.querySelectorAll(".picker-row").forEach(r => { r.style.display = r.textContent.toLowerCase().includes(q) ? "" : "none"; });
    });
    overlay.querySelector(".picker-confirm").addEventListener("click", async () => {
        const fids = Array.from(overlay.querySelectorAll('input[type="checkbox"]:checked')).map(c => c.dataset.fid);
        if (!fids.length) { showToast("Seleziona almeno una cartella"); return; }
        let payload = null;
        try {
            for (const fid of fids) {
                const r = await fetch("/api/folders/add-items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: fid, keys }) });
                if (r.ok) { payload = await r.json(); openFolders.add(fid); }
            }
            librarySel.clear();
            if (payload) renderLibrary(payload); else if (lastLibraryData) renderLibrary(lastLibraryData);
            updateLibrarySelBar();
            showToast(`${keys.length} titoli aggiunti a ${fids.length} cartella/e`);
        } catch (e) { showToast("Errore spostamento"); }
        close();
    });
}

async function bulkNewFolderKeys(keys) {
    if (!keys.length) return;
    const name = prompt(`Nome della nuova cartella per ${keys.length} titoli:`, "");
    if (name === null || !name.trim()) return;
    try {
        const r = await fetch("/api/folders/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() }) });
        if (!r.ok) { showToast("Errore creazione cartella"); return; }
        const data = await r.json();
        const folder = (data.folders || [])[(data.folders || []).length - 1];
        if (folder) {
            await fetch("/api/folders/add-items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: folder.id, keys }) });
            openFolders.add(folder.id);
        }
        librarySel.clear();
        await fetchLibrary();
        updateLibrarySelBar();
        showToast(`Cartella "${name.trim()}" creata con ${keys.length} titoli`);
    } catch (e) { showToast("Errore creazione cartella"); }
}

async function nestFolder(childId, parentId) {
    try {
        const r = await fetch("/api/folders/parent", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: childId, parent: parentId })
        });
        if (r.ok) {
            if (parentId) openFolders.add(parentId);
            renderLibrary(await r.json());
            showToast(parentId ? "Cartella annidata" : "Cartella portata in radice");
        } else {
            const d = await r.json().catch(() => ({}));
            showToast(d.detail || "Spostamento non valido");
        }
    } catch (e) { showToast("Errore spostamento cartella"); }
}

async function openPrivacyPanel() {
    let p = document.getElementById("privacy-panel");
    if (p) { p.remove(); return; }  // toggle chiuso
    p = document.createElement("div");
    p.id = "privacy-panel";
    p.className = "privacy-panel";
    p.innerHTML =
        '<div class="pp-head">Privacy &amp; kill-switch <button class="pp-close" title="Chiudi">✕</button></div>' +
        '<div class="pp-body"><div class="pp-status">Controllo stato…</div>' +
        '<label class="pp-row"><span>Kill-switch (blocca se la VPN è spenta)</span>' +
        '<input type="checkbox" id="pp-ks"></label>' +
        '<label class="pp-row"><span>Incognito su disco (non salvare libreria/cronologia/locandine)</span>' +
        '<input type="checkbox" id="pp-inc"></label>' +
        '<button class="secondary-btn small-btn" id="pp-sethome">Registra questo IP come “casa” (VPN spenta)</button>' +
        '<p class="pp-hint">Registra l’IP di casa con la VPN SPENTA. Poi, con il kill-switch attivo, le operazioni online vengono bloccate se rilevano quell’IP (VPN caduta).</p></div>';
    document.body.appendChild(p);
    p.querySelector(".pp-close").addEventListener("click", () => p.remove());
    const refresh = async () => {
        try {
            const r = await fetch(withLanToken("/api/privacy/ip-status"));
            if (!r.ok) { p.querySelector(".pp-status").textContent = (r.status === 404) ? "Riavvia SC Portal per attivare questa funzione." : "Stato non disponibile."; return; }
            const d = await r.json();
            const ks = p.querySelector("#pp-ks"); ks.checked = !!d.kill_switch;
            const inc = p.querySelector("#pp-inc"); if (inc) inc.checked = !!d.incognito;
            let txt;
            if (!d.detected) txt = "IP pubblico non rilevabile ora.";
            else if (!d.have_home) txt = "IP attuale: " + d.current_ip_masked + " · nessun IP di casa registrato.";
            else if (d.protected) txt = "✅ Protetto — IP attuale " + d.current_ip_masked + " ≠ casa " + d.home_ip_masked + " (VPN attiva).";
            else txt = "⚠️ IP di casa rilevato (" + d.current_ip_masked + "): la VPN sembra SPENTA.";
            p.querySelector(".pp-status").textContent = txt;
            p.querySelector(".pp-status").className = "pp-status" + (d.have_home ? (d.protected ? " ok" : " warn") : "");
        } catch (e) { p.querySelector(".pp-status").textContent = "Errore di stato."; }
    };
    p.querySelector("#pp-ks").addEventListener("change", async (e) => {
        try {
            await fetch(withLanToken("/api/privacy/kill-switch"), {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ enabled: e.target.checked })
            });
            showToast(e.target.checked ? "Kill-switch attivato" : "Kill-switch disattivato");
        } catch (err) { showToast("Errore kill-switch"); }
        refresh();
    });
    p.querySelector("#pp-inc").addEventListener("change", async (e) => {
        try {
            await fetch(withLanToken("/api/privacy/incognito"), {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ enabled: e.target.checked })
            });
            showToast(e.target.checked ? "Incognito attivo: niente tracce su disco" : "Incognito disattivato", 4000);
        } catch (err) { showToast("Errore incognito"); }
        refresh();
    });
    p.querySelector("#pp-sethome").addEventListener("click", async () => {
        if (!confirm("Registrare l’IP attuale come IP di casa?\n\nFallo con la VPN SPENTA, altrimenti registrerai l’IP della VPN e il kill-switch non funzionerà.")) return;
        try {
            const r = await fetch(withLanToken("/api/privacy/set-home-ip"), { method: "POST" });
            if (r.ok) { const d = await r.json(); showToast("IP di casa registrato: " + (d.home_ip_masked || "")); }
            else showToast("Impossibile registrare l’IP ora");
        } catch (e) { showToast("Errore registrazione IP"); }
        refresh();
    });
    refresh();
}

async function privacyClean() {
    if (!confirm("Pulire le tracce locali?\n\nAzzera server.log e cancella cookie/cache del browser (inclusa la clearance Cloudflare). La prossima riproduzione potrebbe riaprire il browser per rifare la verifica. I download e la libreria NON vengono toccati.")) return;
    try {
        const r = await fetch(withLanToken("/api/privacy/clean"), { method: "POST" });
        if (r.ok) {
            const d = await r.json().catch(() => ({}));
            const what = (d.removed && d.removed.length) ? d.removed.join(", ") : "nulla da pulire";
            showToast("Tracce ripulite: " + what, 5000);
        } else if (r.status === 404) {
            showToast("Funzione non disponibile: chiudi e RIAVVIA SC Portal.", 6000);
        } else {
            showToast("Impossibile pulire le tracce");
        }
    } catch (e) { showToast("Errore durante la pulizia"); }
}

async function shutdownApp() {
    if (!confirm("Spegnere SC Portal? Il server verra' chiuso.")) return;
    try { await fetch(withLanToken("/api/shutdown"), { method: "POST" }); } catch (e) {}
    document.body.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:center;height:100vh;'
        + 'font-family:sans-serif;color:#9ca3af;text-align:center;padding:2rem">'
        + '<div><h2 style="color:#fff;margin-bottom:.5rem">SC Portal spento</h2>'
        + '<p>Puoi chiudere questa scheda del browser.</p></div></div>';
}

async function toggleFolderFavorite(id) {
    try {
        const r = await fetch("/api/folders/favorite", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id })
        });
        if (r.ok) renderLibrary(await r.json());
        else showToast("Errore preferito cartella");
    } catch (e) { showToast("Errore preferito cartella"); }
}

function applyFolderView(items, st) {
    let arr = (items || []).slice();
    if (st && st.type) arr = arr.filter(it => (it.type || "") === st.type);
    if (st && st.order === "recent") arr.sort((a, b) => (b.release_date || "").localeCompare(a.release_date || ""));
    else if (st && st.order === "oldest") arr.sort((a, b) => (a.release_date || "9999").localeCompare(b.release_date || "9999"));
    return arr;
}

async function handleFolderAdd(folderId, data) {
    if (!data) return;
    let keys = [];
    if (data.src === "search" && data.item) keys = await bulkSaveItems([data.item]);
    else if (data.key) keys = [data.key];
    if (!keys.length) return;
    try {
        const r = await fetch("/api/folders/add-items", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: folderId, keys })
        });
        if (r.ok) { openFolders.add(folderId); renderLibrary(await r.json()); showToast("Aggiunto alla cartella"); }
        else showToast("Errore aggiunta alla cartella");
    } catch (e) { showToast("Errore aggiunta alla cartella"); }
}

async function handleRowDrop(e, ctx) {
    let data; try { data = JSON.parse(e.dataTransfer.getData("application/json")); } catch (err) { return; }
    if (ctx && ctx.combined) {
        if (await combinedDropReorder(ctx.folderId, ctx.tokens, ctx.tokens[ctx.index], data)) return;
        await handleFolderAdd(ctx.folderId, data);
        return;
    }
    if (data.src === "lib" && data.fromFolder === ctx.folderId) {
        const targetKey = ctx.keys[ctx.index];
        if (data.key === targetKey) return;
        const arr = ctx.keys.slice();
        const from = arr.indexOf(data.key);
        if (from === -1) { await handleFolderAdd(ctx.folderId, data); return; }
        arr.splice(from, 1);
        const tIdx = arr.indexOf(targetKey);
        arr.splice(tIdx < 0 ? arr.length : tIdx, 0, data.key);
        try {
            const r = await fetch("/api/folders/set", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: ctx.folderId, items: arr })
            });
            if (r.ok) renderLibrary(await r.json());
        } catch (err) { showToast("Errore riordino titoli"); }
    } else {
        await handleFolderAdd(ctx.folderId, data);
    }
}

function setupCollapsibles() {
    document.querySelectorAll(".collapsible").forEach((sec) => {
        const id = sec.id || "";
        let stored = null;
        try { stored = localStorage.getItem("collapse_" + id); } catch (e) {}
        const collapsed = stored === null ? true : stored === "1"; // default: compatto
        sec.classList.toggle("collapsed", collapsed);
        const header = sec.querySelector(".tool-toggle");
        if (!header || header.dataset.cbound) return;
        header.dataset.cbound = "1";
        header.addEventListener("click", (e) => {
            if (e.target.closest("#save-library-btn, #test-domains-btn")) return;
            const c = sec.classList.toggle("collapsed");
            try { localStorage.setItem("collapse_" + id, c ? "1" : "0"); } catch (e2) {}
        });
    });
}

function toggleClearBtn() {
    if (!el.searchClear) return;
    el.searchClear.style.display = (el.urlInput && el.urlInput.value.trim()) ? "" : "none";
}

function clearSearch() {
    if (el.urlInput) el.urlInput.value = "";
    toggleClearBtn();
    searchAll = []; searchQ = ""; searchPage = 1; searchSel.clear();
    if (el.searchResults) el.searchResults.innerHTML = "";
    const pg = document.getElementById("search-pager"); if (pg) pg.remove();
    const li = document.getElementById("search-listinfo"); if (li) li.remove();
    updateSelBar();
    if (el.searchResultsSection) el.searchResultsSection.classList.add("hidden");
    if (el.urlInput) el.urlInput.focus();
}

function renderLibrary(data) {
    if (!el.libraryList) return;
    lastLibraryData = data;
    const scrollY = window.scrollY;  // keep the user's place across the rebuild
    const folders = (data && data.folders) || [];
    const unassigned = (data && data.unassigned) || [];
    const customFilters = [...new Set([].concat((data && data.custom_filters) || [], [...localCustomFilters]))];
    const filterCovers = (data && data.filter_covers) || {};
    // de-duplicated list of every title (for search + favourites + modal star)
    const allTitles = [];
    const seen = new Set();
    [].concat(unassigned, ...folders.map(f => f.items || [])).forEach(it => {
        if (it && it.key && !seen.has(it.key)) { seen.add(it.key); allTitles.push(it); }
    });
    libraryCache = allTitles;

    el.libraryList.innerHTML = "";

    const allFolders = folders;
    const buildFolderCard = (f, recurse = true, reorderCtx = null) => {
        const card = document.createElement("div");
        card.className = "folder-card";
        const coverStyle = f.cover ? `style="background-image:url('${f.cover}')"` : "";
        const childFolders = allFolders.filter(c => (c.parent || "") === f.id);
        const subCount = childFolders.length;
        const countTitlesDeep = (fld) => {
            const keys = new Set();
            const visited = new Set();
            const walk = (x) => {
                if (!x || visited.has(x.id)) return;
                visited.add(x.id);
                (x.items || []).forEach(it => { if (it && it.key) keys.add(it.key); });
                allFolders.filter(c => (c.parent || "") === x.id).forEach(walk);
            };
            walk(fld);
            return keys.size;
        };
        const oldestDateDeep = (fld) => {
            let best = "";
            const seen = new Set();
            const walk = (x) => {
                if (!x || seen.has(x.id)) return;
                seen.add(x.id);
                (x.items || []).forEach(it => { const d = (it && it.release_date) || ""; if (d && (!best || d < best)) best = d; });
                allFolders.filter(c => (c.parent || "") === x.id).forEach(walk);
            };
            walk(fld);
            return best;
        };
        const countTxt = `${countTitlesDeep(f)} titoli${subCount ? ` \u00b7 ${subCount} sottocartelle` : ""}`;
        const parentOpts = ['<option value="">\u2014 in radice \u2014</option>'].concat(
            allFolders.filter(o => o.id !== f.id)
                      .map(o => `<option value="${o.id}"${(f.parent || "") === o.id ? " selected" : ""}>${escapeHtml(o.name)}</option>`)
        ).join("");
        const _rlen = reorderCtx ? (reorderCtx.tokens ? reorderCtx.tokens.length : (reorderCtx.list ? reorderCtx.list.length : 0)) : 0;
        const folderMoveBtns = reorderCtx ? `<button class="icon-btn folder-moveup" title="Sposta a sinistra"${reorderCtx.index === 0 ? " disabled" : ""}>‹</button><button class="icon-btn folder-movedown" title="Sposta a destra"${reorderCtx.index >= _rlen - 1 ? " disabled" : ""}>›</button>` : "";
        card.innerHTML = `
            <div class="folder-head">
                <div class="folder-cover ${f.cover ? "" : "placeholder"}" ${coverStyle}></div>
                <div class="folder-meta">
                    <span class="folder-name">${escapeHtml(f.name)}${f.kind ? ` <span class="folder-kind-badge">${escapeHtml(f.kind)}</span>` : ""}</span>
                    <span class="folder-count">${countTxt}</span>
                </div>
                <div class="folder-actions">
                    ${folderMoveBtns}
                    <button class="icon-btn folderfav-btn" title="${f.favorite ? "Togli dai preferiti" : "Aggiungi ai preferiti"}">${f.favorite ? "★" : "☆"}</button>
                    <select class="folder-parent-select custom-select" title="Sposta in un'altra cartella">${parentOpts}</select>
                    <select class="folder-kind-select custom-select" title="Tipologia cartella">
                        <option value="">tipo…</option>
                        <option value="genere">Genere</option>
                        <option value="regista">Regista</option>
                        <option value="saga">Saga</option>
                        ${[...new Set([...(customFilters || []), f.kind].filter(k => k && !["genere","regista","saga"].includes(k)))]
                            .map(k => `<option value="${escapeHtml(k)}">${escapeHtml(k)}</option>`).join("")}
                        <option value="__custom__">+ Filtro personalizzato</option>
                    </select>
                    <button class="icon-btn subf-btn" title="Nuova sottocartella">📁+</button>
                    <button class="icon-btn adddom-btn" title="Aggiungi titoli dalla libreria">➕</button>
                    <label class="icon-btn" title="Imposta/Cambia locandina">🖼️<input type="file" accept="image/*" class="cover-input" hidden></label>
                    <button class="icon-btn ren-btn" title="Rinomina">✎</button>
                    <button class="icon-btn delf-btn" title="Elimina cartella">✕</button>
                    <button class="icon-btn toggle-btn" title="Mostra/Nascondi">▾</button>
                </div>
            </div>
            <div class="folder-domains${openFolders.has(f.id) ? "" : " hidden"}"></div>`;
        const body = card.querySelector(".folder-domains");
        const _fst = folderFilters.get(f.id) || { type: "", order: "" };
        if ((f.items || []).length) {
            const fbar = document.createElement("div");
            fbar.className = "folder-filterbar";
            fbar.innerHTML = `
                <input type="text" class="ff-search" placeholder="Cerca in questa cartella…" autocomplete="off" spellcheck="false">
                <select class="ff-type custom-select" title="Filtra per tipo">
                    <option value="">Tutti</option>
                    <option value="movie">Film</option>
                    <option value="tv">Serie</option>
                </select>
                <select class="ff-order custom-select" title="Ordina">
                    <option value="">Rilevanza</option>
                    <option value="recent">Uscita recente</option>
                    <option value="oldest">Meno recente</option>
                </select>`;
            fbar.addEventListener("click", (e) => e.stopPropagation());
            const tSel = fbar.querySelector(".ff-type"); tSel.value = _fst.type;
            const oSel = fbar.querySelector(".ff-order"); oSel.value = _fst.order;
            tSel.addEventListener("change", () => { const st = folderFilters.get(f.id) || { type: "", order: "" }; st.type = tSel.value; folderFilters.set(f.id, st); renderLibrary(lastLibraryData); });
            oSel.addEventListener("change", () => { const st = folderFilters.get(f.id) || { type: "", order: "" }; st.order = oSel.value; folderFilters.set(f.id, st); renderLibrary(lastLibraryData); });
            const fsr = fbar.querySelector(".ff-search");
            if (fsr) fsr.addEventListener("input", () => {
                const q = fsr.value.trim().toLowerCase();
                body.querySelectorAll(":scope > .library-item").forEach(r => {
                    const nm = r.querySelector(".library-name");
                    r.style.display = (!q || (nm && nm.textContent.toLowerCase().includes(q))) ? "" : "none";
                });
                body.querySelectorAll(":scope > .folder-card").forEach(fcard => {
                    const nm = fcard.querySelector(".folder-name");
                    let match = !q || (nm && nm.textContent.toLowerCase().includes(q));
                    if (!match) fcard.querySelectorAll(".library-name").forEach(t => { if (t.textContent.toLowerCase().includes(q)) match = true; });
                    fcard.style.display = match ? "" : "none";
                });
            });
            body.appendChild(fbar);
        }
        const toggleFolder = () => {
            body.classList.toggle("hidden");
            if (body.classList.contains("hidden")) openFolders.delete(f.id);
            else openFolders.add(f.id);
        };
        // Sottocartelle + titoli MISCHIATI e ordinati insieme secondo i filtri.
        const subEntries = (recurse ? childFolders : []).map(c => ({ kind: "folder", date: oldestDateDeep(c), c }));
        let titleItems = f.items || [];
        if (_fst.type) titleItems = titleItems.filter(it => (it.type || "") === _fst.type);
        const keys = (f.items || []).map(i => i.key);
        const defaultView = !_fst.type && !_fst.order;
        const titleEntries = titleItems.map(it => ({ kind: "title", date: (it.release_date || ""), it }));
        let merged;
        if (_fst.order === "recent") {
            merged = subEntries.concat(titleEntries).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
        } else if (_fst.order === "oldest") {
            merged = subEntries.concat(titleEntries).sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));
        } else {
            // default: titoli in ordine manuale, sottocartelle interpolate per data (più vecchia dentro)
            const subs = subEntries.slice().sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));
            merged = []; let si = 0;
            titleEntries.forEach(te => {
                const td = te.date || "9999";
                while (si < subs.length && (subs[si].date || "9999") <= td) merged.push(subs[si++]);
                merged.push(te);
            });
            while (si < subs.length) merged.push(subs[si++]);
            // ordine manuale combinato salvato (titoli + sottocartelle)
            const tokenOf = (en) => en.kind === "folder" ? ("f:" + en.c.id) : en.it.key;
            if (f.order && f.order.length) {
                const pos = {}; f.order.forEach((t, i) => { pos[t] = i; });
                merged = merged.slice().sort((a, b) => {
                    const pa = pos[tokenOf(a)], pb = pos[tokenOf(b)];
                    if (pa == null && pb == null) return 0;
                    if (pa == null) return 1;
                    if (pb == null) return -1;
                    return pa - pb;
                });
            }
        }
        const seqTokens = merged.map(en => en.kind === "folder" ? ("f:" + en.c.id) : en.it.key);
        if (!merged.length) {
            const empty = document.createElement("div");
            empty.className = "no-downloads";
            empty.textContent = "Cartella vuota. Usa \u2795 per i titoli o \uD83D\uDCC1+ per una sottocartella.";
            body.appendChild(empty);
        } else {
            merged.forEach((e, i) => {
                if (e.kind === "folder") {
                    body.appendChild(buildFolderCard(e.c, true, { folderId: f.id, tokens: seqTokens, index: i }));
                } else {
                    body.appendChild(titleRow(e.it, { folderId: f.id, combined: true, tokens: seqTokens, index: i }));
                }
            });
        }
        card.querySelector(".folder-head").addEventListener("click", (e) => {
            if (e.target.closest(".folder-actions")) return;
            toggleFolder();
        });
        card.querySelector(".subf-btn").addEventListener("click", (e) => { e.stopPropagation(); createSubfolder(f.id); });
        card.querySelector(".adddom-btn").addEventListener("click", (e) => { e.stopPropagation(); openFolderPicker(f.id); });
        card.querySelector(".cover-input").addEventListener("change", (e) => uploadFolderCover(f.id, e.target));
        card.querySelector(".ren-btn").addEventListener("click", (e) => { e.stopPropagation(); renameFolder(f.id, f.name); });
        card.querySelector(".delf-btn").addEventListener("click", (e) => { e.stopPropagation(); removeFolder(f.id, f.name); });
        card.querySelector(".toggle-btn").addEventListener("click", (e) => { e.stopPropagation(); toggleFolder(); });
        const favBtn = card.querySelector(".folderfav-btn");
        if (favBtn) favBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleFolderFavorite(f.id); });
        if (reorderCtx) {
            const fu = card.querySelector(".folder-moveup"), fdn = card.querySelector(".folder-movedown");
            const _fmv = (delta) => { if (reorderCtx.root) reorderRoot(reorderCtx.list, reorderCtx.index, delta); else reorderCombined(reorderCtx.folderId, reorderCtx.tokens, reorderCtx.index, delta); };
            if (fu && !fu.disabled) fu.addEventListener("click", (e) => { e.stopPropagation(); _fmv(-1); });
            if (fdn && !fdn.disabled) fdn.addEventListener("click", (e) => { e.stopPropagation(); _fmv(1); });
        }
        const kindSel = card.querySelector(".folder-kind-select");
        kindSel.value = f.kind || "";
        kindSel.addEventListener("click", (e) => e.stopPropagation());
        kindSel.addEventListener("change", (e) => {
            e.stopPropagation();
            if (e.target.value === "__custom__") {
                const name = prompt("Nome del nuovo filtro:", f.kind || "");
                if (name && name.trim()) setFolderKind(f.id, name.trim());
                else e.target.value = f.kind || "";
            } else {
                setFolderKind(f.id, e.target.value);
            }
        });
        const parSel = card.querySelector(".folder-parent-select");
        parSel.addEventListener("click", (e) => e.stopPropagation());
        parSel.addEventListener("change", (e) => { e.stopPropagation(); moveFolderParent(f.id, e.target.value); });
        card.draggable = true;
        card.addEventListener("dragstart", (e) => {
            e.stopPropagation();
            e.dataTransfer.setData("application/json", JSON.stringify({ src: "folder", id: f.id }));
            e.dataTransfer.effectAllowed = "move";
            card.classList.add("dragging");
        });
        card.addEventListener("dragend", () => card.classList.remove("dragging"));
        card.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; card.classList.add("folder-drag-over"); });
        card.addEventListener("dragleave", (e) => { if (!card.contains(e.relatedTarget)) card.classList.remove("folder-drag-over"); });
        card.addEventListener("drop", async (e) => {
            e.preventDefault(); e.stopPropagation(); card.classList.remove("folder-drag-over");
            let data; try { data = JSON.parse(e.dataTransfer.getData("application/json")); } catch (err) { return; }
            if (reorderCtx && reorderCtx.tokens) {
                if (await combinedDropReorder(reorderCtx.folderId, reorderCtx.tokens, "f:" + f.id, data)) return;
            }
            if (data.src === "folder") {
                if (data.id && data.id !== f.id) {
                    const dragged = allFolders.find(x => x.id === data.id);
                    if (dragged && (dragged.parent || "") === (f.parent || "")) await reorderFolder(data.id, f.id);
                    else await nestFolder(data.id, f.id);
                }
            } else {
                await handleFolderAdd(f.id, data);
            }
        });
        return card;
    };

    // Search mode: flat list of matching titles, folder structure hidden.
    const q = (librarySearch || "").trim().toLowerCase();
    const fType = librarySearchType || "";
    const fOrder = librarySearchOrder || "";
    if (q || fType || fOrder) {
        let titleResults = allTitles.filter(it => (it.name || "").toLowerCase().includes(q));
        titleResults = applyFolderView(titleResults, { type: fType, order: fOrder });
        const folderResults = q ? folders.filter(f =>
            (f.name || "").toLowerCase().includes(q) || (f.kind || "").toLowerCase().includes(q)) : [];

        if (folderResults.length) {
            const ft = document.createElement("div");
            ft.className = "domains-subtitle";
            ft.textContent = `Cartelle (${folderResults.length})`;
            el.libraryList.appendChild(ft);
            folderResults.forEach(f => el.libraryList.appendChild(buildFolderCard(f, true)));
        }

        const tt = document.createElement("div");
        tt.className = "domains-subtitle";
        tt.textContent = `Titoli (${titleResults.length})`;
        el.libraryList.appendChild(tt);
        if (!titleResults.length) {
            const none = document.createElement("div");
            none.className = "no-downloads";
            none.textContent = "Nessun titolo trovato.";
            el.libraryList.appendChild(none);
        } else {
            titleResults.forEach(it => el.libraryList.appendChild(titleRow(it)));
        }

        if (!folderResults.length && !titleResults.length) {
            const none = document.createElement("div");
            none.className = "no-downloads";
            none.textContent = "Nessun risultato.";
            el.libraryList.appendChild(none);
        }
        window.scrollTo({ top: scrollY });
        return;
    }


    // Drop-zone "radice": trascina qui una cartella per portarla fuori da ogni
    // cartella genitore (oppure trascina una cartella su un'altra per annidarla).
    const rootZone = document.createElement("div");
    rootZone.className = "root-dropzone";
    rootZone.textContent = "Trascina qui una cartella per portarla in radice";
    rootZone.addEventListener("dragover", (e) => { e.preventDefault(); rootZone.classList.add("drag-over"); });
    rootZone.addEventListener("dragleave", () => rootZone.classList.remove("drag-over"));
    rootZone.addEventListener("drop", async (e) => {
        e.preventDefault(); rootZone.classList.remove("drag-over");
        let data; try { data = JSON.parse(e.dataTransfer.getData("application/json")); } catch (err) { return; }
        if (data.src === "folder" && data.id) await nestFolder(data.id, "");
    });
    el.libraryList.appendChild(rootZone);

    // Favourites shortcut (always shown, persists across sessions)
    const favs = libraryCache.filter(it => it && it.favorite);
    const favFolders = folders.filter(f => f && f.favorite);
    if (favs.length || favFolders.length) {
        const favBlock = document.createElement("div");
        favBlock.className = "fav-block";
        const favTitle = document.createElement("div");
        favTitle.className = "domains-subtitle fav-subtitle";
        favTitle.textContent = "★ Preferiti";
        favBlock.appendChild(favTitle);
        favs.forEach(it => favBlock.appendChild(titleRow(it)));
        // le cartelle preferite mostrano anche le loro sottocartelle (recurse)
        favFolders.forEach(f => favBlock.appendChild(buildFolderCard(f, true)));
        el.libraryList.appendChild(favBlock);
    }

    const rootFolders = folders.filter(f => !(f.parent || ""));

    // Tre gruppi collassabili che raccolgono le cartelle per tipologia (kind).
    const buildCategoryGroup = (label, kindKey, list, icon, options = {}) => {
        const wrap = document.createElement("div");
        wrap.className = "cat-group";
        const open = !closedGroups.has(kindKey);
        const head = document.createElement("div");
        head.className = "cat-head" + (open ? " open" : "");
        const coverThumb = options.custom
            ? (options.cover
                ? `<span class="cat-cover" style="background-image:url('${options.cover}')"></span>`
                : `<span class="cat-cover placeholder"></span>`)
            : "";
        const coverBtn = options.custom
            ? `<label class="icon-btn cat-cover-btn" title="Locandina filtro">🖼️<input type="file" accept="image/*" class="cat-cover-input" hidden></label>`
            : "";
        const editBtn = options.custom
            ? `<button class="icon-btn cat-edit-btn" title="Rinomina filtro" type="button">✎</button>`
              + `<button class="icon-btn cat-del-btn" title="Elimina filtro" type="button">🗑</button>`
            : "";
        const dispLabel = _catLabel(kindKey, label);
        const delBtn = options.custom ? '<button class="icon-btn cat-del-btn" title="Elimina categoria" type="button">✕</button>' : "";
        head.innerHTML = `<span class="cat-title">${escapeHtml(dispLabel)}</span>`
            + `<span class="cat-count">${list.length}</span>${delBtn}<span class="cat-chevron">▾</span>`;
        const body = document.createElement("div");
        body.className = "cat-body" + (open ? "" : " hidden");
        if (!list.length) {
            const none = document.createElement("div");
            none.className = "no-downloads";
            none.textContent = "Nessuna cartella qui. Imposta il tipo di una cartella per raccoglierla in questo gruppo.";
            body.appendChild(none);
        } else {
            list.forEach((f, i) => body.appendChild(buildFolderCard(f, true, { root: true, list, index: i })));
        }
        head.addEventListener("click", () => {
            const hidden = body.classList.toggle("hidden");
            head.classList.toggle("open", !hidden);
            if (hidden) closedGroups.add(kindKey); else closedGroups.delete(kindKey);
        });
        const edit = head.querySelector(".cat-edit-btn");
        if (edit) edit.addEventListener("click", (e) => {
            e.stopPropagation();
            renameCustomFilter(kindKey);
        });
        head.addEventListener("dblclick", (e) => { e.stopPropagation(); editCategoryTitle(kindKey, !!options.custom, dispLabel); });
        const del = head.querySelector(".cat-del-btn");
        if (del) del.addEventListener("click", (e) => {
            e.stopPropagation();
            deleteCustomFilter(kindKey, list.length);
        });
        const coverLbl = head.querySelector(".cat-cover-btn");
        if (coverLbl) coverLbl.addEventListener("click", (e) => e.stopPropagation());
        const coverInput = head.querySelector(".cat-cover-input");
        if (coverInput) coverInput.addEventListener("change", (e) => { e.stopPropagation(); uploadFilterCover(kindKey, e.target); });
        // Tile "+" in fondo alla categoria per aggiungere una nuova voce (cartella
        // di questa tipologia) — invita a organizzare.
        const addTile = document.createElement("div");
        addTile.className = "folder-card add-tile";
        addTile.innerHTML = '<div class="folder-head"><div class="folder-cover placeholder add-plus">+</div><div class="folder-meta"><span class="folder-name">Aggiungi</span></div></div>';
        addTile.addEventListener("click", () => addFolderToCategory(kindKey));
        body.appendChild(addTile);
        wrap.appendChild(head);
        wrap.appendChild(body);
        return wrap;
    };

    const byKind = (k) => rootFolders.filter(f => (f.kind || "") === k);
    [["Saghe", "saga", "🎬"], ["Registi", "regista", "🎥"], ["Generi", "genere", "🏷️"]]
        .forEach(([label, key, icon]) => el.libraryList.appendChild(buildCategoryGroup(label, key, byKind(key), icon)));
    // Filtri personalizzati: subito SOTTO i tre gruppi predefiniti (come 4°, 5°…).
    [...new Set([...(customFilters || []), ...rootFolders.map(f => f.kind || "")]
        .filter(k => k && !["saga", "regista", "genere"].includes(k)))]
        .sort()
        .forEach(k => el.libraryList.appendChild(buildCategoryGroup(k.charAt(0).toUpperCase() + k.slice(1), k, byKind(k), "▣", { custom: true, cover: filterCovers[k] || "" })));
    const newCatTile = document.createElement("div");
    newCatTile.className = "folder-card add-tile new-cat";
    newCatTile.innerHTML = '<div class="folder-head"><div class="folder-cover placeholder add-plus">+</div><div class="folder-meta"><span class="folder-name">Nuova categoria</span></div></div>';
    newCatTile.addEventListener("click", createCustomFilter);
    el.libraryList.appendChild(newCatTile);

    const uncategorized = rootFolders.filter(f => !(f.kind || ""));
    if (uncategorized.length) {
        const restTitle = document.createElement("div");
        restTitle.className = "domains-subtitle lib-rest-title";
        restTitle.textContent = "Altre cartelle";
        el.libraryList.appendChild(restTitle);
        uncategorized.forEach((f, i) => el.libraryList.appendChild(buildFolderCard(f, true, { root: true, list: uncategorized, index: i })));
    }

    // La libreria mostra SOLO preferiti e cartelle: i titoli solo aperti non
    // vengono ricordati. Se non c'e' nulla di salvato, mostra un suggerimento.
    if (!favs.length && !favFolders.length && !rootFolders.length) {
        const none = document.createElement("div");
        none.className = "no-downloads";
        none.textContent = "Libreria vuota. Salva i titoli nei preferiti (★) o in una cartella per ritrovarli qui.";
        el.libraryList.appendChild(none);
    }

    // Disney+-style: raggruppa le tile (titoli/cartelle) in righe a scorrimento
    // orizzontale. Sicuro: tocca solo Preferiti e i gruppi categoria, NON i
    // contenuti interni delle cartelle (la ricerca per cartella resta intatta).
    carouselizeLibrary();
    renderHeroBillboard();
    renderContinueWatching();

    // Restore the scroll position so actions don't feel like a page reload.
    window.scrollTo({ top: scrollY });
}

function _wrapTileRuns(container) {
    if (!container) return;
    const isTile = (k) => k.nodeType === 1 && k.classList &&
        (k.classList.contains("library-item") || k.classList.contains("folder-card") || k.classList.contains("download-item"));
    let run = [];
    const flush = () => {
        if (run.length) {
            const row = document.createElement("div");
            row.className = "disney-row";
            container.insertBefore(row, run[0]);
            run.forEach(x => row.appendChild(x));
        }
        run = [];
    };
    [...container.childNodes].forEach(k => { if (isTile(k)) run.push(k); else flush(); });
    flush();
}
function carouselizeLibrary() {
    if (!el.libraryList) return;
    _wrapTileRuns(el.libraryList);
    el.libraryList.querySelectorAll(".fav-block, .cat-body").forEach(_wrapTileRuns);
}
function carouselizeDownloads() {
    // Solo su PC: su mobile i download hanno gia' il loro layout a locandine.
    if (!el.downloadsList || document.body.classList.contains("downloads-only")) return;
    _wrapTileRuns(el.downloadsList);
    el.downloadsList.querySelectorAll(".download-folder-body").forEach(_wrapTileRuns);
}

let _hbItems = [], _hbIdx = 0, _hbTimer = null, _hbSig = "";
function _hbBuildList() {
    const out = [], seen = new Set();
    const push = (name, cover, type, rd, open) => {
        // Serie: mostra SOLO la serie (non i singoli episodi).
        const ep = (typeof parseEpisode === "function") ? parseEpisode(name || "") : null;
        const disp = (ep && ep.series) ? ep.series : (name || "");
        const k = normName(disp); if (!disp || !cover || seen.has(k)) return;
        seen.add(k); out.push({ name: disp, cover: cover, type: (ep ? "tv" : (type || "")), rd: rd || "", open: open });
    };
    // Preferiti in evidenza
    (libraryCache || []).forEach(t => { if (t.favorite) push(t.name, t.cover, t.type, t.release_date, () => openFromLibrary(t)); });
    // Download completati
    (localDownloads || []).forEach(d => { if (d.cover) push(d.title, d.cover, "", "", () => playDownloaded(d.id, d.title, d.key)); });
    // Fallback: se non ci sono preferiti, mostra i primi titoli con locandina
    if (out.length < 2) (libraryCache || []).forEach(t => { if (out.length < 8) push(t.name, t.cover, t.type, t.release_date, () => openFromLibrary(t)); });
    return out.slice(0, 12);
}
function renderHeroBillboard() {
    const host = document.getElementById("hero-billboard");
    if (!host || document.body.classList.contains("downloads-only")) return;
    const items = _hbBuildList();
    const sig = items.map(i => i.name).join("|");
    if (sig === _hbSig && host.querySelector(".hb-content")) return;  // niente cambiato: non resettare lo slideshow
    _hbSig = sig;
    _hbItems = items;
    if (_hbTimer) { clearInterval(_hbTimer); _hbTimer = null; }
    if (!items.length) { host.classList.add("hidden"); host.innerHTML = ""; return; }
    host.classList.remove("hidden");
    if (_hbIdx >= items.length) _hbIdx = 0;
    _hbRender(host, false);
    _hbRestart(host);
}
function _hbRestart(host) {
    if (_hbTimer) { clearInterval(_hbTimer); _hbTimer = null; }
    if (_hbItems.length > 1) _hbTimer = setInterval(() => { _hbIdx = (_hbIdx + 1) % _hbItems.length; _hbRender(host, true); }, 4500);
}
function _hbRender(host, animate) {
    const feat = _hbItems[_hbIdx]; if (!feat) return;
    const cover = escapeHtml(feat.cover || "");
    const yr = feat.rd ? String(feat.rd).slice(0, 4) : "";
    const kind = feat.type === "tv" ? "Serie" : (feat.type === "movie" ? "Film" : "");
    const a = animate ? " hb-anim" : "";
    const dots = _hbItems.map((_, i) => `<span class="hb-dot${i === _hbIdx ? " on" : ""}" data-i="${i}"></span>`).join("");
    host.innerHTML =
        `<div class="hb-bg${a}" style="background-image:url('${cover}')"></div>` +
        `<div class="hb-poster${a}"><img src="${cover}" alt="" loading="lazy"></div>` +
        `<div class="hb-shade"></div>` +
        `<div class="hb-content${a}">` +
            `<div class="hb-badge">In evidenza</div>` +
            `<h2 class="hb-title">${escapeHtml(feat.name || "")}</h2>` +
            `<div class="hb-meta">${kind}${yr ? " · " + escapeHtml(yr) : ""}</div>` +
            `<div class="hb-actions">` +
                `<button class="primary-btn hb-play">▶ Riproduci</button>` +
                `<button class="secondary-btn hb-info">Dettagli</button>` +
            `</div>` +
        `</div>` +
        (_hbItems.length > 1 ? `<button class="hb-arrow hb-prev" aria-label="Precedente">‹</button><button class="hb-arrow hb-next" aria-label="Successivo">›</button><div class="hb-dots">${dots}</div>` : "");
    host.querySelector(".hb-play").addEventListener("click", feat.open);
    host.querySelector(".hb-info").addEventListener("click", feat.open);
    host.querySelectorAll(".hb-dot").forEach(d => d.addEventListener("click", () => {
        _hbIdx = parseInt(d.getAttribute("data-i"), 10) || 0; _hbRender(host, true); _hbRestart(host);
    }));
    const _prev = host.querySelector(".hb-prev"), _next = host.querySelector(".hb-next");
    if (_prev) _prev.addEventListener("click", () => { _hbIdx = (_hbIdx - 1 + _hbItems.length) % _hbItems.length; _hbRender(host, true); _hbRestart(host); });
    if (_next) _next.addEventListener("click", () => { _hbIdx = (_hbIdx + 1) % _hbItems.length; _hbRender(host, true); _hbRestart(host); });
}

function openFromLibrary(item) {
    showToast(`Apertura: ${item.name || "titolo"}…`);
    resolveDirectUrl(item.url, item.name || "");
}

async function toggleFavorite(key) {
    try {
        const r = await fetch("/api/library/favorite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) });
        if (r.ok) await fetchLibrary();
    } catch (e) { showToast("Errore aggiornamento preferito"); }
}

async function removeFromLibrary(key, name) {
    if (!confirm(`Rimuovere "${name || "questo titolo"}" dalla libreria?`)) return;
    try {
        const r = await fetch("/api/library/remove", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) });
        if (r.ok) await fetchLibrary();
    } catch (e) { showToast("Errore rimozione dalla libreria"); }
}

async function renameInFolder(folderId, key, current) {
    const name = prompt("Nome del titolo in QUESTA cartella (vuoto = nome originale):", current || "");
    if (name === null) return;
    try {
        const r = await fetch("/api/folders/rename-item", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: folderId, key, name: name.trim() })
        });
        if (r.ok) { renderLibrary(await r.json()); showToast("Rinominato in questa cartella"); }
        else if (r.status === 404) showToast("Funzione non disponibile: chiudi e RIAVVIA SC Portal (versione vecchia in esecuzione).");
        else showToast("Errore rinomina (" + r.status + ")");
    } catch (e) { showToast("Errore rinomina"); }
}

async function renameTitle(key, current) {
    const name = prompt("Nuovo nome del titolo:", current || "");
    if (name === null) return;
    try {
        const r = await fetch("/api/library/rename", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, name }) });
        if (r.ok) await fetchLibrary();
    } catch (e) { showToast("Errore rinomina titolo"); }
}

function uploadTitleCover(key, input) {
    const file = input.files && input.files[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { showToast("Immagine troppo grande (max 8MB)"); return; }
    const reader = new FileReader();
    reader.onload = async () => {
        try {
            const r = await fetch("/api/library/cover", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, filename: file.name, data: reader.result }) });
            if (r.ok) { await fetchLibrary(); showToast("Locandina del titolo aggiornata"); }
            else { const e = await r.json().catch(() => ({})); showToast(e.detail || "Errore caricamento immagine"); }
        } catch (e) { showToast("Errore caricamento immagine"); }
    };
    reader.readAsDataURL(file);
}

async function createFolder() {
    const name = prompt("Nome della nuova cartella:");
    if (name === null) return;
    try {
        const r = await fetch("/api/folders/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
        if (r.ok) renderLibrary(await r.json());
    } catch (e) { showToast("Errore creazione cartella"); }
}

function normalizeCustomFilterName(value) {
    return String(value || "").trim().toLowerCase().replace(/\s+/g, " ").replace(/[<>]/g, "").slice(0, 40);
}

function _catLabels() { try { return JSON.parse(localStorage.getItem("scp_catlabels") || "{}"); } catch (e) { return {}; } }
function _catLabel(kind, def) { const m = _catLabels(); return (m[kind] != null && m[kind] !== "") ? m[kind] : def; }
function _setCatLabel(kind, label) { const m = _catLabels(); if (label && label.trim()) m[kind] = label.trim(); else delete m[kind]; try { localStorage.setItem("scp_catlabels", JSON.stringify(m)); } catch (e) {} }
function editCategoryTitle(kind, isCustom, current) {
    const name = prompt("Titolo della categoria:", current || "");
    if (name === null) return;
    _setCatLabel(kind, name);
    if (lastLibraryData) renderLibrary(lastLibraryData);
}

async function createCustomFilter() {
    const raw = prompt("Nome del nuovo filtro personalizzato:");
    if (raw === null) return;
    const kind = normalizeCustomFilterName(raw);
    if (!kind) {
        showToast("Inserisci un nome valido");
        return;
    }
    try {
        const r = await fetch("/api/filters/create", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: kind })
        });
        if (r.ok) {
            localCustomFilters.add(kind);
            closedGroups.delete(kind);
            const data = await r.json();
            if (!((data.custom_filters || []).includes(kind))) data.custom_filters = [...(data.custom_filters || []), kind];
            if (lastLibraryData) {
                lastLibraryData.custom_filters = [...new Set([...(lastLibraryData.custom_filters || []), kind])];
            }
            renderLibrary(data);
            showToast("Filtro personalizzato creato");
        } else {
            const e = await r.json().catch(() => ({}));
            showToast(e.detail || "Errore creazione filtro");
        }
    } catch (e) { showToast("Errore creazione filtro"); }
}

async function renameCustomFilter(oldKind) {
    const raw = prompt("Nuovo nome del filtro:", oldKind || "");
    if (raw === null) return;
    const kind = normalizeCustomFilterName(raw);
    if (!kind) {
        showToast("Inserisci un nome valido");
        return;
    }
    if (kind === oldKind) return;
    try {
        const r = await fetch("/api/filters/rename", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ old: oldKind, name: kind })
        });
        if (r.ok) {
            localCustomFilters.delete(oldKind);
            localCustomFilters.add(kind);
            if (openGroups.has(oldKind)) {
                closedGroups.delete(oldKind);
                closedGroups.delete(kind);
            }
            renderLibrary(await r.json());
            showToast("Filtro aggiornato");
        } else {
            const e = await r.json().catch(() => ({}));
            showToast(e.detail || "Errore modifica filtro");
        }
    } catch (e) { showToast("Errore modifica filtro"); }
}

async function deleteCustomFilter(kind, count) {
    const msg = count
        ? `Eliminare il filtro "${kind}"? Le ${count} cartelle che lo usano non verranno cancellate: torneranno in "Altre cartelle".`
        : `Eliminare il filtro "${kind}"?`;
    if (!confirm(msg)) return;
    try {
        const r = await fetch("/api/filters/delete", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: kind })
        });
        if (r.ok) {
            localCustomFilters.delete(kind);
            closedGroups.delete(kind);
            if (lastLibraryData) {
                lastLibraryData.custom_filters = (lastLibraryData.custom_filters || []).filter(k => k !== kind);
            }
            renderLibrary(await r.json());
            showToast("Filtro eliminato");
        } else if (r.status === 404) {
            showToast("Funzione non disponibile: chiudi e RIAVVIA SC Portal (versione vecchia in esecuzione).");
        } else {
            const e = await r.json().catch(() => ({}));
            showToast(e.detail || "Errore eliminazione filtro");
        }
    } catch (e) { showToast("Errore eliminazione filtro"); }
}

function uploadFilterCover(kind, input) {
    const file = input.files && input.files[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { showToast("Immagine troppo grande (max 8MB)"); return; }
    const reader = new FileReader();
    reader.onload = async () => {
        try {
            const r = await fetch("/api/filters/cover", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: kind, filename: file.name, data: reader.result })
            });
            if (r.ok) { renderLibrary(await r.json()); showToast("Locandina del filtro aggiornata"); }
            else if (r.status === 404) showToast("Funzione non disponibile: chiudi e RIAVVIA SC Portal.");
            else { const e = await r.json().catch(() => ({})); showToast(e.detail || "Errore caricamento immagine"); }
        } catch (e) { showToast("Errore caricamento immagine"); }
    };
    reader.readAsDataURL(file);
}

async function createSubfolder(parentId) {
    const name = prompt("Nome della nuova sottocartella:");
    if (name === null) return;
    try {
        const r = await fetch("/api/folders/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, parent: parentId }) });
        if (r.ok) { openFolders.add(parentId); renderLibrary(await r.json()); }
    } catch (e) { showToast("Errore creazione sottocartella"); }
}

async function moveFolderParent(id, parent) {
    try {
        const r = await fetch("/api/folders/parent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, parent }) });
        if (r.ok) { if (parent) openFolders.add(parent); renderLibrary(await r.json()); }
        else { const e = await r.json().catch(() => ({})); showToast(e.detail || "Spostamento non valido"); if (lastLibraryData) renderLibrary(lastLibraryData); }
    } catch (e) { showToast("Errore spostamento cartella"); }
}

async function renameFolder(id, current) {
    const name = prompt("Nuovo nome della cartella:", current || "");
    if (name === null) return;
    try {
        const r = await fetch("/api/folders/rename", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, name }) });
        if (r.ok) renderLibrary(await r.json());
    } catch (e) { showToast("Errore rinomina cartella"); }
}

async function removeFolder(id, name) {
    if (!confirm(`Eliminare la cartella "${name || ""}"? I titoli restano nella libreria (senza cartella).`)) return;
    try {
        const r = await fetch("/api/folders/remove", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
        if (r.ok) renderLibrary(await r.json());
    } catch (e) { showToast("Errore eliminazione cartella"); }
}

async function addFolderToCategory(kind) {
    const name = prompt("Nome della nuova voce" + (kind ? " (" + kind + ")" : "") + " — es. il titolo, la serie o il regista:");
    if (name === null || !name.trim()) return;
    try {
        const r = await fetch("/api/folders/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() }) });
        if (!r.ok) { showToast("Errore nella creazione"); return; }
        const data = await r.json();
        const created = (data.folders || []).filter(x => (x.name || "").trim() === name.trim()).pop();
        if (created && kind) { closedGroups.delete(kind); await setFolderKind(created.id, kind); }
        else { renderLibrary(data); }
        showToast("Creata: " + name.trim());
    } catch (e) { showToast("Errore nella creazione"); }
}

async function setFolderKind(id, kind) {
    try {
        const r = await fetch("/api/folders/kind", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, kind }) });
        if (r.ok) renderLibrary(await r.json());
    } catch (e) { showToast("Errore tipologia cartella"); }
}

function uploadFolderCover(id, input) {
    const file = input.files && input.files[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { showToast("Immagine troppo grande (max 8MB)"); return; }
    const reader = new FileReader();
    reader.onload = async () => {
        try {
            const r = await fetch("/api/folders/cover", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, filename: file.name, data: reader.result }) });
            if (r.ok) { renderLibrary(await r.json()); showToast("Locandina aggiornata"); }
            else { const e = await r.json().catch(() => ({})); showToast(e.detail || "Errore caricamento immagine"); }
        } catch (e) { showToast("Errore caricamento immagine"); }
    };
    reader.readAsDataURL(file);
}

async function openTitleFolderPicker(item) {
    let data;
    try { data = await (await fetch("/api/folders")).json(); }
    catch (e) { showToast("Errore caricamento cartelle"); return; }
    let folders = data.folders || [];
    const overlay = document.createElement("div");
    overlay.className = "picker-overlay";
    const rows = folders.map(f => {
        const inIt = (f.items || []).some(it => it.key === item.key);
        const kindB = f.kind ? ` <span class="picker-note">${escapeHtml(f.kind)}</span>` : "";
        return `<label class="picker-row">
            <input type="checkbox" data-fid="${f.id}" ${inIt ? "checked" : ""}>
            <span>${escapeHtml(f.name || "Cartella")}</span>${kindB}
        </label>`;
    }).join("");
    overlay.innerHTML = `
        <div class="picker-panel glass">
            <h3>Metti "${escapeHtml(item.name || "titolo")}" nelle cartelle</h3>
            <p class="picker-hint">Spunta le cartelle in cui mettere il titolo (può stare in più cartelle).</p>
            <input type="text" class="picker-search" placeholder="Cerca una cartella…" autocomplete="off" spellcheck="false">
            <div class="picker-list">${rows || '<div class="no-downloads">Nessuna cartella. Creane una con \"+ Nuova cartella\".</div>'}</div>
            <div class="picker-actions"><button class="secondary-btn picker-close">Chiudi</button></div>
        </div>`;
    document.body.appendChild(overlay);
    let changed = false;
    const close = () => { overlay.remove(); if (changed) fetchLibrary(); };
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    overlay.querySelector(".picker-close").addEventListener("click", close);
    overlay.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener("change", async () => {
            changed = true;
            try {
                const r = await fetch("/api/folders/toggle", {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ id: cb.dataset.fid, key: item.key })
                });
                if (r.ok) { const d = await r.json(); folders = d.folders || folders; }
                else { showToast("Errore aggiornamento cartella"); cb.checked = !cb.checked; }
            } catch (e) { showToast("Errore"); cb.checked = !cb.checked; }
        });
    });
    const ps = overlay.querySelector(".picker-search");
    if (ps) ps.addEventListener("input", () => {
        const qq = ps.value.trim().toLowerCase();
        overlay.querySelectorAll(".picker-row").forEach(r => {
            r.style.display = r.textContent.toLowerCase().includes(qq) ? "" : "none";
        });
    });
}

async function openFolderPicker(folderId) {
    let data;
    try { const r = await fetch("/api/folders"); data = await r.json(); }
    catch (e) { showToast("Errore caricamento libreria"); return; }
    const folder = (data.folders || []).find(f => f.id === folderId);
    if (!folder) return;
    const inFolder = new Set((folder.items || []).map(it => it.key));
    const pool = [];
    (data.unassigned || []).forEach(it => pool.push({ ...it, where: "" }));
    (data.folders || []).forEach(f => (f.items || []).forEach(it => pool.push({ ...it, where: f.id === folderId ? "" : f.name })));
    pool.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    const overlay = document.createElement("div");
    overlay.className = "picker-overlay";
    const rows = pool.map(it => {
        const checked = inFolder.has(it.key) ? "checked" : "";
        const note = it.where ? ` <span class="picker-note">(in: ${escapeHtml(it.where)})</span>` : "";
        const badge = it.type === "tv" ? "Serie" : (it.type === "movie" ? "Film" : "");
        return `<label class="picker-row">
            <input type="checkbox" value="${escapeHtml(it.key)}" ${checked}>
            <span>${escapeHtml(it.name || "Senza titolo")}</span>
            <span class="picker-note">${badge}</span>${note}
        </label>`;
    }).join("");
    overlay.innerHTML = `
        <div class="picker-panel glass">
            <h3>Aggiungi titoli a "${escapeHtml(folder.name)}"</h3>
            <p class="picker-hint">Spunta i titoli della libreria da mettere nella cartella, poi conferma.</p>
            <input type="text" class="picker-search" placeholder="Cerca un titolo…" autocomplete="off" spellcheck="false">
            <div class="picker-list">${rows || '<div class="no-downloads">Nessun titolo in libreria. Apri prima qualche contenuto.</div>'}</div>
            <div class="picker-actions">
                <button class="secondary-btn picker-cancel">Annulla</button>
                <button class="primary-btn picker-confirm">Conferma</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    overlay.querySelector(".picker-cancel").addEventListener("click", close);
    const psearch = overlay.querySelector(".picker-search");
    if (psearch) psearch.addEventListener("input", () => {
        const qq = psearch.value.trim().toLowerCase();
        overlay.querySelectorAll(".picker-row").forEach(r => {
            r.style.display = r.textContent.toLowerCase().includes(qq) ? "" : "none";
        });
    });
    overlay.querySelector(".picker-confirm").addEventListener("click", async () => {
        const sel = Array.from(overlay.querySelectorAll('input[type="checkbox"]:checked')).map(c => c.value);
        try {
            const r = await fetch("/api/folders/set", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: folderId, items: sel }) });
            if (r.ok) { renderLibrary(await r.json()); showToast(`Cartella aggiornata (${sel.length} titoli)`); }
            else { showToast("Errore aggiornamento cartella"); }
        } catch (e) { showToast("Errore aggiornamento cartella"); }
        close();
    });
}

// 9. Domains (remembered across sessions, health-checked at startup) ---------
async function fetchDomains() {
    try {
        const r = await fetch("/api/domains");
        if (r.ok) renderDomains(await r.json());
    } catch (e) { console.error("domains fetch failed", e); }
}

function renderDomains(data) {
    if (!el.domainsList) return;
    const list = (data && data.domains) || [];
    const current = data && data.current;
    if (el.domainInput && current) el.domainInput.value = current;
    el.domainsList.innerHTML = "";
    if (list.length === 0) {
        el.domainsList.innerHTML = '<div class="no-downloads">Nessun dominio salvato. Inseriscine uno nel campo in alto.</div>';
        return;
    }
    list.forEach(d => {
        const isCurrent = d.domain === current;
        const state = d.active === true ? "on" : (d.active === false ? "off" : "unknown");
        const stateLabel = state === "on" ? "attivo" : (state === "off" ? "non attivo" : "non verificato");
        const row = document.createElement("div");
        row.className = "domain-item" + (isCurrent ? " is-current" : "");
        row.innerHTML = `
            <span class="domain-dot ${state}" title="${stateLabel}"></span>
            <span class="domain-name">${escapeHtml(d.domain)}</span>
            <span class="domain-tag">${isCurrent ? "in uso" : stateLabel}</span>
            <div class="domain-actions">
                ${(!isCurrent && d.active === true) ? '<button class="icon-btn use-btn" title="Usa questo dominio">✓</button>' : ""}
                <button class="icon-btn del-dom-btn" title="Rimuovi dominio">✕</button>
            </div>`;
        const ub = row.querySelector(".use-btn");
        if (ub) ub.addEventListener("click", () => useDomain(d.domain));
        row.querySelector(".del-dom-btn").addEventListener("click", () => removeDomain(d.domain));
        el.domainsList.appendChild(row);
    });
}

async function useDomain(domain) {
    try {
        const r = await fetch("/api/domains/add", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domain }) });
        if (r.ok) { await fetchDomains(); showToast(`Dominio in uso: ${domain}`); }
    } catch (e) { showToast("Errore impostazione dominio"); }
}

async function removeDomain(domain) {
    if (!confirm(`Rimuovere il dominio "${domain}" dalla lista?`)) return;
    try {
        const r = await fetch("/api/domains/remove", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domain }) });
        if (r.ok) await fetchDomains();
    } catch (e) { showToast("Errore rimozione dominio"); }
}

async function fetchSourceDomains() {
    if (!el.sourceDomainsList) return;
    try {
        const r = await fetch("/api/source-domains");
        if (r.ok) renderSourceDomains(await r.json());
    } catch (e) {}
}

function renderSourceDomains(data) {
    if (!el.sourceDomainsList) return;
    const list = (data && data.domains) || [];
    el.sourceDomainsList.innerHTML = "";
    if (!list.length) {
        el.sourceDomainsList.innerHTML = '<div class="no-downloads">Aggiungi qui domini/cataloghi compatibili per anime o titoli mancanti.</div>';
        return;
    }
    list.forEach(domain => {
        const row = document.createElement("div");
        row.className = "domain-item";
        row.innerHTML = `<span class="domain-dot unknown"></span><span class="domain-name">${escapeHtml(domain)}</span><span class="domain-tag">fonte extra</span><div class="domain-actions"><button class="icon-btn del-source-btn" title="Rimuovi">✕</button></div>`;
        row.querySelector(".del-source-btn").addEventListener("click", () => removeSourceDomain(domain));
        el.sourceDomainsList.appendChild(row);
    });
}

async function addSourceDomain() {
    const domain = (el.sourceDomainInput && el.sourceDomainInput.value || "").trim();
    if (!domain) return;
    try {
        const r = await fetch("/api/source-domains/add", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domain }) });
        if (r.ok) {
            if (el.sourceDomainInput) el.sourceDomainInput.value = "";
            renderSourceDomains(await r.json());
            showToast("Fonte extra aggiunta");
        } else showToast("Fonte non valida");
    } catch (e) { showToast("Errore aggiunta fonte"); }
}

async function removeSourceDomain(domain) {
    if (!confirm(`Rimuovere la fonte "${domain}"?`)) return;
    try {
        const r = await fetch("/api/source-domains/remove", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domain }) });
        if (r.ok) renderSourceDomains(await r.json());
    } catch (e) { showToast("Errore rimozione fonte"); }
}

async function testDomains() {
    showToast("Verifica domini in corso…", 8000);
    try {
        const r = await fetch("/api/domains/test", { method: "POST" });
        if (r.ok) {
            const data = await r.json();
            const active = (data.domains || []).filter(d => d.active === true).length;
            await fetchDomains();
            showToast(active > 0 ? `${active} dominio/i attivo/i. In uso: ${data.current}.`
                                 : "Nessun dominio salvato è attivo: aggiornane uno.", 6000);
        }
    } catch (e) { showToast("Errore durante la verifica dei domini"); }
}

async function updateDomainFromLink() {
    const value = prompt("Incolla un link valido di StreamingCommunity:");
    if (value === null || !value.trim()) return;
    try {
        const r = await fetch("/api/settings", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ domain: value.trim() })
        });
        if (r.ok) {
            const data = await r.json();
            if (el.domainInput) el.domainInput.value = data.domain || "";
            await fetchDomains();
            showToast("Dominio StreamingCommunity aggiornato");
        } else {
            showToast("Link/dominio non valido");
        }
    } catch (e) { showToast("Errore aggiornamento dominio"); }
}

function updateModalStar() {
    if (!el.favModalBtn) return;
    const entry = libraryCache.find(e => e.key === currentLibKey);
    const fav = !!(entry && entry.favorite);
    el.favModalBtn.classList.toggle("active", fav);
    el.favModalBtn.innerHTML = fav ? "\u2605 Nei preferiti" : "\u2606 Salva nei preferiti";
}
async function toggleModalFavorite() {
    if (!currentLibKey) { showToast("Apri prima un titolo"); return; }
    try {
        const body = JSON.stringify({ key: currentLibKey });
        let r = await fetch("/api/library/favorite", {
            method: "POST", headers: { "Content-Type": "application/json" }, body
        });
        if (r.status === 404) {
            await addToLibrary(currentLibKey, {
                key: currentLibKey,
                name: (currentTitle && currentTitle.name) || "",
                cover: (currentTitle && currentTitle.cover) || "",
                type: (currentTitle && currentTitle.type) || "",
                is_clone: !!(currentTitle && currentTitle.is_clone)
            });
            r = await fetch("/api/library/favorite", {
                method: "POST", headers: { "Content-Type": "application/json" }, body
            });
        }
        if (r.ok) {
            await r.json();
            await fetchLibrary();
            updateModalStar();
            const entry = libraryCache.find(e => e.key === currentLibKey);
            showToast(entry && entry.favorite ? "Aggiunto ai preferiti" : "Rimosso dai preferiti");
        } else {
            showToast("Impossibile salvare il preferito");
        }
    } catch (e) { showToast("Errore aggiornamento preferito"); }
}

// Start application
// --- Riprendi la riproduzione da dove eri (posizione salvata, persiste tra sessioni) ---
var _playKey = "";
var _lastSave = 0;
function _progressStore() { try { return JSON.parse(localStorage.getItem("scp_pos") || "{}"); } catch (e) { return {}; } }
function _saveProgressStore(o) { try { localStorage.setItem("scp_pos", JSON.stringify(o)); } catch (e) {} }
function _savePlayback() {
    var v = el.videoPlayer; if (!v || !_playKey) return;
    var t = v.currentTime || 0, d = v.duration || 0;
    var now = Date.now();
    if (now - _lastSave < 4000 && v.paused === false) return;   // salva ~ogni 4s
    _lastSave = now;
    var store = _progressStore();
    if (d > 0 && t > 15 && t < d - 20) { store[_playKey] = { t: t, d: d, at: now }; _saveProgressStore(store); }
    else if (d > 0 && t >= d - 20) { delete store[_playKey]; _saveProgressStore(store); }   // finito: dimentica
}
function _clearPlayback(key) { if (!key) return; var s = _progressStore(); if (s[key]) { delete s[key]; _saveProgressStore(s); } }
function _resumePlayback() {
    var v = el.videoPlayer; if (!v || !_playKey) return;
    var rec = _progressStore()[_playKey];
    if (rec && rec.t > 15 && (!v.duration || rec.t < v.duration - 20)) {
        try { v.currentTime = rec.t; } catch (e) {}
        showToast("Ripreso da " + _fmtTime(rec.t));
    }
}
function _fmtTime(s) {
    s = Math.max(0, Math.floor(s || 0));
    var m = Math.floor(s / 60), ss = ("0" + (s % 60)).slice(-2), h = Math.floor(m / 60);
    return h > 0 ? (h + ":" + ("0" + (m % 60)).slice(-2) + ":" + ss) : (m + ":" + ss);
}

// ─── Modalita' "solo guardare" vs "cerca/scarica/organizza" + promemoria VPN ───
function _mode() { try { return sessionStorage.getItem("scp_mode") || ""; } catch (e) { return ""; } }
function _setMode(m) { try { sessionStorage.setItem("scp_mode", m); } catch (e) {} }

function openWelcomeBanner() {
    try { if (sessionStorage.getItem("scp_welcomed")) return; } catch (e) {}
    try { sessionStorage.setItem("scp_welcomed", "1"); } catch (e) {}
    if (document.body.classList.contains("downloads-only")) return;
    const ov = document.createElement("div");
    ov.className = "welcome-ov";
    ov.innerHTML =
        '<div class="welcome-card">' +
        '<div class="welcome-logo"><svg viewBox="0 0 48 48" width="52" height="52"><defs><linearGradient id="wlg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6fd0ff"/><stop offset="1" stop-color="#1e6fff"/></linearGradient></defs><rect x="4" y="4" width="40" height="40" rx="13" fill="url(#wlg)"/><path d="M19 15.5 L34 24 L19 32.5 Z" fill="#fff"/></svg></div>' +
        '<h2>Benvenuto su SC Portal</h2>' +
        '<p>Cosa vuoi fare adesso?</p>' +
        '<div class="welcome-choices">' +
        '<button class="welcome-btn wb-img watch" data-x="watch" style="background-image:url(&apos;/welcome-watch.jpg&apos;)"><span class="wb-veil"></span><span class="wb-body"><span class="wb-t">Solo guardare</span><span class="wb-s">Riproduci i tuoi titoli. Nessuna VPN necessaria.</span></span></button>' +
        '<button class="welcome-btn wb-img full" data-x="full" style="background-image:url(&apos;/welcome-browse.jpg&apos;)"><span class="wb-veil"></span><span class="wb-body"><span class="wb-t">Cerca · Scarica · Organizza</span><span class="wb-s">Attiva la VPN prima di procedere per non esporre il tuo IP.</span></span></button>' +
        '</div></div>';
    document.body.appendChild(ov);
    const close = () => { if (ov._rot) clearInterval(ov._rot); ov.remove(); };
    ov.querySelector('[data-x="watch"]').addEventListener("click", () => { _setMode("watch"); close(); showToast("Modalita' visione: buona visione!", 4000); });
    ov.querySelector('[data-x="full"]').addEventListener("click", () => { _setMode("full"); close(); showToast("Ricorda: attiva la VPN prima di cercare/scaricare.", 6000); });
    // Sfondo della casella "Cerca/Scarica/Organizza": rotazione dinamica di TUTTE
    // le locandine presenti nella piattaforma (libreria + download).
    const _startCoverRotation = () => {
        if (ov._rot) return;
        const covers = [];
        (libraryCache || []).forEach(t => { if (t.cover) covers.push(t.cover); });
        (localDownloads || []).forEach(d => { if (d.cover) covers.push(d.cover); });
        const uniq = [...new Set(covers)];
        if (uniq.length < 2) return;
        const box = ov.querySelector(".full"); if (!box) return;
        // mescola
        for (let i = uniq.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [uniq[i], uniq[j]] = [uniq[j], uniq[i]]; }
        let i = 0;
        const set = () => { box.style.backgroundImage = "url('" + String(uniq[i % uniq.length]).replace(/'/g, "%27") + "')"; };
        set();
        ov._rot = setInterval(() => { i++; set(); }, 2500);
    };
    _startCoverRotation();
    setTimeout(_startCoverRotation, 1600);
}

function _vpnGuardBeforeOnline() {
    // Se ha scelto "solo guardare" e poi cerca/scarica: ricordagli la VPN.
    if (_mode() === "watch") { openVpnReminder(); _setMode("full"); }
}

function openVpnReminder() {
    const ex = document.getElementById("vpn-reminder"); if (ex) return;
    const ov = document.createElement("div");
    ov.id = "vpn-reminder"; ov.className = "welcome-ov";
    ov.innerHTML =
        '<div class="welcome-card vpn">' +
        '<div class="welcome-logo"><svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="#55bdff" stroke-width="2"><rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3"></path></svg></div>' +
        '<h2>Stai per andare online</h2>' +
        '<p>Avevi scelto "solo guardare". Ora stai per <b>cercare o scaricare</b>: accendi la <b>VPN</b> per non esporre il tuo IP.</p>' +
        '<div class="welcome-choices vpn-row">' +
        '<button class="welcome-btn full" data-x="ok"><span class="wb-t">VPN attiva, procedi</span></button>' +
        '<button class="welcome-btn" data-x="ip"><span class="wb-t">Verifica IP</span></button>' +
        '</div></div>';
    document.body.appendChild(ov);
    const close = () => ov.remove();
    ov.querySelector('[data-x="ok"]').addEventListener("click", close);
    ov.querySelector('[data-x="ip"]').addEventListener("click", () => { close(); if (typeof openPrivacyPanel === "function") openPrivacyPanel(); });
    ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
}

// ─── Trascinamento orizzontale (drag-scroll) delle righe .disney-row ───
function setupDragScroll() {
    let down = false, startX = 0, startScroll = 0, row = null, moved = false;
    document.addEventListener("mousedown", (e) => {
        const r = e.target.closest(".disney-row"); if (!r) return;
        if (e.target.closest("button, input, select, a, label, .cw-x")) return;
        down = true; row = r; startX = e.pageX; startScroll = r.scrollLeft; moved = false;
    });
    document.addEventListener("mousemove", (e) => {
        if (!down || !row) return;
        const dx = e.pageX - startX;
        if (Math.abs(dx) > 4) { moved = true; row.classList.add("dragging"); }
        row.scrollLeft = startScroll - dx;
    });
    const end = () => { down = false; row = null; document.querySelectorAll(".disney-row.dragging").forEach(r => r.classList.remove("dragging")); };
    document.addEventListener("mouseup", end);
    document.addEventListener("mouseleave", end);
    document.addEventListener("click", (e) => { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } }, true);
}

window.addEventListener("DOMContentLoaded", init);
