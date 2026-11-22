$ErrorActionPreference = 'Stop'
try {
  Write-Host 'LUCIAN V8.1.3 - BOTON RESEND VISIBLE Y API DE ENTREGAS'
  Write-Host 'No crea otra instalacion y no toca la carpeta data.'
  $node = Get-Command node.exe -ErrorAction Stop
  Add-Type -AssemblyName System.Windows.Forms
  $dlg = New-Object System.Windows.Forms.OpenFileDialog
  $dlg.Title = 'Elegir el INICIAR-LUCIAN.cmd que tiene tus 33 lamparas'
  $dlg.Filter = 'Iniciador (INICIAR-LUCIAN.cmd)|INICIAR-LUCIAN.cmd'
  $dlg.CheckFileExists = $true
  if ($dlg.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
    Write-Host 'Cancelado sin cambios.'; exit 0
  }
  $tgt = Split-Path -Parent $dlg.FileName
  if (-not (Test-Path -LiteralPath (Join-Path $tgt 'server.mjs'))) {
    if (Test-Path -LiteralPath (Join-Path $tgt 'lumbre\server.mjs')) { $tgt = Join-Path $tgt 'lumbre' }
  }
  $tool = Join-Path $PSScriptRoot 'APLICAR-V81.cjs'
  & $node.Source $tool $tgt --check
  if ($LASTEXITCODE -ne 0) { Write-Host '[CANCELADO] Estructura incompatible, no se modifico nada.'; exit 1 }
  Write-Host ''
  Write-Host 'CERRA la ventana negra de Lucian antes de confirmar.'
  $answer = Read-Host 'Si queres aplicar SOLO este parche, escribi SI'
  if ($answer -notmatch '^(?i:SI)$') { Write-Host 'Cancelado sin cambios.'; exit 0 }
  & $node.Source $tool $tgt --apply
  if ($LASTEXITCODE -ne 0) { Write-Host '[ERROR] Se intento revertir automaticamente el cambio.'; exit 1 }
  Write-Host 'Reinicia Lucian, entra a Ventas y presiona Ctrl+F5. El boton debe mostrarse en la barra superior. Si usaste Gmail, Resend no tendra esas entregas.'
} catch { Write-Host ('[ERROR] ' + $_.Exception.Message); exit 1 }
