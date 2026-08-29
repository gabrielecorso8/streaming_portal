<#
  Proton Kill-Switch (firewall di Windows) — kill-switch permanente "fai-da-te".

  Cosa fa:
    - Blocca TUTTO il traffico in uscita del PC per default...
    - ...tranne: il tunnel Proton (adattatore VPN), i processi di Proton (per
      poter STABILIRE la connessione), la LAN locale (così l'app SC Portal su
      127.0.0.1 e i dispositivi in casa continuano a funzionare) e il DHCP.

  Effetto: se la VPN cade o non è ancora connessa (anche all'avvio del PC),
  niente esce in chiaro. È l'equivalente del kill-switch "permanent" a pagamento,
  ma a livello di Windows Firewall, quindi vale per l'INTERO sistema, non solo
  per l'app.

  Uso (PowerShell come Amministratore):
    .\proton-killswitch.ps1 enable     # attiva
    .\proton-killswitch.ps1 disable    # disattiva e ripristina
    .\proton-killswitch.ps1 status     # mostra lo stato

  SICUREZZA: se qualcosa va storto (niente internet nemmeno con VPN su),
  esegui  .\proton-killswitch.ps1 disable  per tornare subito alla normalità.
#>

param(
  [Parameter(Position = 0)]
  [ValidateSet("enable", "disable", "status")]
  [string]$Action = "status"
)

$Group = "ProtonKillSwitch"

function Require-Admin {
  $isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
  ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $isAdmin) {
    Write-Host "Devi eseguire questo script come AMMINISTRATORE." -ForegroundColor Red
    exit 1
  }
}

function Get-ProtonAdapters {
  # Cerca gli adattatori del tunnel Proton (app ufficiale, WireGuard, OpenVPN/TAP).
  Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object {
    $_.InterfaceDescription -match "Proton|WireGuard|TAP-ProtonVPN|OpenVPN|WINTUN" -or
    $_.Name -match "Proton|WireGuard|VPN"
  }
}

function Get-ProtonPrograms {
  $found = @()
  $bases = @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA) | Where-Object { $_ }
  foreach ($base in $bases) {
    try {
      Get-ChildItem -Path $base -Recurse -ErrorAction SilentlyContinue `
        -Include "ProtonVPN*.exe", "*Proton*Service*.exe", "openvpn.exe", "wireguard.exe" |
      ForEach-Object { $found += $_.FullName }
    }
    catch {}
  }
  $found | Select-Object -Unique
}

function Disable-KillSwitch {
  param([switch]$Quiet)
  Require-Admin
  # Ripristina il comportamento normale (uscita consentita) e rimuove le regole.
  Set-NetFirewallProfile -All -DefaultOutboundAction Allow -ErrorAction SilentlyContinue
  Get-NetFirewallRule -Group $Group -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
  if (-not $Quiet) {
    Write-Host "Kill-switch DISATTIVATO. Traffico di rete normale ripristinato." -ForegroundColor Yellow
  }
}

function Enable-KillSwitch {
  Require-Admin
  Disable-KillSwitch -Quiet   # parte pulito

  $adapters = Get-ProtonAdapters
  if (-not $adapters) {
    Write-Host "Nessun adattatore Proton/VPN trovato." -ForegroundColor Yellow
    Write-Host "Connetti Proton VPN almeno una volta (così Windows crea l'adattatore), poi rilancia 'enable'." -ForegroundColor Yellow
    exit 1
  }

  # 1) Consenti loopback + LAN locale: l'app su 127.0.0.1 e i dispositivi di casa
  #    (TV/telefono) devono continuare a funzionare anche col kill-switch attivo.
  New-NetFirewallRule -DisplayName "$Group - Loopback e LAN" -Group $Group -Direction Outbound `
    -Action Allow -RemoteAddress LocalSubnet, 127.0.0.1 -Profile Any | Out-Null
  # 2) Consenti DHCP (ottenere l'IP locale) e DNS verso la LAN (router)
  New-NetFirewallRule -DisplayName "$Group - DHCP" -Group $Group -Direction Outbound `
    -Action Allow -Protocol UDP -RemotePort 67, 68 -Profile Any | Out-Null

  # 3) Consenti TUTTO ciò che passa dal tunnel Proton
  foreach ($a in $adapters) {
    New-NetFirewallRule -DisplayName "$Group - Tunnel ($($a.Name))" -Group $Group -Direction Outbound `
      -Action Allow -InterfaceAlias $a.Name -Profile Any | Out-Null
  }

  # 4) Consenti ai processi di Proton di raggiungere i server VPN sull'adattatore
  #    fisico (altrimenti la VPN non riuscirebbe nemmeno a connettersi).
  $progs = Get-ProtonPrograms
  foreach ($p in $progs) {
    try {
      New-NetFirewallRule -DisplayName "$Group - App $(Split-Path $p -Leaf)" -Group $Group `
        -Direction Outbound -Action Allow -Program $p -Profile Any | Out-Null
    }
    catch {}
  }

  # 5) Blocca per default tutto il resto in uscita = KILL SWITCH
  Set-NetFirewallProfile -All -DefaultOutboundAction Block

  Write-Host "Kill-switch ATTIVO." -ForegroundColor Green
  Write-Host ("  Adattatori tunnel consentiti: " + ($adapters.Name -join ", "))
  Write-Host ("  Processi Proton consentiti:   " + ($(if ($progs) { ($progs | ForEach-Object { Split-Path $_ -Leaf }) -join ", " } else { "nessuno trovato (ok se usi l'app Proton di default)" })))
  Write-Host "  Fuori dal tunnel esce solo: LAN locale + DHCP + processi Proton." -ForegroundColor Green
  Write-Host "  Per annullare: .\proton-killswitch.ps1 disable" -ForegroundColor DarkGray
}

function Status-KillSwitch {
  $rules = Get-NetFirewallRule -Group $Group -ErrorAction SilentlyContinue
  $active = [bool]$rules
  $profiles = Get-NetFirewallProfile -ErrorAction SilentlyContinue
  $anyBlock = $profiles | Where-Object { $_.DefaultOutboundAction -eq "Block" }
  Write-Host ("Kill-switch: " + $(if ($active -and $anyBlock) { "ATTIVO" } else { "non attivo" })) `
    -ForegroundColor $(if ($active -and $anyBlock) { "Green" } else { "Yellow" })
  Write-Host ("  Regole '$Group' presenti: " + $(if ($rules) { $rules.Count } else { 0 }))
  foreach ($p in $profiles) {
    Write-Host ("  Profilo {0}: DefaultOutbound = {1}" -f $p.Name, $p.DefaultOutboundAction)
  }
  Write-Host ""
  Write-Host "Adattatori Proton/VPN rilevati:"
  $ad = Get-ProtonAdapters
  if ($ad) { $ad | ForEach-Object { Write-Host ("  - {0}  [{1}]  stato: {2}" -f $_.Name, $_.InterfaceDescription, $_.Status) } }
  else { Write-Host "  (nessuno: connetti Proton almeno una volta)" -ForegroundColor Yellow }
}

switch ($Action) {
  "enable" { Enable-KillSwitch }
  "disable" { Disable-KillSwitch }
  "status" { Status-KillSwitch }
}
