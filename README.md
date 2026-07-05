# SC Portal

Portale locale per la ricerca, lo streaming in-browser e il download di film ed
episodi da StreamingCommunity (e cloni compatibili). L'applicazione è composta da
un backend FastAPI, un motore di download HLS multithread e un frontend statico a
pagina singola, avviabili come applicazione desktop "a doppio clic" senza
configurazione manuale.

Il progetto è a scopo esclusivamente educativo e dimostrativo.

---

## ⚠️ Prima di iniziare — privacy e sicurezza (leggere)

SC Portal è già protetto lato applicazione (server solo su `127.0.0.1`, anti-CSRF/
SSRF/DNS-rebinding, CSP senza terze parti, locandine via proxy locale, nessuna
telemetria). Ciò che l'app **non** può nascondere da sola è il tuo **IP verso i
siti di streaming**: per quello serve mascherare la connessione a livello di
sistema. Prima di usare SC Portal:

1. **Installa e tieni SEMPRE acceso Cloudflare WARP** (app gratuita "1.1.1.1"):
   [cloudflare.com/warp](https://one.one.one.one/) o
   [1.1.1.1](https://1.1.1.1/). Instrada tutto il traffico e maschera l'IP.
2. **Installa e tieni SEMPRE acceso ProtonVPN**:
   [protonvpn.com](https://protonvpn.com/). Una VPN no‑log seria è la protezione
   più completa per nascondere l'IP ai siti.
3. **Accendi WARP e/o ProtonVPN PRIMA di aprire SC Portal**, e verifica che siano
   connessi. Con la VPN attiva **lascia vuoto il campo proxy** dell'app: il
   traffico è già coperto a livello di sistema.

> In sintesi: **VPN/WARP acceso → poi apri SC Portal**. Se apri l'app senza
> protezione attiva, il tuo IP di casa è visibile ai siti (un banner nell'app te
> lo ricorda). Non usare proxy gratuiti presi da liste pubbliche: possono
> registrare e manomettere il tuo traffico.

Nota tecnica: la connessione verso i siti di streaming non verifica il
certificato TLS (i loro certificati ruotano spesso); WARP/VPN riduce molto il
rischio di intercettazione su quel percorso.

---

## Architettura

L'applicazione segue un'architettura a tre livelli eseguita interamente in
locale su `localhost:8082`:

```
┌──────────────────────────────┐
│  Frontend statico (SPA)       │  static/index.html · app.js · styles.css
│  fetch() → API REST locale    │
└───────────────┬───────────────┘
                │  HTTP same-origin
┌───────────────▼───────────────┐
│  Backend FastAPI (api.py)     │  ricerca · libreria · domini · proxy m3u8/AES
│  middleware di sicurezza      │  risoluzione stream Vixcloud/vidxgo
└───────────────┬───────────────┘
                │
┌───────────────▼───────────────┐
│  Motore download (downloader) │  coda · segmenti paralleli · resume · FFmpeg
└───────────────────────────────┘
```

Il bootstrap (`start.py`) crea il virtualenv, installa le dipendenze, scarica
FFmpeg, avvia Uvicorn e apre il browser. In modalità congelata (PyInstaller) i
percorsi sono risolti rispetto all'eseguibile.

### Stack tecnologico

| Livello        | Tecnologie                                                        |
|----------------|-------------------------------------------------------------------|
| Backend        | Python 3.11+, FastAPI, Uvicorn, requests, BeautifulSoup/lxml, m3u8, cryptography |
| Download       | Threading, HLS/AES-128, FFmpeg (remux `+faststart`)               |
| Frontend       | HTML/CSS/JavaScript vanilla, `hls.js`, Remote Playback API        |
| Packaging      | PyInstaller (`.exe` standalone), launcher `.bat`/`.vbs`           |

---

## Struttura del progetto

```
streaming_portal/
├── start.py                       # Bootstrap: venv, dipendenze, ffmpeg, avvio server
├── api.py                         # Server FastAPI: API REST, sicurezza, risoluzione stream
├── downloader.py                  # Motore download HLS parallelo, coda, resume, merge
├── vidxgo.py                      # Risoluzione embed dei cloni (vidxgo)
├── requirements.txt               # Dipendenze Python
├── settings.json                  # Dominio attivo, domini noti, cartelle, proxy (tracked)
├── library.json                   # Titoli, preferiti (tracked)
├── covers/                        # Locandine caricate (tracked)
├── static/                        # Frontend: index.html, app.js, styles.css, favicon
├── launcher_exe.py                # Entry point dell'eseguibile PyInstaller
├── SC Portal.spec                 # Specifica di build PyInstaller
├── Avvia SC Portal.bat            # Avvio a doppio clic con setup automatico
├── SC Portal.vbs                  # Avvio senza finestra di terminale
├── Ferma SC Portal.bat            # Arresto di emergenza
├── Crea collegamento sul Desktop.bat
└── Crea EXE.bat                   # Genera l'eseguibile standalone
```

`settings.json`, `library.json` e `covers/` sono versionati intenzionalmente per
distribuire la collezione curata insieme al codice. Sono ignorati da Git:
`venv/`, `bin/` (FFmpeg), `downloads/`, `build/`, `dist/`, `*.exe`, `server.log`.

---

## Modello dati

**`library.json`** — elenco dei titoli salvati. Ogni voce usa una *chiave stabile*
`id-slug` (es. `5669-the-bear`); gli URL visibili vengono rigenerati al volo sul
dominio attivo, quindi la libreria resta valida anche quando il dominio cambia.

```json
{ "key": "5669-the-bear", "name": "The Bear", "cover": "/covers/lib_ab12cd34.png",
  "type": "tv", "release_date": "2022-06-23", "favorite": true, "is_clone": false }
```

**`settings.json`** — dominio attivo, domini noti, impostazioni download/proxy e
le cartelle della libreria:

```json
{ "id": "f_marvel", "name": "Marvel", "kind": "saga", "parent": "",
  "cover": "/covers/...", "favorite": true,
  "items": ["1-iron-man", "2-thor"],
  "names": { "1-iron-man": "Iron Man (2008)" },
  "order": ["1-iron-man", "f:f_fase1", "2-thor"] }
```

Le cartelle supportano annidamento (`parent`), tipizzazione (`kind`:
saga/regista/genere), override del nome titolo per-cartella (`names`) e un
**ordine manuale combinato** (`order`) i cui token sono chiavi di titolo o
`f:<id>` per le sottocartelle, così titoli e sottocartelle possono essere
riordinati insieme.

---

## API REST (principali endpoint)

| Metodo | Endpoint                          | Descrizione                                        |
|--------|-----------------------------------|----------------------------------------------------|
| GET    | `/api/search?q=`                  | Ricerca via scraping della pagina Inertia          |
| GET    | `/api/title`, `/api/season`       | Dettaglio titolo, stagioni ed episodi              |
| GET    | `/api/stream/url?id=`             | Risoluzione stream: master/video/audio playlist    |
| GET    | `/api/folders`                    | Stato completo di libreria e cartelle              |
| POST   | `/api/folders/order`              | Ordine manuale combinato (titoli + sottocartelle)  |
| POST   | `/api/folders/reorder`            | Riordino cartelle sorelle / spostamento in fondo   |
| POST   | `/api/folders/set` · `/parent`    | Contenuto cartella · annidamento                   |
| POST   | `/api/download`                   | Avvio download HLS in coda                          |
| POST   | `/api/download/next-episode`      | Download intelligente episodio successivo/precedente |
| GET    | `/api/downloads/local`            | Scansione dei file scaricati in sessioni precedenti |
| GET    | `/api/download/play/{id}`         | Streaming locale del file (Range, `inline`)        |
| POST   | `/api/downloads/open-folder`      | Apre la cartella download in primo piano           |

---

## Pipeline di streaming e download

La risoluzione dello stream (`api.py → get_stream_details`) segue il flusso
attuale di StreamingCommunity/Vixcloud:

1. Lettura dell'iframe StreamingCommunity (`/it/iframe/{id}`) e apertura
   dell'embed Vixcloud.
2. Estrazione di `window.video`, `window.streams` e dei parametri (`token`,
   `expires`, `asn`, `lang`, `canPlayFHD`, `scz`).
3. Costruzione della master playlist reale (`ub=1`, `h=1`, `scz=1`, `lang=it` +
   token/expires).
4. Selezione della variante video a banda maggiore e della traccia audio di
   default; ritorno di `master_url`, `video_url`, `audio_url`.

Lo streaming in-browser usa `hls.js` con reverse-proxy locale per superare i
vincoli CORS/Referer, con fallback automatico all'embed Vixcloud in caso di
errore. Il download (`downloader.py`) scarica i segmenti `.ts` in parallelo con
keep-alive e refresh dei token, decritta AES-128, supporta resume dei segmenti
mancanti e fonde tramite FFmpeg in un remux unico con `+faststart` per evitare
micro-stop tra le parti. La coda è interrompibile; la lista download non è
persistente tra le sessioni, mentre libreria e preferiti lo sono.

---

## Sicurezza

Non essendoci autenticazione, l'API locale è protetta a più livelli
(`api.py`, middleware `security_headers`):

- **Header HTTP** su ogni risposta: `Content-Security-Policy` restrittiva,
  `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`,
  `Permissions-Policy`.
- **Anti CSRF**: le richieste che modificano dati (POST/PUT/PATCH/DELETE) sono
  accettate solo se `Origin`/`Referer` combaciano con l'`Host` del portale.
- **Anti DNS-rebinding**: l'`Host` è validato tramite allowlist (solo loopback e
  reti private); un dominio pubblico che risolve a `127.0.0.1` viene respinto.
- **CORS senza wildcard**: origini limitate a `localhost`/`127.0.0.1`.
- **Path traversal**: le scritture sono vincolate alle cartelle del progetto; i
  nomi dei file locandina derivano da un hash della chiave (estensione validata,
  max 8 MB) e i percorsi di download sono verificati con `os.path.commonpath`
  contro la directory dei download.
- **Anti-SSRF**: i proxy di streaming (`/api/stream/master.m3u8`,
  `subplaylist.m3u8`, `segment`, `key`) e gli URL di download accettano solo
  `http`/`https` verso host che risolvono a IP **pubblici**; loopback, reti
  private/LAN e link-local (169.254.x, metadati cloud) sono bloccati, così gli
  endpoint non possono essere usati come proxy verso la rete interna.
- **Nomi file di download**: il titolo è sanificato (rimozione separatori e
  caratteri di controllo, niente nomi riservati Windows, lunghezza massima) e il
  file risultante è confinato con `os.path.commonpath` alla cartella dei
  download.

---

## Gestione del dominio dinamico

StreamingCommunity cambia frequentemente suffisso di dominio (sequestri
AGCOM / Piracy Shield). Il portale non riscrive i link salvati: mantiene la
chiave stabile `id-slug` e rigenera l'URL corrente come
`https://{domain}/it/titles/{id-slug}`. Al cambio di dominio è sufficiente
aggiornare `settings.json → domain` (o usare il pannello *Domini salvati*, che
testa i domini noti a ogni avvio e seleziona il primo attivo).

---

## Installazione

### Opzione A — Avvio a doppio clic (consigliata, richiede Python)

Se manca Python: installarlo da [python.org](https://www.python.org/downloads/)
spuntando *Add Python to PATH*.

1. Scaricare/estrarre la repository.
2. Doppio clic su `Avvia SC Portal.bat` (il primo avvio crea il virtualenv,
   installa le dipendenze, scarica FFmpeg e apre il browser).
3. Una tantum: `Crea collegamento sul Desktop.bat` per l'icona di avvio.

Dal secondo avvio parte senza finestra di terminale. Chiusura: pulsante **⏻
Spegni** nell'interfaccia oppure `Ferma SC Portal.bat`.

### Opzione B — Eseguibile standalone (per chi non ha Python)

1. Doppio clic su `Crea EXE.bat` (una volta sola).
2. L'eseguibile è generato in `dist\SC Portal.exe`.
3. Per portare la collezione, copiare accanto all'`.exe` i file `library.json`,
   `settings.json` e la cartella `covers/`.

### Opzione C — Da terminale (sviluppatori)

```bash
python start.py
```

Modalità sviluppo con auto-reload:

```bash
# Windows
set SC_DEV=1 && python start.py
# Linux / macOS
SC_DEV=1 python start.py
```

---

## Configurazione

- **Proxy** (per nodi CDN bloccati da Piracy Shield/AGCOM): box *proxy*
  nell'interfaccia, campo `proxy` in `settings.json` o variabile `SC_PROXY`.
  Formati: `socks5://127.0.0.1:1080`, `http://user:pass@host:porta`. Vuoto =
  connessione diretta. In alternativa, una VPN di sistema.
- **Modalità sviluppo**: `SC_DEV=1` abilita l'auto-reload di Uvicorn.

---

## Requisiti

- Python 3.11+ (opzioni A e C; non necessario per l'`.exe` già generato).
- Windows per i launcher `.bat`/`.vbs` e l'`.exe`; il core Python è
  multipiattaforma (su Linux/macOS installare FFmpeg dal package manager).

---

## Risoluzione problemi

- **La ricerca non restituisce risultati**: quasi sempre il dominio va
  aggiornato. Cercare un titolo singolo, seguire il prompt e reimpostare il
  dominio attivo.
- **Un episodio non si scarica (timeout) mentre gli altri sì**: nodo CDN vidxgo
  bloccato a livello di rete (Piracy Shield/AGCOM). Attivare VPN o impostare un
  proxy.
- **Download che tornano a fallire dopo un aggiornamento del sito**: verificare
  `get_stream_details` (nomi variabili JS, query param, struttura di
  `window.streams` e della master playlist).

---

*Progetto a scopo esclusivamente educativo e dimostrativo.*
