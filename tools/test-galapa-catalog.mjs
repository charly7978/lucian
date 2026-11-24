import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GALAPA_CATALOG_URL, syncGalapaCatalog } from '../lib/galapa-catalog.mjs';
import { buildPublicCatalog } from '../lib/public-catalog.mjs';
import { Store } from '../lib/store.mjs';

const data = await mkdtemp(path.join(os.tmpdir(), 'lucian-galapa-'));
const store = await new Store(data).init();
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X+4sAAAAASUVORK5CYII=', 'base64');
const cover = 'https://dcdn-us.mitiendanube.com/stores/demo/luz.png';
const slug = number => `prueba-galapa-${number}`;
const productUrl = number => `${GALAPA_CATALOG_URL}/${slug(number)}/`;
const structured = (number, availability = 'InStock', stock = 6, price = 15000.25) => ({
  '@type': 'Product', name: `Luz de prueba ${number}`, description: '<p>Lámpara &amp; luz de prueba</p>', image: cover,
  offers: { url: productUrl(number), price, priceCurrency: 'ARS', availability: `https://schema.org/${availability}`, inventoryLevel: { value: stock } },
});
let page = Array.from({ length: 33 }, (_, index) => structured(index));
let images = 0;
const fetcher = async url => {
  if (url === GALAPA_CATALOG_URL) {
    return new Response(page.map(item => `<script type="application/ld+json">${JSON.stringify(item)}</script>`).join('\n'));
  }
  assert.equal(url, cover);
  images += 1;
  return new Response(png);
};

try {
  const existing = { id: 'luz-existente', name: 'Luz de prueba 0', code: 'PROPIO', cost: 1200, notes: 'Nota del fabricante', status: 'archivado', paymentLink: productUrl(0), photos: [] };
  const unrelated = { id: 'producto-propio', name: 'Otra lámpara', status: 'borrador' };
  await store.set('products', [existing, unrelated]);
  await store.set('threads', [{ id: 'historial', productId: existing.id }]);
  const settings = structuredClone(store.get('settings'));

  const first = await syncGalapaCatalog(store, { fetcher });
  assert.deepEqual(first, { total: 33, active: 33, unavailable: 0, created: 32, updated: 1, missingPhotos: [] });
  assert.equal(images, 33);
  const products = store.get('products');
  assert.equal(products.length, 34);
  assert.equal(products.filter(product => product.status === 'listo').length, 33);
  assert.equal(store.find('products', existing.id).notes, existing.notes);
  assert.equal(store.find('products', existing.id).cost, existing.cost);
  assert.equal(store.find('products', existing.id).code, existing.code);
  assert.equal(store.find('products', existing.id).description, 'Lámpara & luz de prueba');
  assert.deepEqual(store.get('threads'), [{ id: 'historial', productId: existing.id }]);
  assert.deepEqual(store.get('settings'), settings);
  assert.deepEqual(store.find('products', unrelated.id), unrelated);

  const second = await syncGalapaCatalog(store, { fetcher });
  assert.equal(second.created + second.updated, 0, 'La sincronización es repetible sin duplicar ni reescribir');
  assert.equal(images, 33, 'Reutiliza las fotografías locales');

  page = [structured(0, 'InStock', 5, 14500), structured(1, 'OutOfStock', 0), ...page.slice(3)];
  const update = await syncGalapaCatalog(store, { fetcher });
  assert.equal(update.active, 31);
  assert.equal(update.updated, 3);
  assert.equal(store.find('products', existing.id).price, 14500);
  assert.equal(store.get('products').find(product => product.storefront?.url === productUrl(2)).storefront.available, false);
  const managed = store.get('products').filter(product => product.storefront);
  const exportProducts = managed.map(product => product.id === existing.id ? { ...product, price: 999999 } : product);
  const site = await buildPublicCatalog(exportProducts, {}, file => readFile(store.mediaPath(file)));
  assert.equal(site.count, 31);
  assert.equal(site.excluded.length, 2);
  const html = site.entries.find(item => item.name === 'index.html').data;
  assert.equal((html.match(/Comprar en GALAPA/g) || []).length, 31);
  assert.match(html, /14\.500,00 ARS/);
  assert.doesNotMatch(html, /999\.999,00 ARS/);
  assert.ok(html.includes(productUrl(0)));
  assert.ok(!html.includes(productUrl(1)) && !html.includes(productUrl(2)));
  await assert.rejects(buildPublicCatalog(managed, { priceOverrides: { [existing.id]: 42 } }, async () => png), /Tiendanube/);

  const beforeFailure = JSON.stringify(store.get('products'));
  page = [];
  await assert.rejects(syncGalapaCatalog(store, { fetcher }), /no devolvió productos/);
  assert.equal(JSON.stringify(store.get('products')), beforeFailure);
  console.log('OK GALAPA: 33 altas/activaciones, sincronización repetible, fotos, precios de tienda, disponibilidad y exportación con compra.');
} finally {
  await rm(data, { recursive: true, force: true });
}
