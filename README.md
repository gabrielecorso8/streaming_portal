# Unofficial Portal

Un portale web locale, privato e sicuro per cercare, riprodurre in-browser e scaricare contenuti da StreamingCommunity senza popup pubblicitari o script di tracciamento fastidiosi.

## Funzionalità

- **Interfaccia Web Premium**: Design moderno stile Netflix con modalità scura, glassmorphism e animazioni fluide.
- **Ricerca e Dettagli**: Cerca titoli in tutto il sito o caricali all'istante incollando direttamente l'URL di StreamingCommunity.
- **Streaming in-browser**: Lettore HLS (`hls.js`) integrato per riprodurre video e audio (italiano) in streaming diretto superando i blocchi CORS/Referer con un reverse-proxy locale.
- **Download HLS parallelo**: Scarica film o episodi in background tramite un downloader multithread ottimizzato con decrittografia automatica AES-128 e fusione via FFmpeg.
- **Setup automatico**: Lo script di avvio configura l'ambiente virtuale Python (`venv`), scarica l'eseguibile di FFmpeg localmente e installa le dipendenze in un solo click.

## Requisiti

- **Python 3.11** o superiore.

## Installazione e Avvio

1. Clona il repository o scarica i file in una cartella.
2. Apri il terminale o prompt dei comandi nella cartella del progetto.
3. Esegui il comando:
   ```bash
   python start.py
   ```
4. Apri il browser all'indirizzo:
   [http://127.0.0.1:8082](http://127.0.0.1:8082)

Lo script si occuperà automaticamente di scaricare il binario statico di `ffmpeg` per Windows (se mancante) e configurare le dipendenze Python necessarie.

## Personalizzazione Dominio

Dato che StreamingCommunity cambia periodicamente il suo suffisso di dominio (es. `.computer`, `.co`, `.vet`, `.broker`), puoi aggiornarlo all'istante dall'interfaccia utente nell'angolo in alto a destra.

## Episodi che non si scaricano (nodi CDN bloccati)

I siti "clone" servono i video tramite **vidxgo**, che distribuisce gli episodi
su più nodi CDN (`cdn.v1.media-XXX.d2b.you`). Alcuni di questi nodi vengono
bloccati a livello di provider italiano (**Piracy Shield / AGCOM**): l'indirizzo
IP è vivo nel resto del mondo ma la tua connessione lo "droppa" silenziosamente,
quindi il download di quel singolo episodio va in **timeout** mentre gli altri
episodi (ospitati su nodi non bloccati) funzionano normalmente.

Non è un problema del codice ma di raggiungibilità di rete. Per aggirarlo:

- **Più semplice:** attiva una **VPN** a livello di sistema. Anche la connessione
  diretta torna a raggiungere il nodo, senza altra configurazione.
- **In-app:** imposta un **proxy** nel box in alto a destra (o via campo `proxy`
  in `settings.json`, o variabile d'ambiente `SC_PROXY`). Esempi:
  `socks5://127.0.0.1:1080`, `http://user:pass@host:porta`. Lascialo vuoto per
  tornare alla connessione diretta. Il proxy viene usato solo per il traffico
  vidxgo/CDN del download.

## Struttura del Progetto

```
streaming_portal/
├── api.py           # Server FastAPI e reverse-proxy per flussi m3u8/AES
├── downloader.py    # Motore di download parallelo e decrittografia segmenti
├── start.py         # Script di bootstrap automatico (venv + ffmpeg)
├── requirements.txt # Dipendenze Python
├── .gitignore       # File da escludere in Git
└── static/          # Interfaccia grafica (HTML, CSS, JS)
    ├── index.html
    ├── styles.css
    └── app.js
```

---

*Nota: Questo progetto ha esclusivamente finalità educative e dimostrative.*
