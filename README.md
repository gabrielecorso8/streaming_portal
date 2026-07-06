# SC Portal

App locale per cercare, guardare e scaricare film ed episodi, con riproduzione anche
da telefono/tablet e un telecomando per comandare il player dal telefono.

> Progetto a scopo educativo e dimostrativo. Usalo in modo responsabile e nel
> rispetto delle leggi sul diritto d'autore in vigore nel tuo Paese.

---

## 1. Cosa installare

1. **Python 3.10 o superiore** — [python.org/downloads](https://www.python.org/downloads/).
   Su Windows, durante l'installazione spunta **"Add Python to PATH"**.
2. **ProtonVPN** — [protonvpn.com](https://protonvpn.com/).
   Serve a nascondere il tuo IP verso i siti: **tienilo sempre acceso** prima di
   aprire SC Portal. Con la VPN attiva lascia **vuoto** il campo "proxy" dell'app.

Non serve installare altro a mano: le componenti mancanti vengono scaricate in
automatico al primo avvio.

---

## 2. Installazione

```bash
git clone <url-della-repo>
cd streaming_portal

python -m venv venv
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

pip install -r requirements.txt
```

---

## 3. Avvio

1. **Accendi ProtonVPN** e assicurati che sia connesso.
2. Avvia l'app:

```bash
python start.py
```

Si apre il browser su `http://127.0.0.1:8082`.

In alternativa, su Windows puoi generare un'app a doppio clic con **`Crea EXE.bat`**
(crea `SC Portal.exe` in `dist/`).

---

## 4. Telefono e tablet — i QR code nella home

In alto nella pagina ci sono due icone che aprono un **QR code**:

- **Icona "cast"** → installa l'app **SC Portal** sul telefono/tablet: mostra solo
  i tuoi download, pronti da riprodurre.
- **Icona "telecomando"** → installa l'app **Telecomando**: comanda il player del PC
  (play/pausa, avanti/indietro, volume, schermo intero) e scegli cosa vedere dai
  download; utile quando il PC è collegato alla TV.

Come si usa:

1. Clicca l'icona QR: la prima volta ti chiede di **attivare l'accesso dalla rete
   locale** (protetto da un codice) → conferma e **riavvia SC Portal**.
2. Con il telefono **sulla stessa Wi-Fi del PC**, inquadra il QR.
3. Dal browser del telefono usa **"Aggiungi a Home"** per installare l'app con la
   sua icona: da lì riparte da sola e ritrova il server se SC Portal è acceso.

---

## 5. Privacy

- Tieni **ProtonVPN acceso** durante ricerca e download.
- Il server è raggiungibile solo dal tuo PC; l'accesso da telefono/tablet sulla Wi-Fi
  di casa va attivato a mano ed è protetto da un codice per-installazione.
- Il codice di accesso e le impostazioni personali restano solo sul tuo computer.
