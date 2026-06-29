# Handoff per Claude Code

Data: 2026-06-28
Progetto: streaming_portal
Workspace: C:\Users\Gabri\Desktop\fucina-ai\03_laboratorio\streaming_portal

## Obiettivo della piattaforma

Portale locale FastAPI + frontend statico per cercare titoli su StreamingCommunity, salvarli in libreria/preferiti, aprire streaming e scaricare contenuti HLS in background.

Il dominio StreamingCommunity cambia spesso. Il dominio attualmente configurato e verificato e':

```text
streamingcommunityz.tech
```

## Stato attuale

Le modifiche principali gia' fatte:

- Gestione dominio piu' robusta in `api.py`.
- Supporto ai nuovi percorsi localizzati di StreamingCommunity (`/it/titles/...`, `/it/iframe/...`).
- Ricerca intelligente da titolo/regista/parole chiave tramite scraping della pagina `/it/search?q=...`.
- Filtri ricerca frontend per ordinare per recente, voto e genere.
- Migrazione della libreria esistente verso URL correnti e chiavi stabili `id-slug`.
- Download Vixcloud riparato dopo errore `403 Failed to fetch video playlist`.

## File chiave

- `api.py`: backend FastAPI, risoluzione dominio, ricerca, dettagli titolo, stagioni/episodi, streaming Vixcloud, API download.
- `static/app.js`: logica UI, ricerca, apertura risultati, download film/episodi, libreria/preferiti.
- `static/index.html`: struttura UI.
- `static/styles.css`: stile UI.
- `downloader.py`: motore download HLS, coda, segmenti paralleli, resume, merge con FFmpeg.
- `library.json`: libreria e preferiti.
- `settings.json`: dominio attivo, domini noti, impostazioni download/proxy.

## Prassi dominio StreamingCommunity

Non aggiornare manualmente ogni link salvato quando cambia il dominio.

La logica corretta e':

1. Salvare ogni titolo con chiave stabile `id-slug`, per esempio `5669-the-bear`.
2. Generare l'URL visibile al volo usando il dominio corrente:

```text
https://{domain}/it/titles/{id-slug}
```

3. Quando il dominio cambia, aggiornare solo `settings.json -> domain`.
4. La libreria deve continuare a funzionare perche' i link vengono rigenerati dalla chiave stabile.

Nota: in `api.py`, `_title_view(e)` rigenera gia' gli URL correnti quando la key ha forma `id-slug`.

## StreamingCommunity: parti gia' adattate

Le rotte vecchie non bastano piu'. Usare prima le nuove:

- Dettaglio titolo: `/it/titles/{id-slug}`
- Stagione: `/it/titles/{id-slug}/season-{n}`
- Iframe: `/it/iframe/{id}`
- Ricerca: `/it/search?q={query}`

`/api/search` vecchio di StreamingCommunity non e' piu' affidabile: nel backend locale ora `/api/search` fa parsing della pagina Inertia.

## Download Vixcloud: fix importante

Problema risolto:

```text
Fallito: Failed to fetch video playlist. Status code: 403
```

Causa:

Il frontend costruiva vecchie playlist Vixcloud tipo:

```text
https://vixcloud.co/playlist/{video_id}?type=video&rendition=...&token=...&expires=...
```

I nuovi embed Vixcloud non espongono piu' i token per qualita' come prima. Ora la pagina embed contiene:

- `window.streams`
- `window.masterPlaylist`
- parametri `token`, `expires`, `asn`
- parametri importanti dall'iframe come `lang`, `canPlayFHD`, `scz`

La nuova logica in `api.py -> get_stream_details`:

1. Legge l'iframe StreamingCommunity.
2. Apre l'embed Vixcloud.
3. Estrae `window.video`, `params`, `window.streams`.
4. Costruisce la vera master playlist Vixcloud includendo `ub=1`, token, `expires`, `h=1`, `scz=1`, `lang=it`.
5. Scarica la master playlist.
6. Sceglie la variante video con banda piu' alta.
7. Sceglie la traccia audio default.
8. Ritorna nel JSON:

