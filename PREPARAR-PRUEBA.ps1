$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $base = Join-Path $env:USERPROFILE 'Downloads\LUCIAN-PRUEBA-DIRECTOR-IA'
    $archive = Join-Path $base 'codigo-github.zip'
    $src = Join-Path $base 'CODIGO_GITHUB'
    $pointer = Join-Path $base 'ruta-codigo.txt'
    $testData = Join-Path $base 'DATOS_DE_PRUEBA'
    $runPath = Join-Path $base 'INICIAR-SOLO-PRUEBA.cmd'
    $url = 'http://127.0.0.1:48621'
    $commit = '0cc1258a79acb2d624d73ae08a2f2338ac8b4523'
    $remote = 'https://codeload.github.com/charly7978/lumbre/zip/' + $commit

    Write-Host ''
    Write-Host '=========== DIRECTOR COMERCIAL IA - SOLO PRUEBA ===========' -ForegroundColor Cyan
    Write-Host 'Tu Lucian habitual y su carpeta data NO se modificaran.'
    Write-Host ('Carpeta independiente: ' + $base)
    New-Item -ItemType Directory -Path $base -Force | Out-Null

    if (Test-Path -LiteralPath $pointer) {
        $engine = [IO.File]::ReadAllText($pointer).Trim()
        if (!(Test-Path -LiteralPath (Join-Path $engine 'server.mjs'))) {
            throw 'Falta server.mjs en la prueba anterior. Elimina solo la carpeta LUCIAN-PRUEBA-DIRECTOR-IA y reintenta.'
        }
        Write-Host '[OK] Codigo de prueba existente reutilizado.' -ForegroundColor Green
    } else {
        if (Test-Path -LiteralPath $src) {
            throw 'Hay una descarga incompleta anterior. Renombra la carpeta LUCIAN-PRUEBA-DIRECTOR-IA, sin borrar tu Lucian habitual.'
        }
        Write-Host 'Descargando una copia fija del PR #5 de GitHub...'
        Invoke-WebRequest -Uri $remote -OutFile $archive -UseBasicParsing -TimeoutSec 90
        if ((Get-Item -LiteralPath $archive).Length -lt 10000) { throw 'Archivo de GitHub demasiado pequeno o incompleto.' }
        Expand-Archive -LiteralPath $archive -DestinationPath $src -Force
        $found = Get-ChildItem -LiteralPath $src -Filter 'server.mjs' -File -Recurse |
          Where-Object { $_.Directory.Name -eq 'lumbre' -and (Test-Path -LiteralPath (Join-Path $_.Directory.FullName 'package.json')) } |
          Select-Object -First 1
        if (!$found) { throw 'La descarga no contiene la aplicacion Lucian esperada.' }
        $engine = $found.Directory.FullName
        [IO.File]::WriteAllText($pointer, $engine, [Text.Encoding]::UTF8)
        Write-Host '[OK] Copia del codigo preparada.' -ForegroundColor Green
    }

    New-Item -ItemType Directory -Path $testData -Force | Out-Null
    $products = Join-Path $testData 'products.json'
    if (!(Test-Path -LiteralPath $products)) {
        $real = 'C:\Users\carlo.ROLITO\Downloads\Nueva carpeta (2)\LUCIAN-LISTO\data'
        if (Test-Path -LiteralPath (Join-Path $real 'products.json')) {
            Write-Host ''
            Write-Host 'Encontramos el catalogo real en tu PC. Esta prueba solo copiara fichas y fotos.'
            Write-Host 'No se copian configuraciones, APIs, claves, correos, conversaciones ni misiones.'
            $answer = Read-Host 'Queres copiar SOLO las fichas y fotos a la prueba? Escribi SI (o Enter para omitir)'
            if ($answer -eq 'SI') {
                Copy-Item -LiteralPath (Join-Path $real 'products.json') -Destination $products
                $mediaSrc = Join-Path $real 'media\products'
                if (Test-Path -LiteralPath $mediaSrc) {
                    $mediaDest = Join-Path $testData 'media\products'
                    New-Item -ItemType Directory -Path (Split-Path $mediaDest -Parent) -Force | Out-Null
                    Copy-Item -LiteralPath $mediaSrc -Destination $mediaDest -Recurse -Force
                }
                $productList = Get-Content -LiteralPath $products -Raw | ConvertFrom-Json
                Write-Host ('[OK] Fichas copiadas para prueba: ' + @($productList).Count) -ForegroundColor Green
            }
        }
    }

    $lines = @(
        '@echo off',
        'title LUCIAN Director IA - PRUEBA AISLADA',
        'set "PORT=48621"',
        'set "LUCIAN_HOST=127.0.0.1"',
        'set "LUCIAN_NO_OPEN=1"',
        ('set "LUCIAN_DATA_DIR={0}"' -f $testData),
        ('cd /d "{0}"' -f $engine),
        'node server.mjs',
        'echo.',
        'echo Si aparece un ERROR, copia la primera linea y compartila con ChatGPT.',
        'pause'
    )
    [IO.File]::WriteAllText($runPath, ($lines -join "`r`n") + "`r`n", [Text.Encoding]::ASCII)
    if (!(Get-Command node -ErrorAction SilentlyContinue)) {
        throw 'No se encontro Node.js. Tu app habitual usa Node; comproba que la consola lo encuentre (node --version).'
    }

    $running = $false
    try {
        $response = Invoke-RestMethod -Uri ($url + '/api/health') -TimeoutSec 2
        if ($response.app -eq 'lucian') { $running = $true }
    } catch { }
    if (!$running) {
        $tcp = New-Object Net.Sockets.TcpClient
        try {
            $tcp.Connect('127.0.0.1', 48621)
            throw 'Puerto 48621 ocupado por otra aplicacion. Cierra esa aplicacion y reintenta.'
        } catch [System.Net.Sockets.SocketException] { }
        finally { $tcp.Dispose() }
        Start-Process -FilePath $runPath -WorkingDirectory $base
        $ok = $false
        for ($i=0; $i -lt 56; $i++) {
            Start-Sleep -Milliseconds 300
            try {
                $health = Invoke-RestMethod -Uri ($url + '/api/health') -TimeoutSec 2
                if ($health.app -eq 'lucian') { $ok = $true; break }
            } catch { }
        }
        if (!$ok) { throw 'No respondio el servidor de prueba. Revisa la ventana negra LUCIAN Director IA: copia la primera linea de error.' }
    }
    Write-Host ('[OK] La version PR #5 esta disponible en ' + $url) -ForegroundColor Green
    Write-Host 'Ahora entra en VENTAS - DIRECTOR COMERCIAL IA, o PRODUCTOS - ESTRATEGIA IA.'
    Write-Host 'Para generar una estrategia REAL, configura IA y busqueda SOLO en esta copia de prueba.'
    Write-Host 'No se importaron las claves de tu Lucian real.'
    Start-Process $url
    exit 0
} catch {
    Write-Host ('[ERROR] ' + $_.Exception.Message) -ForegroundColor Red
    Write-Host 'No se modifico tu Lucian habitual ni sus datos.'
    exit 1
}
