# Sicurezza / Privacy — strumenti e checklist

## 1. Kill-switch permanente (Windows Firewall) — il passo che conta di più

Con Proton **free** manca il kill-switch "permanent": all'avvio del PC o quando la
VPN cade, per qualche secondo il traffico può uscire in chiaro. Questo strumento
lo risolve a livello di **firewall di Windows**, per l'intero sistema.

### Uso semplice: un solo interruttore
Fai doppio clic su **`Sicurezza.bat`** (chiede i permessi di Amministratore):
- se la sicurezza è spenta → la **ACCENDE** e apre Proton (tu connettiti a un server);
- se è accesa → la **SPEGNE** e torni alla navigazione normale.

Lo stesso file fa accendi/spegni: **un doppio clic per andare in sicurezza quando
vuoi guardare qualcosa, un altro doppio clic per tornare all'uso normale.** Nessuna
riconfigurazione: è già tutto impostato, è solo un interruttore.

Quando è ACCESA: naviga **solo con Proton connesso**; senza VPN la rete resta
bloccata (è lo scopo). Ricorda che dopo un riavvio del PC, se lasci la sicurezza
accesa, dovrai riconnettere Proton per tornare online.

> Menu completo (attiva/disattiva/stato) opzionale: **`Proton-KillSwitch.bat`**.
> Da PowerShell (Amministratore): `.\proton-killswitch.ps1 toggle | enable | disable | status`

Nota: con questo firewall attivo, il **kill-switch dell'app diventa ridondante**
(il firewall è più forte perché vale per tutto il sistema). Puoi lasciarlo attivo
come doppia rete di sicurezza, o ignorarlo.

### Se resti senza internet
È il comportamento voluto quando la VPN è giù. Se succede anche con la VPN su
(es. Proton ha cambiato nome all'adattatore dopo un update), esegui
**`disable`** e poi di nuovo **`enable`** per ririlevare l'adattatore.

## 2. Tracce locali — 2 minuti

- **Rendi PRIVATO il repository GitHub**: `library.json` e la cartella `covers/`
  raccontano cosa salvi/guardi. (Il token in `settings.json` è già escluso dal repo.)
- **Nessun log**: aggiungi in `settings.json` la riga
  `"write_log": false`
  e riavvia. Così non viene scritto alcun `server.log`. (Se lo lasci attivo, il log
  è comunque redatto: niente token, cookie, URL firmati, IP o host dei siti.)

## 3. Igiene d'uso

- Tieni Proton **sempre acceso** quando usi l'app (il kill-switch dell'app blocca
  in automatico se ti dimentichi, ma il firewall del punto 1 è la rete vera).
- Nessun login sui siti (già così), niente condivisione/seeding.
- Il 403 di Vixcloud si aggira cambiando server Proton (di solito basta il primo cambio).

## Livello raggiunto
Punto 1 (firewall) + punto 2 (tracce) + kill-switch dell'app già integrato +
verifica TLS/anti-WebRTC/log redatti = protezione realistica intorno a **9/10**,
restando gratis. Il 10 pieno richiederebbe VPN a pagamento (kill-switch permanent)
e/o un IP residenziale; l'anonimato perfetto non esiste.
