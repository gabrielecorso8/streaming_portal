<#
  Proton Kill-Switch (firewall di Windows) — kill-switch permanente "fai-da-te".

  Blocca TUTTO il traffico in uscita del PC tranne: il tunnel Proton (adattatore
  VPN), i processi di Proton (per potersi connettere), la LAN locale (app SC Portal
  su 127.0.0.1 + TV/telefono di casa) e il DHCP. Se la VPN cade o non e' ancora su
  (anche all'avvio), niente esce in chiaro.

  Uso (PowerShell come Amministratore, nella cartella dello script):
    .\proton-killswitch.ps1 enable     # attiva
    .\proton-killswitch.ps1 disable    # disattiva e ripristina
    .\proton-killswitch.ps1 status     # mostra lo stato

  SICUREZZA: se resti senza rete, esegui 'disable' per tornare subito normale.
#>

param(
  [Parameter(Position = 0)]
  [ValidateSet("enable", "disable", "status", "toggle")]
  [string]$Action = "status"
)

$ErrorActionPreference = "Stop"
$Group = "ProtonKillSwitch"
$Profiles = @("Domain", "Private", "Public")

function Require-Admin {
  $isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
  ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $isAdmin) {
    Write-Host "Devi eseguire questo script come AMMINISTRATORE." -ForegroundColor Red
    exit 1
  }
}

function Get-ProtonAdapters {
  Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object {
    $_.InterfaceDescription -match "Proton|WireGuard|TAP-ProtonVPN|OpenVPN|WINTUN" -or
    $_.Name -match "Proton|WireGuard|VPN"
  }
}

function Get-ProtonPrograms {
  # Ricerca MIRATA (niente scansione di tutto Program Files: sarebbe lentissima).
  $dirs = @(
    "$env:ProgramFiles\Proton\VPN",
    "${env:ProgramFiles(x86)}\Proton\VPN",
    "$env:ProgramFiles\Proton VPN",
    "${env:ProgramFiles(x86)}\Proton VPN",
    "$env:ProgramFiles\Proton Technologies",
    "$env:LOCALAPPDATA\Programs\Proton VPN",
    "$env:ProgramFiles\WireGuard",
    "$env:ProgramFiles\OpenVPN\bin"
  ) | Where-Object { $_ -and (Test-Path $_) }

  $found = @()
  foreach ($d in $dirs) {
    try {
      Get-ChildItem -Path $d -Recurse -Filter *.exe -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match "Proton|VPN|openvpn|wireguard|wg" } |
      ForEach-Object { $found += $_.FullName }
    }
    catch {}
  }
  $found | Select-Object -Unique
}

function Test-KillSwitchActive {
  $rules = @(Get-NetFirewallRule -Group $Group -ErrorAction SilentlyContinue)
  $profs = Get-NetFirewallProfile -ErrorAction SilentlyContinue
  $anyBlock = @($profs | Where-Object { $_.DefaultOutboundAction -eq "Block" }).Count -gt 0
  return (($rules.Count -gt 0) -and $anyBlock)
}

function Launch-Proton {
  # Best-effort: prova ad avviare l'app Proton VPN cosi' puoi connetterti.
  $exe = @(
    "$env:ProgramFiles\Proton\VPN\ProtonVPN.exe",
    "${env:ProgramFiles(x86)}\Proton\VPN\ProtonVPN.exe",
    "$env:ProgramFiles\Proton VPN\ProtonVPN.exe",
    "${env:ProgramFiles(x86)}\Proton VPN\ProtonVPN.exe",
    "$env:LOCALAPPDATA\Programs\Proton VPN\ProtonVPN.exe"
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $exe) {
    $exe = (Get-ChildItem "$env:ProgramFiles", "${env:ProgramFiles(x86)}" -Filter "ProtonVPN.exe" -Recurse -ErrorAction SilentlyContinue -Depth 3 | Select-Object -First 1).FullName
  }
  if ($exe) {
    try { Start-Process $exe | Out-Null; Write-Host "Avvio Proton VPN: connettiti a un server." -ForegroundColor Cyan }
    catch { Write-Host "Apri Proton VPN e connettiti a un server." -ForegroundColor Cyan }
  }
  else {
    Write-Host "Apri Proton VPN e connettiti a un server." -ForegroundColor Cyan
  }
}

function Disable-KillSwitch {
  param([switch]$Quiet)
  Require-Admin
  Set-NetFirewallProfile -Name $Profiles -DefaultOutboundAction Allow -ErrorAction SilentlyContinue
  Get-NetFirewallRule -Group $Group -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
  if (-not $Quiet) {
    Write-Host "Kill-switch DISATTIVATO. Traffico di rete normale ripristinato." -ForegroundColor Yellow
  }
}

