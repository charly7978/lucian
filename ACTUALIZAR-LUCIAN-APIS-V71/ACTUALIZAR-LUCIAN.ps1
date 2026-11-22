$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Write-Host ''
Write-Host '=============================================================='
Write-Host ' LUCIAN V7.1 - AUDITORIA Y CORRECCION DE APIs'
Write-Host '=============================================================='
Write-Host ''
Write-Host 'Corrige los diagnosticos y protocolos de IA, Gmail, Resend, Telegram y busqueda.'
Write-Host 'La carpeta data con tus lamparas NO se modificara.'
Write-Host ''
$root = $PSScriptRoot
$patch = Join-Path $root 'patch'
$files = @(
  'server.mjs',
  'public\app.js',
  'package.json',
  'lib\ai.mjs',
  'lib\connections.mjs',
  'lib\email.mjs',
  'lib\imap.mjs',
  'lib\notify.mjs',
  'lib\search.mjs',
  'lib\smtp.mjs',
  'tools\test-api-diagnostics.mjs',
  'tools\test-api-diagnostics-http.mjs',
  'tools\test-search.mjs'
)
foreach ($relative in $files) {
  if (-not (Test-Path -LiteralPath (Join-Path $patch $relative) -PathType Leaf)) {
    throw "Falta el archivo $relative en la actualizacion. Extrae el ZIP completo y repeti."
  }
}
$manifestPath = Join-Path $root 'MANIFIESTO-PARCHE.json'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw 'Falta el manifiesto de archivos.' }
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($item in $manifest.archivos) {
  $actual = (Get-FileHash -LiteralPath (Join-Path $patch $item.archivo) -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne [string]$item.sha256) { throw "Archivo de actualizacion danado o incompleto: $($item.archivo)" }
}
$selectedFolder = $null
if ((Test-Path -LiteralPath (Join-Path $root 'server.mjs') -PathType Leaf) -and
    (Test-Path -LiteralPath (Join-Path $root 'INICIAR-LUCIAN.cmd') -PathType Leaf)) {
  $selectedFolder = $root
} else {
  Write-Host 'Se abrira un selector: elegi el INICIAR-LUCIAN.cmd QUE YA USAS.'
  Add-Type -AssemblyName System.Windows.Forms
  $dialog = New-Object System.Windows.Forms.OpenFileDialog
  $dialog.Title = 'Elegi el INICIAR-LUCIAN.cmd que ya funciona'
  $dialog.Filter = 'Iniciador de Lucian (INICIAR-LUCIAN.cmd)|INICIAR-LUCIAN.cmd'
  $dialog.CheckFileExists = $true
  $dialog.Multiselect = $false
  if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
    Write-Host 'Cancelado: no se modifico nada.'
    exit 0
  }
  $selectedFolder = Split-Path -Parent $dialog.FileName
}
$selectedFolder = [System.IO.Path]::GetFullPath($selectedFolder)
$required = @('server.mjs','public\app.js','package.json','data\products.json', 'lib\agents.mjs', 'lib\sales-ops.mjs', 'lib\readiness.mjs', 'lib\search.mjs', 'lib\sales-launch.mjs', 'lib\public-catalog.mjs', 'lib\connections.mjs')
foreach ($relative in $required) {
  if (-not (Test-Path -LiteralPath (Join-Path $selectedFolder $relative) -PathType Leaf)) {
    throw "Esa no parece la instalacion con tus datos: falta $relative. No se cambio nada."
  }
}
$productsPath = Join-Path $selectedFolder 'data\products.json'
# No usar @(... | ConvertFrom-Json) para contar arrays: PowerShell 5.1
# puede tratar todo el array JSON como un unico elemento (falso conteo = 1).
# El contador en Node.js valida que las colecciones sean arrays de verdad.
$counter = Join-Path $root 'VERIFICAR-DATOS.cjs'
$node = Get-Command node.exe -ErrorAction SilentlyContinue
if ($null -eq $node) { throw 'No encuentro Node.js. No se modifico nada.' }
try {
  $jsonCounts = & ($node.Source) $counter $selectedFolder
  if ($LASTEXITCODE -ne 0) { throw 'El contador rechazo uno de los archivos de datos.' }
  $counts = ConvertFrom-Json -InputObject ([string]$jsonCounts) -ErrorAction Stop
  $countBefore = [int]$counts.products
} catch { throw "No se pudo validar el catalogo: $($_.Exception.Message). No se modifico nada." }
# Se verifican los datos comerciales existentes, no solo products.json.
$dataFolder = Join-Path $selectedFolder 'data'
$originalDataHashes = @{}
Get-ChildItem -LiteralPath $dataFolder -Filter '*.json' -File | ForEach-Object {
  $originalDataHashes[$_.Name] = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
}
$hashBefore = (Get-FileHash -LiteralPath $productsPath -Algorithm SHA256).Hash
# Sintaxis valida ANTES de reemplazar nada, para no dejar una instalacion rota.
foreach ($relative in $files) {
  if ($relative -match '\.(mjs|js)$') {
    & ($node.Source) --check (Join-Path $patch $relative)
    if ($LASTEXITCODE -ne 0) { throw "La actualizacion tiene JavaScript invalido: $relative. No se cambio nada." }
  }
}
Write-Host "Instalacion elegida: $selectedFolder"
Write-Host "Lamparas detectadas:  $countBefore"
Write-Host ("Conversaciones: {0} | Misiones: {1} | Contenidos: {2}" -f $counts.threads, $counts.missions, $counts.content)
if ($countBefore -lt 33) {
  Write-Host ''
  Write-Host '[CANCELADO POR SEGURIDAD] Esta instalacion tiene menos de las 33 lamparas recuperadas.' -ForegroundColor Yellow
  Write-Host "Carpeta elegida: $selectedFolder"
  Write-Host 'No se cambiaron archivos. Es posible que hayas elegido otra copia de Lucian.'
  Write-Host 'Volver a ejecutar y elegir el INICIAR-LUCIAN.cmd que abre tus 33 lamparas.'
  exit 3
}
$installedServer = Get-Content -LiteralPath (Join-Path $selectedFolder 'server.mjs') -Raw -Encoding UTF8
if ($installedServer -notmatch 'salesLaunch' -or $installedServer -notmatch 'buildPublicCatalog') {
  throw 'No detecte el codigo base de Lucian V7. Este parche no se aplica a versiones anteriores. No se modifico nada.'
}
Write-Host 'Se comprobo una instalacion existente de Lucian V7.'
Write-Host 'ATENCION: cerra las ventanas del servidor Lucian antes de continuar.'
Write-Host ''
$reply = Read-Host 'Para actualizar ESTA instalacion, escribi SI'
if ($reply -notmatch '^(?i:si)$') { Write-Host 'Cancelado: no se modifico nada.'; exit 0 }
$backupDir = Join-Path $selectedFolder ('respaldo-codigo-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$copied = New-Object System.Collections.Generic.List[string]
$created = New-Object System.Collections.Generic.List[string]
try {
  New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
  foreach ($relative in $files) {
    $src = Join-Path $patch $relative
    $dest = Join-Path $selectedFolder $relative
    $previous = Join-Path $backupDir $relative
    $prevParent = Split-Path -Parent $previous
    New-Item -ItemType Directory -Path $prevParent -Force | Out-Null
    if (Test-Path -LiteralPath $dest -PathType Leaf) {
      Copy-Item -LiteralPath $dest -Destination $previous -Force -ErrorAction Stop
      $copied.Add($relative)
    } else { $created.Add($relative) }
  }
  foreach ($relative in $files) {
    $src = Join-Path $patch $relative
    $dest = Join-Path $selectedFolder $relative
    $parent = Split-Path -Parent $dest
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    Copy-Item -LiteralPath $src -Destination $dest -Force -ErrorAction Stop
    $expectedHash = (Get-FileHash -LiteralPath $src -Algorithm SHA256).Hash
    $actualHash = (Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash
    if ($expectedHash -ne $actualHash) { throw "No se pudo verificar: $relative" }
  }
  # Controlar que los archivos del usuario no hayan sido modificados.
  foreach ($relative in $files) {
    if ($relative -match '\.(mjs|js)$') {
      & ($node.Source) --check (Join-Path $selectedFolder $relative)
      if ($LASTEXITCODE -ne 0) { throw "Error de sintaxis despues de copiar: $relative" }
    }
  }
  $actualDataFiles = @(Get-ChildItem -LiteralPath $dataFolder -Filter '*.json' -File)
  if ($actualDataFiles.Count -ne $originalDataHashes.Count) { throw 'Cambio la cantidad de archivos JSON de datos. Se revierte el codigo.' }
  foreach ($dataFile in $actualDataFiles) {
    if (-not $originalDataHashes.ContainsKey($dataFile.Name)) { throw "Aparecio un archivo de datos inesperado: $($dataFile.Name)" }
    if ((Get-FileHash -LiteralPath $dataFile.FullName -Algorithm SHA256).Hash -ne $originalDataHashes[$dataFile.Name]) {
      throw "Se detecto un cambio en los datos: $($dataFile.Name). Se revierte el codigo."
    }
  }
  $hashAfter = (Get-FileHash -LiteralPath $productsPath -Algorithm SHA256).Hash
  if ($hashBefore -ne $hashAfter) { throw 'La carpeta de datos cambio durante la actualizacion. Se revierten los cambios.' }
  Write-Host ''
  Write-Host '[OK] LUCIAN V7.1 - APIs CORREGIDAS EN ESTA MISMA CARPETA.' -ForegroundColor Green
  Write-Host "[OK] products.json sin cambios: $countBefore lamparas"
  Write-Host 'Los JSON comerciales y las fotos quedaron en esta misma instalacion.'
  Write-Host 'Abri CONEXIONES -> Probar APIs configuradas. Al terminar: Copiar informe sin claves.'
  Write-Host 'Copia reversible de los archivos de codigo anteriores:'
  Write-Host $backupDir
  Write-Host ''
  Write-Host 'Ahora abri TU MISMO INICIAR-LUCIAN.cmd de siempre.'
} catch {
  Write-Host ('[ERROR] ' + $_.Exception.Message) -ForegroundColor Red
  Write-Host 'Restaurando el codigo anterior...' -ForegroundColor Yellow
  foreach ($relative in $copied) {
    $previous = Join-Path $backupDir $relative
    if (Test-Path -LiteralPath $previous -PathType Leaf) {
      Copy-Item -LiteralPath $previous -Destination (Join-Path $selectedFolder $relative) -Force
    }
  }
  foreach ($relative in $created) {
    $dest = Join-Path $selectedFolder $relative
    if (Test-Path -LiteralPath $dest -PathType Leaf) { Remove-Item -LiteralPath $dest -Force }
  }
  throw
}
