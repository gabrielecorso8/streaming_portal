let currentTitle = null; // Stores current active media details
let activeHls = null;    // Stores active HLS.js instance
let lastTitleContext = ""; // Name of the title being opened (for domain-error messages)
let currentLibKey = "";    // Library key of the title currently shown in the modal
let libraryCache = [];     // Last known library list (to read favourite state)

// Helper for UI elements
const el = {
    domainInput: document.getElementById("domain-input"),
    saveSettingsBtn: document.getElementById("save-settings-btn"),
    refreshDomainBtn: document.getElementById("refresh-domain-btn"),
    proxyInput: document.getElementById("proxy-input"),
    saveProxyBtn: document.getElementById("save-proxy-btn"),
    urlInput: document.getElementById("url-input"),
    loadUrlBtn: document.getElementById("load-url-btn"),
    convertUrlBtn: document.getElementById("convert-url-btn"),
    openFolderBtn: document.getElementById("open-folder-btn"),

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
    qualityBar: document.querySelector(".player-controls-bar"),
    
    // Domains
    domainsList: document.getElementById("domains-list"),
    testDomainsBtn: document.getElementById("test-domains-btn"),

    // Library
    libraryList: document.getElementById("library-list"),

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
    el.loadUrlBtn.addEventListener("click", resolveDirectUrl);
    el.convertUrlBtn.addEventListener("click", convertDirectUrl);
    el.openFolderBtn.addEventListener("click", openDownloadsFolder);
    el.urlInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") resolveDirectUrl();
    });
    el.closeModalBtn.addEventListener("click", closeModal);
    if (el.favModalBtn) el.favModalBtn.addEventListener("click", toggleModalFavorite);
    el.closePlayerBtn.addEventListener("click", closePlayer);
    
    // Setup detail actions
    el.streamMovieBtn.addEventListener("click", () => startStream(currentTitle.id, currentTitle.name));
    el.downloadMovieBtn.addEventListener("click", () => triggerDownload(currentTitle.name, currentTitle.id));
    el.seasonSelect.addEventListener("change", loadSeasonEpisodes);
    
    if (el.testDomainsBtn) el.testDomainsBtn.addEventListener("click", testDomains);

    // Start polling downloads
    startDownloadsPolling();

    // Load the saved/recent titles library and the remembered domains
    fetchLibrary();
    fetchDomains();
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
            showToast(`Dominio aggiornato: streamingcommunity.${data.domain}.` +
                (retryHint ? " Riprova l'operazione." : ""), 5000);
        } else {
            showToast("Nessun dominio attivo trovato. Incolla un link funzionante per impostarlo manualmente.", 7000);
        }
    } catch (e) {
        showToast("Errore durante l'aggiornamento del dominio.");
    }
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
            if (data.is_clone) {
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
                const titleId = data.title_id || parseInt(data.id_and_slug.split("-")[0]);
                const episodeId = data.episode_id || null;
                addToLibrary(url, { key: data.id_and_slug, name: "", type: "", is_clone: false });
                triggerDownload("", titleId, episodeId);
            }
        } else {
            if (await checkDomainError(resp)) return;
            showToast("Impossibile risolvere questo link");
        }
    } catch (e) {
        showToast("Errore durante l'analisi dell'URL");
    }
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
    episodes.forEach(ep => {
        const item = document.createElement("div");
        item.className = "episode-item";

        const epTitle = ep.name ? ep.name : `Episodio ${ep.number}`;
        const duration = ep.duration ? `${ep.duration}m` : "";
        const plot = ep.plot ? ep.plot : "Nessuna trama disponibile.";

        // Clone series episodes: download only (reliable); native: stream + download
        const buttons = isClone
            ? `<button class="secondary-btn download-ep-btn">Download</button>`
            : `<button class="primary-btn stream-ep-btn">Stream</button>
               <button class="secondary-btn download-ep-btn">Download</button>`;

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
            item.querySelector(".stream-ep-btn").addEventListener("click", () => {
                closeModal();
                startStream(currentTitle.id, fullEpName, ep.id);
            });
            item.querySelector(".download-ep-btn").addEventListener("click", () => {
                triggerDownload(fullEpName, currentTitle.id, ep.id);
            });
        }

        el.episodesList.appendChild(item);
    });
}

