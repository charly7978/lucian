$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
    $base = Join-Path $env:USERPROFILE 'Downloads\LUCIAN-PRUEBA-DIRECTOR-IA'
    $codigo = Join-Path $base 'CODIGO_GITHUB'
    $pointer = Join-Path $base 'ruta-codigo.txt'
    $url = 'http://127.0.0.1:48621'
    $launcher = Join-Path $base 'INICIAR-SOLO-PRUEBA.cmd'
    $testData = Join-Path $base 'DATOS_DE_PRUEBA'
    Write-Host ''
    Write-Host '====================================================' -ForegroundColor Cyan
    Write-Host '  LUCIAN DIRECTOR IA - CORRECCION Y PRUEBA LOCAL' -ForegroundColor Cyan
    Write-Host '====================================================' -ForegroundColor Cyan
    Write-Host 'Solo se modifica el codigo de la COPIA DE PRUEBA.'
    Write-Host 'No se toca LUCIAN-LISTO, ni claves ni historial.'
    if (!(Test-Path -LiteralPath $base -PathType Container)) {
        throw 'No se encontro la copia LUCIAN-PRUEBA-DIRECTOR-IA en Descargas. Primero ejecuta el probador que ya descargaste.'
    }
    if (Test-Path -LiteralPath $pointer -PathType Leaf) {
        $engine = [IO.File]::ReadAllText($pointer).Trim()
    } else {
        if (!(Test-Path -LiteralPath $codigo -PathType Container)) { throw 'No se encontro CODIGO_GITHUB dentro de la prueba.' }
        $found = Get-ChildItem -LiteralPath $codigo -File -Filter 'server.mjs' -Recurse -ErrorAction Stop |
            Where-Object { $_.Directory.Name -eq 'lumbre' -and (Test-Path -LiteralPath (Join-Path $_.Directory.FullName 'package.json')) } |
            Select-Object -First 1
        if (!$found) { throw 'No se encontro server.mjs en la carpeta de prueba.' }
        $engine = $found.Directory.FullName
    }
    $full = [IO.Path]::GetFullPath($engine)
    $allowed = [IO.Path]::GetFullPath($codigo).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if (!$full.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'La ruta no corresponde a CODIGO_GITHUB de la prueba. Operacion cancelada por seguridad.'
    }
    $server = Join-Path $full 'server.mjs'
    if (!(Test-Path -LiteralPath $server -PathType Leaf)) { throw 'Falta server.mjs en la copia de prueba.' }
    if (!(Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js no esta disponible en la consola.' }

    $original = [IO.File]::ReadAllText($server)
    $importDuplicado = "import { isAIReady, listModels, resolveAIConfig, testAI, PROVIDERS, generateJson } from './lib/ai.mjs';"
    $importCorregido = "import { isAIReady, listModels, resolveAIConfig, testAI, PROVIDERS } from './lib/ai.mjs';"
    $importSeparado = "import { generateJson } from './lib/ai.mjs';"
    $modified = $false
    $backup = ''
    if ($original.Contains($importDuplicado) -and $original.Contains($importSeparado)) {
        $updated = $original.Replace($importDuplicado, $importCorregido)
        $backupFolder = Join-Path $base 'RESPALDOS_CODIGO_PRUEBA'
        New-Item -ItemType Directory -Path $backupFolder -Force | Out-Null
        $backup = Join-Path $backupFolder ('server-antes-de-corregir-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.mjs')
        Copy-Item -LiteralPath $server -Destination $backup -ErrorAction Stop
        [IO.File]::WriteAllText($server, $updated, [Text.UTF8Encoding]::new($false))
        $modified = $true
        Write-Host '[OK] Eliminada la importacion duplicada de generateJson.' -ForegroundColor Green
        Write-Host ('[OK] Respaldo del codigo: ' + $backup)
    } elseif ($original.Contains($importCorregido) -and $original.Contains($importSeparado)) {
        Write-Host '[OK] El error de importacion ya esta corregido.' -ForegroundColor Green
    } else {
        throw 'La estructura de server.mjs es diferente: no se modifico nada. Comparte las primeras 40 lineas del archivo.'
    }

    try {
        foreach ($relative in @('server.mjs','lib\agents.mjs','lib\commercial-strategy.mjs','lib\commercial-quality.mjs','public\app.js')) {
            $file = Join-Path $full $relative
            if (!(Test-Path -LiteralPath $file)) { throw ('Falta ' + $relative + ' en la prueba.') }
            & node --check $file 2>&1 | Out-Host
            if ($LASTEXITCODE -ne 0) { throw ('No paso el control de sintaxis: ' + $relative) }
            Write-Host ('[OK] Sintaxis: ' + $relative) -ForegroundColor Green
        }
        foreach ($relative in @('tools\test-commercial-strategy.mjs','tools\test-commercial-quality.mjs')) {
            $file = Join-Path $full $relative
            if (!(Test-Path -LiteralPath $file)) { throw ('Falta la prueba ' + $relative) }
            & node $file 2>&1 | Out-Host
            if ($LASTEXITCODE -ne 0) { throw ('No paso una prueba comercial: ' + $relative) }
        }
    } catch {
        if ($modified -and $backup -and (Test-Path -LiteralPath $backup)) {
            Copy-Item -LiteralPath $backup -Destination $server -Force
            Write-Host '[AVISO] Se restauro el archivo anterior de la copia de PRUEBA.' -ForegroundColor Yellow
        }
        throw
    }

    $isRunning = $false
    try {
        $r = Invoke-RestMethod -Uri ($url + '/api/health') -TimeoutSec 2
        if ($r.app -eq 'lucian') { $isRunning = $true }
    } catch { }
    if (!$isRunning) {
        New-Item -ItemType Directory -Path $testData -Force | Out-Null
        if (!(Test-Path -LiteralPath $launcher)) {
            $lines = @(
                '@echo off',
                'title LUCIAN Director IA - PRUEBA AISLADA',
                'set "PORT=48621"',
                'set "LUCIAN_HOST=127.0.0.1"',
                'set "LUCIAN_NO_OPEN=1"',
                ('set "LUCIAN_DATA_DIR={0}"' -f $testData),
                ('cd /d "{0}"' -f $full),
                'node server.mjs',
                'echo.',
                'echo Copia el primer ERROR si falla el inicio.',
                'pause'
            )
            [IO.File]::WriteAllText($launcher, ($lines -join "`r`n") + "`r`n", [Text.Encoding]::ASCII)
        }
        Write-Host '[INFO] Iniciando la copia de prueba en el puerto 48621...'
        Start-Process -FilePath $launcher -WorkingDirectory $base
        $ready = $false
        for ($i=0; $i -lt 60; $i++) {
            Start-Sleep -Milliseconds 250
            try {
                $r = Invoke-RestMethod -Uri ($url + '/api/health') -TimeoutSec 1
                if ($r.app -eq 'lucian') { $ready = $true; break }
            } catch { }
        }
        if (!$ready) { throw 'El servidor de prueba no respondio. Revisa la ventana negra del servidor y comparte el nuevo ERROR.' }
    }
    Write-Host ('[OK] LUCIAN DE PRUEBA ABIERTO: ' + $url) -ForegroundColor Green
    Write-Host 'Entra en VENTAS -> Director comercial IA.'
    Write-Host 'La IA de esta copia debe configurarse por separado; nunca se copiaron credenciales.'
    Start-Process $url
    exit 0
} catch {
    Write-Host ''
    Write-Host ('[ERROR] ' + $_.Exception.Message) -ForegroundColor Red
    Write-Host 'No se modifico la instalacion habitual LUCIAN-LISTO.'
    exit 1
}
