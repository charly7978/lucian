$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Write-Host ''
Write-Host '=============================================================='
Write-Host ' LUCIAN - AGENDA COMERCIAL SOBRE TU INSTALACION ACTUAL'
Write-Host '=============================================================='
Write-Host ''
Write-Host 'Se actualizaran SOLO servidor, interfaz y modulo de agenda comercial.'
Write-Host 'La carpeta data con tus lamparas NO se modificara.'
Write-Host ''
$root = $PSScriptRoot
$patch = Join-Path $root 'patch'
$files = @('server.mjs', 'public\app.js', 'package.json', 'lib\sales-ops.mjs', 'tools\test-sales-ops.mjs')
foreach ($relative in $files) {
  if (-not (Test-Path -LiteralPath (Join-Path $patch $relative) -PathType Leaf)) {
    throw "Falta el archivo $relative en la actualizacion. Extrae el ZIP completo y repeti."
  }
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
$required = @('server.mjs','public\app.js','package.json','data\products.json')
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
$hashBefore = (Get-FileHash -LiteralPath $productsPath -Algorithm SHA256).Hash
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
  $hashAfter = (Get-FileHash -LiteralPath $productsPath -Algorithm SHA256).Hash
  if ($hashBefore -ne $hashAfter) { throw 'La carpeta de datos cambio durante la actualizacion. Se revierten los cambios.' }
  Write-Host ''
  Write-Host '[OK] CODIGO ACTUALIZADO Y VERIFICADO.' -ForegroundColor Green
  Write-Host "[OK] products.json sin cambios: $countBefore lamparas"
  Write-Host 'No se creo otra instalacion ni se copiaron tus datos.'
  Write-Host 'El respaldo SOLO del codigo anterior queda en:'
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