function Enable-KillSwitch {
  Require-Admin
  Write-Host "[1/5] Pulizia regole precedenti..." -ForegroundColor DarkGray
  Disable-KillSwitch -Quiet

  Write-Host "[2/5] Rilevo l'adattatore Proton..." -ForegroundColor DarkGray
  $adapters = Get-ProtonAdapters
  if (-not $adapters) {
    Write-Host "Nessun adattatore Proton/VPN trovato. Connetti Proton almeno una volta, poi riprova." -ForegroundColor Yellow
    return
  }
  Write-Host ("      trovato: " + ($adapters.Name -join ", ")) -ForegroundColor DarkGray

  Write-Host "[3/5] Consento LAN, DHCP e il tunnel Proton..." -ForegroundColor DarkGray
  New-NetFirewallRule -DisplayName "$Group - Loopback e LAN" -Group $Group -Direction Outbound `
    -Action Allow -RemoteAddress LocalSubnet, 127.0.0.1 -Profile Any | Out-Null
  New-NetFirewallRule -DisplayName "$Group - DHCP" -Group $Group -Direction Outbound `
    -Action Allow -Protocol UDP -RemotePort 67, 68 -Profile Any | Out-Null
  foreach ($a in $adapters) {
    New-NetFirewallRule -DisplayName "$Group - Tunnel ($($a.Name))" -Group $Group -Direction Outbound `
      -Action Allow -InterfaceAlias $a.Name -Profile Any | Out-Null
  }

  Write-Host "[4/5] Consento i processi di Proton (per connettersi)..." -ForegroundColor DarkGray
  $progs = @()
  try { $progs = Get-ProtonPrograms } catch {}
  foreach ($p in $progs) {
    try {
      New-NetFirewallRule -DisplayName "$Group - App $(Split-Path $p -Leaf)" -Group $Group `
        -Direction Outbound -Action Allow -Program $p -Profile Any | Out-Null
    }
    catch {}
  }
  if (-not $progs) {
    Write-Host "      (nessun eseguibile Proton trovato: ok se usi l'app ufficiale gia' connessa; la riconnessione potrebbe richiedere di ri-consentire)" -ForegroundColor DarkGray
  }

  Write-Host "[5/5] Attivo il BLOCCO predefinito in uscita..." -ForegroundColor DarkGray
  Set-NetFirewallProfile -Name $Profiles -DefaultOutboundAction Block

  Write-Host ""
  Write-Host "KILL-SWITCH ATTIVO." -ForegroundColor Green
  Write-Host ("  Tunnel consentito: " + ($adapters.Name -join ", "))
  Write-Host "  Fuori dal tunnel esce solo: LAN locale + DHCP + processi Proton."
  Write-Host "  Per annullare:  .\proton-killswitch.ps1 disable" -ForegroundColor DarkGray
}

function Status-KillSwitch {
  $rules = @(Get-NetFirewallRule -Group $Group -ErrorAction SilentlyContinue)
  $profs = Get-NetFirewallProfile -ErrorAction SilentlyContinue
  $anyBlock = @($profs | Where-Object { $_.DefaultOutboundAction -eq "Block" }).Count -gt 0
  $active = ($rules.Count -gt 0) -and $anyBlock
  Write-Host ("Kill-switch: " + $(if ($active) { "ATTIVO" } else { "non attivo" })) `
    -ForegroundColor $(if ($active) { "Green" } else { "Yellow" })
  Write-Host ("  Regole '$Group' presenti: " + $rules.Count)
  foreach ($p in $profs) {
    Write-Host ("  Profilo {0}: DefaultOutbound = {1}" -f $p.Name, $p.DefaultOutboundAction)
  }
  Write-Host ""
  Write-Host "Adattatori Proton/VPN rilevati:"
  $ad = Get-ProtonAdapters
  if ($ad) { $ad | ForEach-Object { Write-Host ("  - {0}  [{1}]  stato: {2}" -f $_.Name, $_.InterfaceDescription, $_.Status) } }
  else { Write-Host "  (nessuno: connetti Proton almeno una volta)" -ForegroundColor Yellow }
}

try {
  switch ($Action) {
    "enable" { Enable-KillSwitch }
    "disable" { Disable-KillSwitch }
    "status" { Status-KillSwitch }
    "toggle" {
      Require-Admin
      if (Test-KillSwitchActive) {
        Write-Host "Sicurezza era ATTIVA -> la spengo (navigazione normale)." -ForegroundColor Yellow
        Disable-KillSwitch
      }
      else {
        Write-Host "Sicurezza era spenta -> la ATTIVO." -ForegroundColor Green
        Launch-Proton
        Enable-KillSwitch
      }
    }
  }
}
catch {
  Write-Host ""
  Write-Host ("ERRORE: " + $_.Exception.Message) -ForegroundColor Red
  Write-Host "Se la rete e' bloccata, esegui:  .\proton-killswitch.ps1 disable" -ForegroundColor Yellow
  exit 1
}
