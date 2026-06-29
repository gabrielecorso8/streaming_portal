# SC Portal

Un portale **locale, privato e sicuro** per cercare, riprodurre in streaming nel browser e **scaricare** film ed episodi da StreamingCommunity — senza pubblicità né tracker. Interfaccia moderna, libreria con cartelle, download robusti e avvio "a doppio clic" come una vera app.

---

## 🚀 Installazione (scegli come ti è più comodo)

### Opzione A — La più semplice (consigliata)

> Richiede **Python** installato. Se non ce l'hai: scaricalo da [python.org/downloads](https://www.python.org/downloads/) e durante l'installazione **spunta "Add Python to PATH"**.

1. **Scarica la repo** (pulsante verde *Code → Download ZIP* su GitHub) ed **estraila** in una cartella a piacere.
2. Doppio clic su **`Avvia SC Portal.bat`**. Al primo avvio installa da solo tutto il necessario (ambiente Python `venv`, dipendenze, FFmpeg) e **apre la piattaforma nel browser**. Il primo avvio può richiedere qualche minuto.
3. (Una volta sola) Doppio clic su **`Crea collegamento sul Desktop.bat`**: aggiunge l'icona **SC Portal** sul Desktop. Da lì la apri come una normale app.

Dal secondo avvio in poi parte **senza finestra del terminale**. Per **chiuderla** usa il pulsante **⏻ Spegni** in alto a destra nella piattaforma (in alternativa `Ferma SC Portal.bat`).

### Opzione B — App standalone `.exe` (per chi NON ha Python)

Per condividere SC Portal con qualcuno che non vuole installare nulla:

1. Tu (che hai Python) fai doppio clic su **`Crea EXE.bat`** una volta sola.
2. Al termine trovi l'app in **`dist\SC Portal.exe`**.
3. Condividi quel file: chi lo riceve fa **doppio clic**, senza Python né installazioni. Al primo avvio scarica FFmpeg da solo e apre il browser.

> Per portarti la tua collezione nell'.exe, copia accanto al file `.exe` i tuoi `library.json`, `settings.json` e la cartella `covers/`.

### Opzione C — Da terminale (sviluppatori)

```bash
python start.py
```

Apre il browser su `http://localhost:8082`. Per la modalità sviluppo con auto-reload: Windows `set SC_DEV=1 && python start.py`, Linux/Mac `SC_DEV=1 python start.py`.

---

## 🎬 Come si usa

1. (Opzionale ma utile) Attiva una **VPN** o **Cloudflare WARP**: senza, alcuni contenuti potrebbero non scaricarsi (vedi *Episodi che non si scaricano*).
2. Cerca un titolo nella barra in alto, **oppure** incolla il link di un film/episodio di StreamingCommunity.
3. Apri il titolo: **riproduci in streaming** o **scarica**. Per le serie scegli stagione ed episodio.
4. Organizza ciò che ti piace nella **Libreria** (preferiti, cartelle, collezioni). Buona visione!

---

## ✨ Funzionalità principali

### Ricerca
- **Ricerca intelligente** per titolo, regista o parole chiave; oppure incolla direttamente un URL (StreamingCommunity o cloni/vidxgo).
- **Filtri**: film/serie, ordinamento per rilevanza, uscita recente / meno recente, voto, genere.
- **Risultati paginati**: vengono mostrati *tutti* i risultati, non solo i primi.
- **Pulsante ✕** per svuotare la barra e annullare la ricerca.
- **Ricerca a LISTA con `;`** — incolla più titoli separati da punto e virgola (es. `Iron Man; Thor; Avengers`): la piattaforma cerca tutti in parallelo, li mostra **già selezionati** e con un clic crei una **cartella-collezione**. Perfetto per importare intere saghe generate da un'AI.

### Libreria e organizzazione
- **Libreria automatica**: ogni titolo aperto/scaricato resta salvato e cliccabile (persistente tra le sessioni).
- **Preferiti** (titoli **e cartelle**): mostrati in un blocco dedicato in cima, **nettamente separato** dal resto.
- **Cartelle e sottocartelle** con locandina: raggruppa i titoli per saga/genere/regista; le cartelle preferite e i risultati di ricerca mostrano anche le **sottocartelle annidate**.
- **Copertina automatica**: se non ne imposti una, la cartella usa l'immagine del titolo più vecchio che contiene.
- **Drag & drop completo**: trascina le **locandine** dentro le cartelle, **sposta i titoli** tra cartelle, **riordina** i titoli, e trascina le **cartelle** per **annidarle** o riportarle in radice.
- **Filtri per cartella** (film/serie, recente/meno recente, rilevanza) e **ricerca nella libreria** con gli stessi filtri.

