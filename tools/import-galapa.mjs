/* Importa el catálogo completo de https://galapa.com.ar/productos y lo
   fusiona con el resguardo real del dueño (códigos, costos, materiales,
   descripciones, fotos y el resto de los datos: Telegram, misiones, etc.).

   Uso:
     node tools/import-galapa.mjs           # vista previa, no escribe
     node tools/import-galapa.mjs --apply   # respalda data/ y aplica
*/
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL_CATALOG = 'https://galapa.com.ar/productos';
const BACKUP = path.join(ROOT, 'RESGUARDO-DATA-LUCIAN-2026-11-20T22-56-09-372Z-002dfa');
const DATA = path.join(ROOT, 'data');
const APPLY = process.argv.includes('--apply');

function normalizeName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}

async function fetchCatalog() {
  const response = await fetch(URL_CATALOG);
  if (!response.ok) throw new Error(`No se pudo abrir ${URL_CATALOG}: HTTP ${response.status}`);
  const html = await response.text();
  const blocks = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1].trim());
  const products = [];
  for (const block of blocks) {
    let data;
    try { data = JSON.parse(block); } catch { continue; }
    if (data?.['@type'] !== 'Product' || !data.name) continue;
    const offer = data.offers || {};
    const price = Number(offer.price);
    if (!Number.isFinite(price) || price <= 0) continue;
    products.push({
      name: String(data.name).trim(),
      image: String(data.image || '').trim(),
      url: String(offer.url || data.mainEntityOfPage?.['@id'] || '').trim(),
      price: Math.round(price),
      currency: String(offer.priceCurrency || 'ARS'),
      availability: String(offer.availability || ''),
      stock: Number(offer.inventoryLevel?.value) || 0,
    });
  }
  return products;
}

async function copyDir(from, to) {
  await fs.mkdir(to, { recursive: true });
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) await copyDir(src, dst);
    else await fs.copyFile(src, dst);
  }
}

function slug(value) {
  return String(value || 'producto')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'producto';
}

async function main() {
  const live = await fetchCatalog();
  if (!live.length) throw new Error('La página no devolvió productos. Revisá el HTML de Tiendanube.');

  const saved = await readJson(path.join(BACKUP, 'products.json'), []);
  const byName = new Map(saved.map((product) => [normalizeName(product.name), product]));
  const merged = [];
  const unmatched = [];

  for (const item of live) {
    const key = normalizeName(item.name);
    const previous = byName.get(key);
    if (!previous) unmatched.push(item.name);
    const base = previous || {
      id: `prd_${slug(item.name).slice(0, 16)}`,
      name: item.name,
      code: '',
      category: 'Lámpara',
      currency: item.currency,
      cost: Math.round(item.price * 0.25),
      weightGrams: 0,
      capacityPerWeek: 0,
      leadTimeDays: 0,
      dimensions: '',
      materials: '',
      description: '',
      notes: '',
      paymentLink: '',
      status: 'listo',
      photos: [],
      demo: false,
      createdAt: new Date().toISOString(),
    };
    const photoFile = previous?.photos?.[0]?.file || `products/${slug(item.name)}.webp`;
    merged.push({
      ...base,
      name: item.name,
      price: item.price,
      currency: item.currency,
      paymentLink: item.url || base.paymentLink,
      notes: [
        `Importado de GALAPA. SKU: ${base.code || 'sin código'}. Stock: ${item.stock}. URL: ${item.url}`,
        base.notes && !base.notes.startsWith('Importado de GALAPA.') ? base.notes : '',
      ].filter(Boolean).join('\n'),
      photos: base.photos?.length
        ? base.photos
        : item.image ? [{ file: photoFile, alt: item.name }] : [],
      demo: false,
      updatedAt: new Date().toISOString(),
    });
  }

  const report = {
    productos_en_la_pagina: live.length,
    productos_del_resguardo: saved.length,
    fusionados: merged.length - unmatched.length,
    nuevos: unmatched,
    modifo: APPLY ? 'aplica' : 'vista previa',
  };
  console.log(JSON.stringify(report, null, 2));

  if (!APPLY) return;

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safety = path.join(ROOT, `RESGUARDO-DATA-ANTES-IMPORTAR-GALAPA-${stamp}`);
  await copyDir(DATA, safety);
  console.log('Respaldo de seguridad:', path.relative(ROOT, safety));

  // Restaurar TODOS los datos reales del resguardo (Telegram, misiones,
  // conversaciones, contenido, aprendizajes y media).
  for (const entry of await fs.readdir(BACKUP, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    if (entry.name.includes('.broken-')) continue;
    if (entry.name === 'products.json') continue;
    await fs.copyFile(path.join(BACKUP, entry.name), path.join(DATA, entry.name));
  }
  if (await fs.stat(path.join(BACKUP, 'media')).catch(() => null)) {
    await copyDir(path.join(BACKUP, 'media'), path.join(DATA, 'media'));
  }

  await fs.mkdir(path.join(DATA, 'media', 'products'), { recursive: true });
  let downloaded = 0;
  for (let index = 0; index < merged.length; index += 1) {
    const product = merged[index];
    const file = product.photos?.[0]?.file;
    if (!file) continue;
    const target = path.join(DATA, 'media', file.replace(/^media\//, ''));
    if (await fs.stat(target).catch(() => null)) continue;
    const item = live.find((entry) => normalizeName(entry.name) === normalizeName(product.name));
    if (!item?.image) continue;
    try {
      const response = await fetch(item.image);
      if (!response.ok) continue;
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, Buffer.from(await response.arrayBuffer()));
      downloaded += 1;
    } catch { /* la foto queda pendiente; el producto no se pierde */ }
  }

  const settings = await readJson(path.join(DATA, 'settings.json'), {});
  settings.email = settings.email || {};
  settings.email.sendDomains = [];
  await fs.writeFile(path.join(DATA, 'settings.json'), JSON.stringify(settings, null, 2) + '\n');
  await fs.writeFile(path.join(DATA, 'products.json'), JSON.stringify(merged, null, 2) + '\n');
  console.log(`Aplicado: ${merged.length} lámparas, ${downloaded} fotos nuevas descargadas.`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