// Download a specific episode of a clone (vidxgo) series
async function cloneEpisodeDownload(season, episode, label) {
    if (!currentTitle || !currentTitle.vidxgo) {
        showToast("Dati episodio non disponibili");
        return;
    }
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
                title: label
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

// 5. Streaming Player
async function startStream(titleId, label, episodeId = null) {
    showToast("Generazione stream in corso...");
    
    // Hide previous players
    closePlayer();
    
    if (currentTitle && currentTitle.is_clone && currentTitle.id === titleId) {
        el.playingTitle.textContent = `Riproduzione: ${label}`;
        
        // Show player
        el.playerSection.classList.remove("hidden");
        el.playerSection.scrollIntoView({ behavior: 'smooth' });
        
        // Clear qualities and hide quality bar
        el.qualitySelect.innerHTML = "";
        if (el.qualityBar) {
            el.qualityBar.classList.add("hidden");
        }
        
        if (currentTitle.stream_url) {
            el.videoPlayer.classList.remove("hidden");
            if (el.iframePlayer) el.iframePlayer.classList.add("hidden");
            
            const streamSrc = currentTitle.stream_url;
            
            if (Hls.isSupported()) {
                activeHls = new Hls();
                activeHls.loadSource(streamSrc);
                activeHls.attachMedia(el.videoPlayer);
                activeHls.on(Hls.Events.MANIFEST_PARSED, () => {
                    el.videoPlayer.play();
                });
                activeHls.on(Hls.Events.ERROR, function (event, data) {
                    console.warn("HLS error:", data);
                });
            } else if (el.videoPlayer.canPlayType('application/vnd.apple.mpegurl')) {
                el.videoPlayer.src = streamSrc;
                el.videoPlayer.addEventListener('loadedmetadata', () => {
                    el.videoPlayer.play();
                });
            } else {
                if (currentTitle.iframe_url) {
                    playIframe(currentTitle.iframe_url);
                } else {
                    showToast("Il tuo browser non supporta la riproduzione HLS.");
                }
            }
        } else if (currentTitle.iframe_url) {
            playIframe(currentTitle.iframe_url);
        } else {
            showToast("Video non disponibile");
        }
        return;
    }
    
    let url = `/api/stream/url?id=${titleId}`;
    if (episodeId) {
        url += `&episode_id=${episodeId}`;
    }
    
    try {
        const resp = await fetch(url);
        if (!resp.ok) {
            if (await checkDomainError(resp)) return;
            showToast("Video non disponibile");
            return;
        }

        const data = await resp.json();
        el.playingTitle.textContent = `Riproduzione: ${label}`;
        
        // Show player
        el.playerSection.classList.remove("hidden");
        el.playerSection.scrollIntoView({ behavior: 'smooth' });
        
        // Quality selector populating
        el.qualitySelect.innerHTML = "";
        data.qualities.forEach(q => {
            const opt = document.createElement("option");
            opt.value = q;
            opt.textContent = q;
            el.qualitySelect.appendChild(opt);
        });
        
        // Change quality listener
        el.qualitySelect.onchange = () => {
            const selectedQuality = el.qualitySelect.value;
            // Build sub-playlist URL or master playlist with default quality
            let streamUrl = data.master_url;
            
            // To set default rendition, vixcloud requires type=video&rendition={quality}
            // For proxy: we can query the master m3u8 directly and HLS.js will auto-detect,
            // or we can select a specific quality from master playlist.
            // Using standard master playlist works great in hls.js since it auto-switches.
        };

        // Initialize player
        const streamSrc = data.master_url;
        
        if (Hls.isSupported()) {
            activeHls = new Hls();
            activeHls.loadSource(streamSrc);
            activeHls.attachMedia(el.videoPlayer);
            activeHls.on(Hls.Events.MANIFEST_PARSED, () => {
                el.videoPlayer.play();
            });
            activeHls.on(Hls.Events.ERROR, function (event, data) {
                console.warn("HLS error:", data);
            });
        } else if (el.videoPlayer.canPlayType('application/vnd.apple.mpegurl')) {
            // Native support (Safari / iOS)
            el.videoPlayer.src = streamSrc;
            el.videoPlayer.addEventListener('loadedmetadata', () => {
                el.videoPlayer.play();
            });
        } else {
            showToast("Il tuo browser non supporta la riproduzione HLS.");
        }
        
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
    if (activeHls) {
        activeHls.destroy();
        activeHls = null;
    }
    el.videoPlayer.pause();
    el.videoPlayer.src = "";
    el.videoPlayer.classList.remove("hidden");
    
    if (el.iframePlayer) {
        el.iframePlayer.src = "";
        el.iframePlayer.classList.add("hidden");
    }
    
    if (el.qualityBar) {
        el.qualityBar.classList.remove("hidden");
    }
    
    el.playerSection.classList.add("hidden");
}

// 6. Downloads Triggering
async function triggerDownload(label, titleId, episodeId = null) {
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
                vidxgo: currentTitle.vidxgo || null
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
            if (await checkDomainError(streamResp)) return;
            showToast("Impossibile scaricare questo contenuto (video non disponibile)");
            return;
        }
        const data = await streamResp.json();
        
        // Select best quality available
        const bestQuality = data.qualities[0] || "720p";
        const tokenQualityKey = `token${bestQuality}`;
        const renderToken = data.params[tokenQualityKey];
        
        const finalTitle = label || data.title || "Video";
        
        const payload = {
            title: finalTitle,
            m3u8_video: `https://vixcloud.co/playlist/${data.video_id}?type=video&rendition=${bestQuality}&token=${renderToken}&expires=${data.params.expires}`,
            m3u8_audio: `https://vixcloud.co/playlist/${data.video_id}?token=${data.params.token}&${tokenQualityKey}=${renderToken}&expires=${data.params.expires}`,
            key_info: {
                key_url: "https://vixcloud.co/storage/enc.key",
                referer: `https://vixcloud.co/embed/${data.video_id}?token=${renderToken}&referer=1&expires=${data.params.expires}`
            }
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
function startDownloadsPolling() {
    setInterval(async () => {
        try {
            const resp = await fetch("/api/download/status");
            if (resp.ok) {
                const list = await resp.json();
                renderDownloads(list);
            }
        } catch (e) {
            console.error("Error polling downloads:", e);
        }
    }, 2000);
}

function formatBytes(bytes) {
    if (!bytes) return "";
    const units = ["B", "KB", "MB", "GB"];
    let i = 0, v = bytes;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function renderDownloads(downloads) {
    if (downloads.length === 0) {
        el.downloadsList.innerHTML = '<div class="no-downloads">Nessun download ancora. Incolla un link qui sopra per iniziare.</div>';
        return;
    }

    // Newest first
    const ordered = [...downloads].reverse();

    el.downloadsList.innerHTML = "";
    ordered.forEach(dl => {
        const item = document.createElement("div");
        item.className = `download-item state-${dl.status}`;

        let statusText = dl.status;
        if (dl.status === "pending") statusText = "In attesa…";
        else if (dl.status === "queued") statusText = "In coda…";
        else if (dl.status === "downloading") statusText = `Scaricamento ${dl.progress}%`;
        else if (dl.status === "merging") statusText = "Unione tracce (FFmpeg)…";
        else if (dl.status === "completed") statusText = dl.size ? `Completato · ${formatBytes(dl.size)}` : "Completato";
        else if (dl.status === "failed") statusText = `Fallito: ${dl.error || "errore sconosciuto"}`;

        const showBar = dl.status !== "completed" && dl.status !== "failed";

        const actions = dl.status === "completed"
            ? `<div class="download-actions">
                   <button class="primary-btn small-btn open-file-btn">
                       <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M8 5v14l11-7z"/></svg> Apri
                   </button>
                   <button class="secondary-btn small-btn reveal-file-btn">
                       <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg> Cartella
                   </button>
               </div>`
            : "";

        item.innerHTML = `
            <div class="download-info">
                <span class="download-name" title="${dl.file || dl.title}">${dl.title}</span>
                <span class="download-status status-${dl.status}">${statusText}</span>
            </div>
            ${showBar ? `<div class="progress-container"><div class="progress-bar" style="width: ${dl.progress}%"></div></div>` : ""}
            ${actions}
        `;

        if (dl.status === "completed") {
            item.querySelector(".open-file-btn").addEventListener("click", () => openDownloadFile(dl.id));
            item.querySelector(".reveal-file-btn").addEventListener("click", () => revealDownloadFile(dl.id));
        }

        el.downloadsList.appendChild(item);
    });
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
        type: data.type || "", is_clone: !!data.is_clone
    };
    try {
        const r = await fetch("/api/library", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(entry)
        });
        if (r.ok) { await fetchLibrary(); updateModalStar(); }
    } catch (e) { /* non-fatal */ }
}

function titleRow(item) {
    const row = document.createElement("div");
    row.className = "library-item" + (item.favorite ? " is-fav" : "");
    const typeBadge = item.type === "tv" ? "Serie" : (item.type === "movie" ? "Film" : "");
    const cover = item.cover
        ? `<img class="library-cover" src="${item.cover}" alt="" loading="lazy">`
        : `<div class="library-cover placeholder"></div>`;
    const name = item.name && item.name.trim() ? item.name : "Senza titolo";
    row.innerHTML = `
        ${cover}
        <div class="library-meta">
            <span class="library-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
            <span class="library-sub">${typeBadge}${item.is_clone ? " · clone" : ""}</span>
        </div>
        <div class="library-actions">
            <label class="icon-btn" title="Cambia locandina">🖼️<input type="file" accept="image/*" class="libcover-input" hidden></label>
            <button class="icon-btn ren-title-btn" title="Rinomina titolo">✎</button>
            <button class="icon-btn fav-btn" title="${item.favorite ? "Rimuovi dai preferiti" : "Aggiungi ai preferiti"}">${item.favorite ? "★" : "☆"}</button>
            <button class="icon-btn del-btn" title="Rimuovi dalla libreria">✕</button>
        </div>`;
    row.addEventListener("click", (e) => { if (e.target.closest(".library-actions")) return; openFromLibrary(item); });
    row.querySelector(".libcover-input").addEventListener("change", (e) => { e.stopPropagation(); uploadTitleCover(item.key, e.target); });
    row.querySelector(".ren-title-btn").addEventListener("click", (e) => { e.stopPropagation(); renameTitle(item.key, item.name); });
    row.querySelector(".fav-btn").addEventListener("click", (e) => { e.stopPropagation(); toggleFavorite(item.key); });
    row.querySelector(".del-btn").addEventListener("click", (e) => { e.stopPropagation(); removeFromLibrary(item.key, item.name); });
    return row;
}

function renderLibrary(data) {
    if (!el.libraryList) return;
    const folders = (data && data.folders) || [];
    const unassigned = (data && data.unassigned) || [];
    libraryCache = [].concat(unassigned, ...folders.map(f => f.items || []));

    el.libraryList.innerHTML = "";

    const createBtn = document.createElement("button");
    createBtn.className = "secondary-btn small-btn create-folder-btn";
    createBtn.textContent = "+ Nuova cartella";
    createBtn.addEventListener("click", createFolder);
    el.libraryList.appendChild(createBtn);

    // Favourites shortcut (always shown, persists across sessions)
    const favs = libraryCache.filter(it => it && it.favorite);
    if (favs.length) {
        const favTitle = document.createElement("div");
        favTitle.className = "domains-subtitle fav-subtitle";
        favTitle.textContent = "★ Preferiti";
        el.libraryList.appendChild(favTitle);
        favs.forEach(it => el.libraryList.appendChild(titleRow(it)));
    }

    folders.forEach(f => {
        const card = document.createElement("div");
        card.className = "folder-card";
        const coverStyle = f.cover ? `style="background-image:url('${f.cover}')"` : "";
        card.innerHTML = `
            <div class="folder-head">
                <div class="folder-cover ${f.cover ? "" : "placeholder"}" ${coverStyle}></div>
                <div class="folder-meta">
                    <span class="folder-name">${escapeHtml(f.name)}</span>
                    <span class="folder-count">${(f.items || []).length} titoli</span>
                </div>
                <div class="folder-actions">
                    <button class="icon-btn adddom-btn" title="Aggiungi titoli dalla libreria">➕</button>
                    <label class="icon-btn" title="Imposta/Cambia locandina">🖼️<input type="file" accept="image/*" class="cover-input" hidden></label>
                    <button class="icon-btn ren-btn" title="Rinomina">✎</button>
                    <button class="icon-btn delf-btn" title="Elimina cartella">✕</button>
                    <button class="icon-btn toggle-btn" title="Mostra/Nascondi">▾</button>
                </div>
            </div>
            <div class="folder-domains hidden"></div>`;
        const body = card.querySelector(".folder-domains");
        if ((f.items || []).length === 0) {
            const empty = document.createElement("div");
            empty.className = "no-downloads";
            empty.textContent = "Cartella vuota. Usa ➕ per aggiungere titoli.";
            body.appendChild(empty);
        } else {
            f.items.forEach(it => body.appendChild(titleRow(it)));
        }
        card.querySelector(".folder-head").addEventListener("click", (e) => {
            if (e.target.closest(".folder-actions")) return;
            body.classList.toggle("hidden");
        });
        card.querySelector(".adddom-btn").addEventListener("click", (e) => { e.stopPropagation(); openFolderPicker(f.id); });
        card.querySelector(".cover-input").addEventListener("change", (e) => uploadFolderCover(f.id, e.target));
        card.querySelector(".ren-btn").addEventListener("click", (e) => { e.stopPropagation(); renameFolder(f.id, f.name); });
        card.querySelector(".delf-btn").addEventListener("click", (e) => { e.stopPropagation(); removeFolder(f.id, f.name); });
        card.querySelector(".toggle-btn").addEventListener("click", (e) => { e.stopPropagation(); body.classList.toggle("hidden"); });
        el.libraryList.appendChild(card);
    });

    const unTitle = document.createElement("div");
    unTitle.className = "domains-subtitle";
    unTitle.textContent = "Senza cartella";
    el.libraryList.appendChild(unTitle);
    if (unassigned.length === 0) {
        const none = document.createElement("div");
        none.className = "no-downloads";
        none.textContent = folders.length ? "Tutti i titoli sono in una cartella." : "Nessun titolo salvato. Apri un link: comparirà qui.";
        el.libraryList.appendChild(none);
    } else {
        unassigned.forEach(it => el.libraryList.appendChild(titleRow(it)));
    }
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
            <span class="domain-name">streamingcommunity.${escapeHtml(d.domain)}</span>
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
            // The title isn't saved yet (e.g. just opened): create it, then retry.
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
window.addEventListener("DOMContentLoaded", init);
