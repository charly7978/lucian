import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { htmlToText, nowISO, sniffImage } from './util.mjs';

export const GALAPA_CATALOG_URL = 'https://galapa.com.ar/productos';
const historical = fileURLToPath(new URL('../RESGUARDO-DATA-LUCIAN-2026-11-20T22-56-09-372Z-002dfa/', import.meta.url));
const maxPhotoBytes = 8 * 1024 * 1024;

export function galapaProductUrl(value) {
  let url;
  try { url = new URL(value); } catch { return ''; }
  if (url.origin !== 'https://galapa.com.ar' || url.username || url.password || !/^\/productos\/[a-z0-9-]+\/?$/i.test(url.pathname)) return '';
  return `${url.origin}${url.pathname.replace(/\/$/, '')}/`;
}

function galapaPhotoUrl(value) {
  let url;
  try { url = new URL(value); } catch { return ''; }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || !/^dcdn(?:-[a-z]+)?\.mitiendanube\.com$/.test(url.hostname)) return '';
  return url.href;
}

export function parseGalapaCatalog(html) {
  const products = new Map();
  for (const match of html.matchAll(/<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    let data;
    try { data = JSON.parse(match[1]); } catch { continue; }
    if (data?.['@type'] !== 'Product') continue;
    const offer = data.offers || {};
    const url = galapaProductUrl(offer.url || data.mainEntityOfPage?.['@id']);
    const name = htmlToText(data.name).slice(0, 160);
    const price = Number(offer.price);
    const currency = String(offer.priceCurrency || '').toUpperCase();
    if (!url || !name || !Number.isFinite(price) || price <= 0 || !/^[A-Z]{3}$/.test(currency)) {
      throw new Error('GALAPA devolvió una ficha sin nombre, precio, moneda o enlace de compra válido.');
    }
    const availability = String(offer.availability || '').split('/').pop();
    const inventory = offer.inventoryLevel?.value;
    const stock = inventory != null && inventory !== '' && Number.isSafeInteger(Number(inventory)) && Number(inventory) >= 0 ? Number(inventory) : null;
    const description = htmlToText(data.description).slice(0, 4000);
    const image = galapaPhotoUrl(Array.isArray(data.image) ? data.image[0] : data.image);
    products.set(url, { name, price, currency, url, description, image, availability, stock,
      available: (availability === 'InStock' || availability === 'LimitedAvailability') && stock !== 0 });
  }
  if (!products.size) throw new Error('GALAPA no devolvió productos. Volvé a intentar la sincronización.');
  return [...products.values()];
}

export async function fetchGalapaCatalog(fetcher = fetch) {
  const response = await fetcher(GALAPA_CATALOG_URL, { signal: AbortSignal.timeout(15000), redirect: 'error' });
  if (!response.ok) throw new Error(`GALAPA respondió con HTTP ${response.status}.`);
  return parseGalapaCatalog(await response.text());
}

function productKey(name) {
  return String(name || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function findProduct(products, item) {
  const real = products.filter(product => !product.demo);
  const linked = real.find(product => galapaProductUrl(product.storefront?.url || product.paymentLink) === item.url);
  if (linked) return linked;
  const named = real.filter(product => !product.storefront?.url && productKey(product.name) === productKey(item.name));
  return named.length === 1 ? named[0] : null;
}

async function readPhoto(file) {
  if (!file) return null;
  const buffer = await readFile(file).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  return buffer?.length <= maxPhotoBytes && sniffImage(buffer) ? buffer : null;
}

async function fetchPhoto(url, fetcher) {
  if (!url) return null;
  const response = await fetcher(url, { signal: AbortSignal.timeout(12000), redirect: 'error' });
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > maxPhotoBytes) return null;
  let size = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maxPhotoBytes) return null;
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  return sniffImage(buffer) ? buffer : null;
}

async function loadCover(store, current, previous, item, fetcher) {
  for (const photo of current?.photos || []) {
    if (photo?.file && await readPhoto(store.mediaPath(photo.file))) return { photo, newPhoto: false };
  }
  for (const photo of previous?.photos || []) {
    if (!/^products\/[a-z0-9._-]+$/i.test(photo?.file)) continue;
    const buffer = await readPhoto(path.join(historical, 'media', photo.file));
    if (buffer) {
      const saved = await store.saveMedia(buffer, sniffImage(buffer).ext, 'products', photo.alt || item.name);
      return { photo: saved, newPhoto: true };
    }
  }
  const buffer = await fetchPhoto(item.image, fetcher).catch(() => null);
  if (!buffer) return null;
  const saved = await store.saveMedia(buffer, sniffImage(buffer).ext, 'products', item.name);
  return { photo: saved, newPhoto: true };
}

export async function syncGalapaCatalog(store, { fetcher = fetch } = {}) {
  const items = await fetchGalapaCatalog(fetcher);
  const backup = JSON.parse(await readFile(path.join(historical, 'products.json'), 'utf8').catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return '[]';
  }));
  const initial = store.get('products');
  const prepared = [];
  for (let start = 0; start < items.length; start += 6) {
    const batch = await Promise.all(items.slice(start, start + 6).map(async item => {
      const current = findProduct(initial, item);
      const previous = findProduct(backup, item);
      const cover = await loadCover(store, current, previous, item, fetcher);
      return { item, previous, cover };
    }));
    prepared.push(...batch);
  }

  const current = store.get('products');
  const now = nowISO();
  const present = new Set(items.map(item => item.url));
  const updates = new Map();
  const created = [];
  const usedIds = new Set(current.map(product => product.id));
  const missingPhotos = [];
  for (const { item, previous, cover } of prepared) {
    let existing = findProduct(current, item);
    if (existing && updates.has(existing.id)) existing = null;
    const base = existing || previous;
    const proposedId = previous?.id;
    const key = createHash('sha256').update(item.url).digest('hex').slice(0, 16);
    const id = existing?.id || (proposedId && !usedIds.has(proposedId) ? proposedId : `prd_galapa_${key}`);
    if (!existing && usedIds.has(id)) throw new Error(`Hay dos fichas de GALAPA con el mismo identificador (${item.name}).`);
    usedIds.add(id);
    // El respaldo aporta los datos de la ficha individual. Los precios y el stock vienen de la tienda.
    const photos = existing?.photos || [];
    const coverStillExists = cover && (cover.newPhoto || photos.some(photo => photo?.file === cover.photo.file));
    const product = {
      ...base, id, name: item.name, code: base?.code || `GAL-${key.slice(0, 8).toUpperCase()}`,
      category: base?.category || 'Lámpara', price: item.price, currency: item.currency,
      description: base?.description || item.description,
      photos: coverStillExists ? [cover.photo, ...photos.filter(photo => photo?.file !== cover.photo.file)] : photos,
      status: item.available ? 'listo' : 'borrador', demo: false,
      storefront: { url: item.url, availability: item.availability, available: item.available, stock: item.stock, price: item.price, currency: item.currency },
      createdAt: base?.createdAt || now,
      updatedAt: now,
    };
    if (!coverStillExists) missingPhotos.push(item.name);
    if (existing) {
      const comparable = { ...product, updatedAt: existing.updatedAt };
      updates.set(id, JSON.stringify(comparable) === JSON.stringify(existing) ? existing : product);
    } else {
      created.push(product);
    }
  }
  const retained = current.map(product => {
    if (updates.has(product.id)) return updates.get(product.id);
    const linkedUrl = galapaProductUrl(product.storefront?.url);
    if (!product.storefront?.available || !linkedUrl || present.has(linkedUrl)) return product;
    return { ...product, status: product.status === 'listo' ? 'borrador' : product.status,
      storefront: { ...product.storefront, available: false, availability: 'unlisted', stock: null }, updatedAt: now };
  });
  const changed = retained.filter((product, index) => product !== current[index]).length;
  if (created.length || changed) await store.set('products', [...created, ...retained]);
  const active = items.filter(item => item.available).length;
  return { total: items.length, active, unavailable: items.length - active, created: created.length, updated: changed, missingPhotos };
}
