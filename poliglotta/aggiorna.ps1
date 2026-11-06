# Poliglotta - aggiornamento da GitHub (Windows).
# Scarica l'ultima versione pubblicata e sostituisce i file in questa cartella.
#   Doppio clic su "Aggiorna Poliglotta.bat"        -> aggiorna adesso
#   Doppio clic su "Aggiornamenti automatici.bat"   -> attiva o disattiva il controllo giornaliero
param(
  [switch]$Silenzioso,
  [switch]$Pianifica
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$dir = $PSScriptRoot
$taskName = 'Poliglotta - aggiornamento automatico'

function Fine([int]$code) {
  if (-not $Silenzioso) { Write-Host ''; Read-Host 'Premi Invio per chiudere' | Out-Null }
  exit $code
}

if ($Pianifica) {
  try {
    $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($existing) {
      $r = Read-Host 'Gli aggiornamenti automatici sono già attivi. Vuoi disattivarli? (S/N)'
      if ($r -match '^[sS]') {
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
        Write-Host 'Aggiornamenti automatici disattivati.'
      } else {
        Write-Host 'Nessuna modifica: restano attivi.'
      }
      Fine 0
    }
    $ps1 = Join-Path $dir 'aggiorna.ps1'
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$ps1`" -Silenzioso"
    $trigger = New-ScheduledTaskTrigger -Daily -At '12:00'
    $opts = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $opts -Description 'Scarica da GitHub la nuova versione di Poliglotta, se disponibile.' | Out-Null
    Write-Host 'Fatto! Ogni giorno Poliglotta controlla se esce una nuova versione e la scarica da sola'
    Write-Host '(se a mezzogiorno il computer è spento, lo fa appena lo riaccendi).'
    Write-Host 'La nuova versione si attiva alla prossima apertura di Chrome.'
  } catch {
    Write-Host "Non sono riuscito ad attivare gli aggiornamenti automatici: $($_.Exception.Message)"
    Write-Host 'Riprova con clic destro su "Aggiornamenti automatici.bat" -> Esegui come amministratore.'
    Fine 1
  }
  Fine 0
}

try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  $cfg = Get-Content -LiteralPath (Join-Path $dir 'update.json') -Raw | ConvertFrom-Json
  if (-not $cfg.repo) { throw 'update.json non indica dove sono pubblicate le versioni.' }
  if ($env:POLIGLOTTA_API) { $api = $env:POLIGLOTTA_API.TrimEnd('/') }
  elseif ($cfg.api) { $api = ([string]$cfg.api).TrimEnd('/') }
  else { $api = 'https://api.github.com' }
  $headers = @{ 'User-Agent' = 'Poliglotta'; 'Accept' = 'application/vnd.github+json' }

  $local = (Get-Content -LiteralPath (Join-Path $dir 'manifest.json') -Raw | ConvertFrom-Json).version
  Write-Host "Versione installata: $local"
  $zipUrl = $null
  try {
    $release = Invoke-RestMethod -Uri "$api/repos/$($cfg.repo)/releases/latest" -Headers $headers -UseBasicParsing
    $remote = ([string]$release.tag_name) -replace '^[vV]', ''
    $asset = $release.assets | Where-Object { $_.name -like '*.zip' } | Select-Object -First 1
    if ($asset) { $zipUrl = $asset.browser_download_url }
  } catch {
    # GitHub limita le richieste anonime (60 all'ora): leggo la versione dal file pubblico del repository.
    $rawText = (Invoke-WebRequest -Uri "https://raw.githubusercontent.com/$($cfg.repo)/main/poliglotta/manifest.json" -Headers @{ 'User-Agent' = 'Poliglotta' } -UseBasicParsing).Content
    $remote = [string](($rawText | ConvertFrom-Json).version)
  }
  if (-not $zipUrl) { $zipUrl = "https://github.com/$($cfg.repo)/releases/latest/download/Poliglotta.zip" }
  if ([version]$remote -le [version]$local) {
    Write-Host 'Poliglotta è già aggiornata.'
    Fine 0
  }

  Write-Host "Scarico la versione $remote..."
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ('poliglotta-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tmp | Out-Null
  $zip = Join-Path $tmp 'poliglotta.zip'
  Invoke-WebRequest -Uri $zipUrl -OutFile $zip -Headers @{ 'User-Agent' = 'Poliglotta' } -UseBasicParsing
  $out = Join-Path $tmp 'x'
  Expand-Archive -LiteralPath $zip -DestinationPath $out -Force
  $src = Join-Path $out 'poliglotta'
  if (-not (Test-Path -LiteralPath (Join-Path $src 'manifest.json'))) { $src = $out }
  if (-not (Test-Path -LiteralPath (Join-Path $src 'manifest.json'))) { throw 'Lo zip scaricato non contiene Poliglotta.' }
  $srcFull = (Resolve-Path -LiteralPath $src).Path.TrimEnd('\', '/')

  # Copio tutti i file, il manifest per ultimo: così Chrome non vede mai una versione a metà.
  foreach ($f in Get-ChildItem -LiteralPath $srcFull -Recurse -File) {
    $relPath = $f.FullName.Substring($srcFull.Length).TrimStart('\', '/')
    if ($relPath -eq 'manifest.json') { continue }
    $dst = Join-Path $dir $relPath
    $dstDir = Split-Path -Parent $dst
    if (-not (Test-Path -LiteralPath $dstDir)) { New-Item -ItemType Directory -Path $dstDir -Force | Out-Null }
    Copy-Item -LiteralPath $f.FullName -Destination $dst -Force
  }
  Copy-Item -LiteralPath (Join-Path $srcFull 'manifest.json') -Destination (Join-Path $dir 'manifest.json') -Force
  if (Get-Command Unblock-File -ErrorAction SilentlyContinue) {
    Get-ChildItem -LiteralPath $dir -Recurse -File | Unblock-File -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue

  Write-Host "Fatto! Poliglotta è aggiornata alla versione $remote."
  Write-Host 'Per attivarla chiudi e riapri Chrome (oppure clicca Ricarica su Poliglotta in chrome://extensions),'
  Write-Host 'poi premi F5 su Facebook.'
  Fine 0
} catch {
  Write-Host "Aggiornamento non riuscito: $($_.Exception.Message)"
  Write-Host 'Controlla la connessione e riprova. Se il problema resta, scarica lo zip a mano dalla pagina GitHub.'
  Fine 1
}