### Riproduzione e download
- **Streaming in-browser** con lettore HLS (`hls.js`) e audio italiano, superando i blocchi CORS/Referer via reverse-proxy locale.
- **Download HLS parallelo** multithread, con decrittografia **AES-128** e fusione via **FFmpeg**.
- **Riproduzione fluida (no micro-stop)**: i segmenti `.ts` sono uniti a livello di byte e rimuxati in un passaggio, eliminando i micro-blocchi tra le parti; `+faststart` per seek/streaming reattivi.
- **Download robusti e ripristinabili** (resume dei segmenti già scaricati, ri-download mirato dei mancanti) con **velocità ottimizzata** (keep-alive, DoH multi-IP, refresh automatico dei token Vixcloud) e **tempo stimato (ETA)**.
- **Coda** con download **interrompibili**. La lista download **non** viene ricordata tra le sessioni: si conservano solo libreria e preferiti.

### Interfaccia
- Dashboard ordinata: **ricerca** al centro, **Libreria** (sinistra) e **Domini salvati** (destra) come **strumenti espandibili** (così tutto sta in una schermata), **download** centrato sotto.
- Design moderno con logo a gradiente, glassmorphism e animazioni fluide.
- **Avvio senza terminale** e pulsante **⏻ Spegni** integrato.

---

## 🔒 Sicurezza

- **Header di sicurezza HTTP** su ogni risposta (Content-Security-Policy, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy).
- **Protezione anti-CSRF**: le API che modificano dati accettano **solo richieste dalla piattaforma stessa**; nessun sito esterno può pilotarle.
- **Anti DNS-rebinding**: l'host viene validato (solo loopback e rete locale privata); **CORS senza wildcard**.
- Scrittura dei file vincolata alle cartelle del progetto (niente path traversal).

---

## 🌐 Dominio dinamico

StreamingCommunity cambia spesso suffisso di dominio e i domini vengono sequestrati (AGCOM / Piracy Shield). Per questo:

- I domini salvati vengono **testati a ogni avvio**; viene scelto automaticamente il primo attivo.
- Se un titolo punta a un dominio non più attivo, l'app **te lo segnala** e propone di **aggiornare il dominio** (rilevamento automatico o incollando un link funzionante).
- Gestisci tutto dal pannello **Domini salvati** (aggiungi, usa, rimuovi, "Testa ora").

> Se la **ricerca non restituisce nulla** (anche quella a lista), quasi sempre il dominio va aggiornato: cerca un titolo singolo, segui il prompt e reimposta il dominio attivo.

---

## 📺 Visione su TV

- **Chromecast**: apri il portale in Chrome, avvia un titolo e usa *Trasmetti → Trasmetti scheda*.
- **TV non smart**: copia i `.mp4` scaricati su una chiavetta/HDD USB e collegali alla TV, oppure collega il PC alla TV via HDMI.

---

## 🛠️ Episodi che non si scaricano (nodi CDN bloccati)

I cloni servono i video tramite **vidxgo**, che distribuisce gli episodi su più nodi CDN. Alcuni nodi sono bloccati dal provider italiano (**Piracy Shield / AGCOM**): l'IP è vivo nel mondo ma la tua rete lo "droppa", quindi quel singolo episodio va in **timeout** mentre gli altri funzionano. Non è un bug del codice ma di raggiungibilità di rete. Soluzioni:

- **Più semplice:** attiva una **VPN** di sistema.
- **In-app:** imposta un **proxy** nel box "proxy" in alto (o nel campo `proxy` di `settings.json`, o variabile `SC_PROXY`). Esempi: `socks5://127.0.0.1:1080`, `http://user:pass@host:porta`. Vuoto = connessione diretta.

---

## 📂 Struttura del progetto

```
streaming_portal/
├── Avvia SC Portal.bat            # Avvio a doppio clic (setup automatico)
├── SC Portal.vbs                  # Avvio invisibile (usato dall'icona Desktop)
├── Crea collegamento sul Desktop.bat
├── Ferma SC Portal.bat            # Stop di emergenza
├── Crea EXE.bat / SC Portal.spec  # Generano l'eseguibile standalone
├── launcher_exe.py                # Entry point dell'.exe
├── start.py                       # Bootstrap (venv + ffmpeg) e avvio server
├── api.py                         # Server FastAPI: ricerca, libreria, domini, proxy m3u8/AES, sicurezza
├── downloader.py                  # Download parallelo, coda, fusione segmenti
├── requirements.txt               # Dipendenze Python
├── settings.json                  # Dominio/cartelle/proxy (incluso nella repo)
├── library.json                   # Libreria e preferiti (inclusi nella repo)
├── covers/                        # Locandine cartelle (incluse nella repo)
└── static/                        # Interfaccia (index.html, styles.css, app.js, favicon)
```

> `settings.json`, `library.json` e `covers/` sono **inclusi** nella repo, così la collezione curata (titoli, cartelle, locandine) vi