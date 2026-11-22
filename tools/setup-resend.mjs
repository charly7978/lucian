/* Gestión asistida de dominios de envío con la API de Resend.

   node tools/setup-resend.mjs list
   node tools/setup-resend.mjs create ventas.galapa.com.ar hola@ventas.galapa.com.ar 200
   node tools/setup-resend.mjs verify ventas.galapa.com.ar

   La clave se lee de data/settings.json (campo email.resendKey). Nunca se
   muestra en pantalla. Primero cargá una clave válida en Ajustes → Correo →
   Clave de Resend.
*/
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SETTINGS = path.join(ROOT, 'data', 'settings.json');
const API = 'https://api.resend.com';

async function key() {
  const settings = JSON.parse(await fs.readFile(SETTINGS, 'utf8'));
  const value = String(settings.email?.resendKey || '').trim();
  if (!value) throw new Error('Falta la clave de Resend. Cargala en Ajustes → Correo → Clave de Resend.');
  return value;
}

async function request(route, options = {}) {
  const response = await fetch(`${API}${route}`, {
    ...options,
    headers: { authorization: `Bearer ${await key()}`, 'content-type': 'application/json', ...(options.headers || {}) },
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { message: text }; }
  if (!response.ok) throw new Error(`${response.status} ${data.message || data.error?.message || 'Error de Resend'}`);
  return data;
}

async function list() {
  const data = await request('/domains');
  const rows = (data.data || []).map((domain) => ({
    name: domain.name,
    status: domain.status,
    region: domain.region || '',
  }));
  console.log(JSON.stringify(rows, null, 2));
  return rows;
}

async function create(domainName, from, limit) {
  if (!domainName) throw new Error('Indicá el dominio: node tools/setup-resend.mjs create ventas.tudominio.com');
  const data = await request('/domains', {
    method: 'POST',
    body: JSON.stringify({ name: domainName }),
  });
  const records = (data.records || []).map((record) => ({
    tipo: record.record_type,
    nombre: record.name,
    valor: record.value,
    ttl: record.ttl,
    prioridad: record.priority || '',
  }));
  console.log(JSON.stringify({ dominio: data.name, id: data.id, estado: data.status, registros_dns: records }, null, 2));
  console.log('\nCopiá esos registros DNS en tu proveedor de dominio. Después ejecutá verify.');
  if (from) {
    const pendingFile = path.join(ROOT, 'data', 'pending-domain.json');
    await fs.writeFile(pendingFile, JSON.stringify({
      id: data.id,
      domain: data.name,
      from,
      dailyLimit: Number(limit) || 200,
    }, null, 2) + '\n');
    console.log(`Configuración pendiente guardada en ${path.relative(ROOT, pendingFile)}`);
  }
}

async function verify(domainName) {
  if (!domainName) throw new Error('Indicá el dominio a verificar.');
  const rows = await list();
  const found = rows.find((row) => row.name === domainName);
  if (!found) throw new Error(`Resend no conoce ${domainName}. Crealo primero con create.`);
  if (found.status !== 'verified') {
    console.log(`Estado actual: ${found.status}. Los registros DNS todavía no propagaron; volvé a intentar en unos minutos.`);
    return;
  }
  const settings = JSON.parse(await fs.readFile(SETTINGS, 'utf8'));
  const pendingFile = path.join(ROOT, 'data', 'pending-domain.json');
  const pending = JSON.parse(await fs.readFile(pendingFile, 'utf8').catch(() => '{}'));
  const from = pending.from || `Lucian <hola@${domainName}>`;
  settings.email = settings.email || {};
  const listDomains = Array.isArray(settings.email.sendDomains) ? settings.email.sendDomains : [];
  if (!listDomains.some((entry) => entry.domain === domainName)) {
    listDomains.push({
      id: `dom_${domainName}`,
      domain: domainName,
      from,
      dailyLimit: Math.min(200, Math.max(1, Number(pending.dailyLimit) || 200)),
      enabled: true,
    });
  }
  settings.email.sendDomains = listDomains;
  settings.email.provider = 'resend';
  await fs.writeFile(SETTINGS, JSON.stringify(settings, null, 2) + '\n');
  console.log(`Listo: ${domainName} verificado y cargado en Lucian con cupo ${listDomains.at(-1).dailyLimit}/día.`);
}

const [command, ...args] = process.argv.slice(2);
try {
  if (command === 'list') await list();
  else if (command === 'create') await create(args[0], args[1], args[2]);
  else if (command === 'verify') await verify(args[0]);
  else throw new Error('Comandos: list | create <dominio> [remitente] [límite] | verify <dominio>');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
