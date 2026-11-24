import { exec, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dataDir = path.resolve(root, process.env.LUCIAN_DATA_DIR || 'data');
const installation = crypto.createHash('sha256').update(process.platform === 'win32' ? dataDir.toLowerCase() : dataDir).digest('hex').slice(0, 16);
const firstPort = Number(process.env.PORT || process.env.LUCIAN_PORT || 4321);

async function getJson(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(700) });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

async function startOllamaIfConfigured() {
  let settings;
  try { settings = JSON.parse(await readFile(path.join(dataDir, 'settings.json'), 'utf8')); }
  catch { return; }
  const provider = process.env.LUCIAN_AI_PROVIDER || settings.ai?.provider;
  const address = process.env.LUCIAN_AI_BASE_URL || settings.ai?.baseUrl || 'http://127.0.0.1:11434/v1';
  if (provider !== 'ollama' || !/^http:\/\/(?:localhost|127\.0\.0\.1):11434(?:\/v1)?\/?$/.test(address)) return;
  const tags = 'http://127.0.0.1:11434/api/tags';
  if (await getJson(tags)) return;

  const ollama = spawn(process.platform === 'win32' ? 'ollama.exe' : 'ollama', ['serve'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, OLLAMA_NUM_PARALLEL: '1', OLLAMA_MAX_LOADED_MODELS: '1' },
  });
  let unavailable = false;
  ollama.once('error', () => {
    unavailable = true;
    console.log('No se pudo iniciar Ollama. Lucian abrirá con el correo y el catálogo disponibles.');
  });
  ollama.unref();
  for (let attempt = 0; attempt < 20 && !unavailable; attempt += 1) {
    if (await getJson(tags)) return;
    await wait(250);
  }
}

await startOllamaIfConfigured();
const ports = Array.from({ length: 8 }, (_, index) => firstPort + index);
const checks = await Promise.all(ports.map(port => getJson(`http://127.0.0.1:${port}/api/health`)));
const runningIndex = checks.findIndex(check => check?.app === 'lucian' && check.installation === installation);
if (runningIndex >= 0) {
  const url = `http://localhost:${ports[runningIndex]}`;
  console.log(`Lucian ya está iniciado en ${url}`);
  if (!process.env.LUCIAN_NO_OPEN && process.platform === 'win32') exec(`start "" "${url}"`, { shell: 'cmd.exe' }, () => {});
} else {
  await new Promise((resolve, reject) => {
    const server = spawn(process.execPath, ['server.mjs'], { cwd: root, stdio: 'inherit' });
    server.once('error', reject);
    server.once('exit', code => { process.exitCode = code || 0; resolve(); });
  });
}
