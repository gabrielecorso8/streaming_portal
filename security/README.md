# Sicurezza / Privacy — strumenti e checklist

## 1. Kill-switch permanente (Windows Firewall) — il passo che conta di più

Con Proton **free** manca il kill-switch "permanent": all'avvio del PC o quando la
VPN cade, per qualche secondo il traffico può uscire in chiaro. Questo strumento
lo risolve a livello di **firewall di Windows**, per l'intero sistema.

### Come si usa
1. Connetti Proton VPN **almeno una volta** (così Windows crea l'adattatore del tunnel).
2. Fai doppio clic su **`Proton-KillSwitch.bat`** (chiede i permessi di Amministratore).
3. Scegli **1 = Attiva**.

Da quel momento, se la VPN non è attiva, esce solo: LAN locale (l'app SC Portal su
`127.0.0.1`, TV/telefono di casa), DHCP e i processi di Proton (per potersi
connettere). Tutto il resto è bloccato finché il tunnel non è su.

Per tornare alla normalità: **2 = Disattiva**. Per controllare: **3 = Stato**.

> In alternativa, da PowerShell (Amministratore):
> `.\proton-killswitch.ps1 enable | disable | status`

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
