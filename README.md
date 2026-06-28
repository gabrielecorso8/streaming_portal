# SC Portal

Un portale web locale, privato e sicuro per cercare, riprodurre in-browser e scaricare contenuti da StreamingCommunity senza popup pubblicitari o script di tracciamento fastidiosi.

## Guida Rapida

1. Scarica la repo
2. Avvia `python start.py`
3. (Opzionale) Scarica Cloudflare One Client per una connessione privata (senza, alcuni contenuti potrebbero non scaricarsi)
4. (Opzionale) Installa LocalSend su PC e su smartphone/tablet per l'invio rapido dei file
5. Copia il link di un film o di una puntata su SC Portal
6. Scarica ciò che vuoi vedere
7. Enjoy

## Funzionalità

- **Interfaccia Web Premium**: Design moderno stile Netflix con modalità scura, glassmorphism e animazioni fluide.
- **Ricerca e Dettagli**: Cerca titoli in tutto il sito o caricali all'istante incollando direttamente l'URL di StreamingCommunity o di un sito clone/vidxgo.
- **Streaming in-browser**: Lettore HLS (`hls.js`) integrato per riprodurre video e audio (italiano) in streaming diretto, superando i blocchi CORS/Referer con un reverse-proxy locale.
- **Download HLS parallelo**: Scarica film o episodi in background tramite un downloader multithread ottimizzato, con decrittografia automatica AES-128 e fusione via FFmpeg.
- **Riproduzione fluida (no micro-stop)**: I segmenti `.ts` vengono uniti a livello di byte e rimuxati in un solo passaggio, preservando i timestamp originali. Questo elimina i micro-blocchi che il classico `concat` di FFmpeg introduce a ogni giunzione. `+faststart` rende anche seek/streaming più reattivi.
- **Download robusti e ripristinabili**: I segmenti già scaricati vengono riutilizzati (resume), i segmenti mancanti vengono ri-scaricati in modo mirato prima della fusione e, se restano buchi, il download fallisce con un messaggio chiaro invece di produrre un file con salti.
- **Coda di download persistente**: Più download in coda con concorrenza limitata; lo stato sopravvive al riavvio e i download interrotti riprendono automaticamente.
- **Setup automatico**: Lo script di avvio configura l'ambiente virtuale Python (`venv`), scarica l'eseguibile di FFmpeg localmente e installa le dipendenze in un solo click.

## Libreria e organizzazione

- **Libreria dei titoli**: Ogni titolo che apri o scarichi viene salvato in una libreria cliccabile (cronologia automatica). Cliccando un titolo lo riapri senza reincollare il link.
- **Preferiti**: Dalla scheda di un titolo puoi premere il pulsante **★ Salva nei preferiti**; i preferiti restano in cima alla libreria e persistono tra le sessioni.
- **Domini ricordati**: I domini StreamingCommunity che usi vengono memorizzati e, a ogni avvio, testati uno per uno per verificare se sono ancora attivi (pallino verde/rosso). Non vieni mai costretto a reinserire lo stesso dominio.
- **Cartelle/Playlist nella libreria con locandina**: Puoi creare cartelle (per genere, saga, ecc.) e raggruppare i **titoli della libreria** al loro interno, impostando una **locandina a scelta caricata dal PC**. Con il pulsante **+** su una cartella apri un selettore multiplo che pesca dai titoli salvati per aggiungerne quanti vuoi in un colpo solo.

## Dominio dinamico

Dato che StreamingCommunity cambia periodicamente il suo suffisso di dominio (es. `.computer`, `.co`, `.vet`, `.broker`) e i domini vengono spesso sequestrati (AGCOM / Piracy Shield):

- I domini salvati vengono **testati a ogni avvio**; viene selezionato automaticamente il primo attivo.
- Se provi ad accedere a un titolo il cui dominio non è più attivo, l'app te lo segnala (solo in quel caso) e ti propone di **aggiornare il dominio** automaticamente o incollando un link funzionante.
- Puoi gestire i domini dal pannello "Domini salvati" (aggiungi, usa, rimuovi, "Testa ora").

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
   [http://localhost:8082](http://localhost:8082)

Lo script si occuperà automaticamente di scaricare il binario statico di `ffmpeg` per Windows (se mancante) e configurare le dipendenze Python necessarie.

> Il server è in ascolto su `0.0.0.0:8082`, quindi è raggiungibile anche dagli altri dispositivi sulla stessa rete (es. da telefono o tablet) all'indirizzo `http://IP-DEL-PC:8082`. Nel browser usa sempre `localhost`/`127.0.0.1` o l'IP del PC: l'indirizzo `0.0.0.0` non è navigabile.

## Visione su TV

- **Chromecast**: apri il portale in Chrome, avvia un titolo e usa "Trasmetti -> Trasmetti scheda".
- **TV non smart**: copia i file `.mp4` scaricati su una chiavetta/hard disk USB e collegali alla TV, oppure collega il PC alla TV via HDMI. (Il DLNA richiede una TV connessa in rete e quindi non funziona su TV non smart.)

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
├── api.py           # Server FastAPI: reverse-proxy m3u8/AES, libreria, domini, cartelle
├── downloader.py    # Motore di download parallelo, coda persistente, fusione segmenti
├── start.py         # Script di bootstrap automatico (venv + ffmpeg)
├── requirements.txt # Dipendenze Python
├── .gitignore       # File da escludere in Git
├── settings.json    # Dominio attivo, domini ricordati, cartelle, proxy (generato, ignorato da Git)
├── library.json     # Libreria/preferiti dei titoli (generato, ignorato da Git)
├── covers/          # Locandine delle cartelle caricate dall'utente (ignorata da Git)
└── static/          # Interfaccia grafica (HTML, CSS, JS)
    ├── index.html
    ├── styles.css
    └── app.js
```

---

*Nota: Questo progetto ha esclusivamente finalità educative e dimostrative.*