```json
{
  "download": {
    "master_url": "...",
    "video_url": "...",
    "audio_url": "...",
    "headers": {}
  }
}
```

La nuova logica in `static/app.js -> triggerDownload`:

1. Chiama `/api/stream/url?id=...`.
2. Se `data.download.video_url` esiste, invia direttamente quei link a `/api/download`.
3. Usa il vecchio metodo solo come fallback legacy.

Questo vale anche per titoli aperti dai risultati ricerca e poi salvati nei preferiti.

## Verifiche gia' fatte

Comandi/verifiche completate:

```text
.\venv\Scripts\python.exe -m py_compile api.py downloader.py vidxgo.py start.py
```

OK.

Controllo sintassi frontend con Node bundled:

```text
C:\Users\Gabri\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe --check static\app.js
```

OK.

Test live su contenuto Vixcloud di esempio, id StreamingCommunity `1994`:

- `download.video_url`: presente.
- `download.audio_url`: presente.
- qualita': `1080p`, `720p`, `480p`.
- playlist video: status `200`, 2044 segmenti.
- playlist audio: status `200`, 2044 segmenti.
- key AES: status `200`, 16 byte.
- primo segmento video: status `200`.

Non e' stato avviato un download completo di film per evitare scaricamento pesante, ma e' stato verificato il punto esatto che prima falliva con 403.

## Note su rete e test

La sandbox puo' bloccare richieste esterne con errori tipo:

```text
WinError 10013
```

Quando succede, non e' necessariamente un bug dell'app: serve accesso rete reale per parlare con StreamingCommunity/Vixcloud.

Per test live, usare l'ambiente locale:

```text
.\venv\Scripts\python.exe
```

Non usare `python` di sistema se mancano pacchetti come `requests` o `m3u8`.

## Worktree/git

Attenzione: `git status` mostra un worktree anomalo, con molti file segnati sia come deleted sia come untracked. Non fare reset o checkout distruttivi senza consenso esplicito dell'utente.

Gestire le modifiche con cautela e leggere i file correnti dal filesystem.

## Libreria

Sono stati creati backup:

- `library.json.bak_link_migration`
- `settings.json.bak_link_migration`

La libreria e' stata migrata quasi tutta al dominio corrente. Un titolo era rimasto non risolto in modo affidabile durante la migrazione:

```text
L'amico di famiglia
```

Se serve, cercarlo manualmente con la nuova ricerca intelligente e aggiornare la voce quando il match e' certo.

## Prossimi passi consigliati

1. Fare un test end-to-end leggero dal browser locale:
   - cercare un titolo;
   - aprirlo;
   - salvarlo nei preferiti;
   - avviare download;
   - cancellarlo dopo pochi secondi se non si vuole scaricare tutto.

2. Aggiungere un piccolo endpoint diagnostico opzionale per verificare:
   - dominio attivo;
   - ricerca;
   - dettagli titolo;
   - stream URL;
   - playlist video/audio.

3. Migliorare UI ricerca:
   - mostrare chiaramente quando il filtro genere richiede piu' tempo;
   - aggiungere fallback se il sito non restituisce metadata completi.

4. Rendere piu' esplicita la prassi domini nella UI:
   - mostrare "dominio attivo";
   - bottone "rileva dominio";
   - avviso se un link salvato viene rigenerato dal nuovo dominio.

5. Se i download tornano a fallire, controllare prima `get_stream_details` e verificare se Vixcloud ha cambiato di nuovo:
   - nomi variabili JS;
   - query param richiesti;
   - struttura `window.streams`;
   - struttura master playlist.

## Comandi utili

Avvio locale:

```text
.\venv\Scripts\python.exe start.py
```

Compilazione backend:

```text
.\venv\Scripts\python.exe -m py_compile api.py downloader.py vidxgo.py start.py
```

Controllo sintassi frontend:

```text
C:\Users\Gabri\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe --check static\app.js
```

Ricerca rapida nel codice:

```text
rg -n "get_stream_details|triggerDownload|download_info|streamingcommunity|Vixcloud" api.py static/app.js downloader.py
```

