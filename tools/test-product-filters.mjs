import assert from 'node:assert/strict';
import { DEFAULT_CATALOG_FILTERS, catalogFilterOptions, filterCatalog } from '../public/catalog-filters.mjs';

const photo = [{ file: 'products/foto.jpg' }];
const products = [
  { id: 'a', name: 'Rembá', code: 'VEL-1', category: 'Velador', materials: 'PLA', status: 'listo', currency: 'ARS', price: 42000, photos: photo, storefront: { available: true } },
  { id: 'b', name: 'Pie 10', category: 'Lámpara de pie', status: 'listo', currency: 'ARS', price: 99000, photos: photo, storefront: { available: true } },
  { id: 'c', name: 'Pie 2', category: 'Lampara de pie', price: 4000, currency: 'USD', storefront: { available: false } },
  { id: 'd', name: 'Modelo archivado', category: 'Velador', status: 'archivado', price: 0, currency: 'ARS', photos: photo },
  { id: 'e', name: 'Velador de prueba', category: 'Velador', status: 'listo', currency: 'ARS', price: 36000 },
];
const options = catalogFilterOptions(products);
assert.equal(options.categories.length, 2);
assert.deepEqual(options.currencies, ['ARS', 'USD']);

function lookup(filters, selected) {
  const result = filterCatalog(products, { ...DEFAULT_CATALOG_FILTERS, ...filters }, selected);
  return { ids: result.visible.map(product => product.id), error: result.priceError };
}
assert.deepEqual(lookup({ query: 'remba pla', status: 'listo', category: 'velador', availability: 'available' }).ids, ['a']);
assert.deepEqual(lookup({ query: 'VEL-1' }).ids, ['a']);
assert.deepEqual(lookup({ category: 'lampara de pie', sort: 'name' }).ids, ['c', 'b']);
assert.deepEqual(lookup({ availability: 'unavailable', status: 'borrador' }).ids, ['c']);
assert.deepEqual(lookup({ availability: 'unlinked', details: 'no-photo' }).ids, ['e']);
assert.deepEqual(lookup({ details: 'no-price' }).ids, ['d']);
assert.deepEqual(lookup({ details: 'ready' }).ids, ['a', 'b']);
assert.deepEqual(lookup({ details: 'missing' }).ids, ['c', 'd', 'e']);
assert.deepEqual(lookup({ currency: 'ARS', minPrice: '42000', maxPrice: '99000', sort: 'price-high' }).ids, ['b', 'a']);
assert.deepEqual(lookup({ currency: 'ARS', sort: 'price-high' }).ids, ['b', 'a', 'e', 'd']);
assert.deepEqual(lookup({ selectedOnly: true, category: 'velador' }, ['a', 'b', 'e']).ids, ['a', 'e']);
assert.match(lookup({ minPrice: '100' }).error, /moneda/);
assert.match(lookup({ currency: 'ARS', minPrice: '300', maxPrice: '100' }).error, /menor o igual/);
assert.match(lookup({ currency: 'ARS', minPrice: '-100' }).error, /precios/);
assert.deepEqual(lookup({}).ids, ['a', 'b', 'c', 'd', 'e'], 'Los filtros no mutan el catálogo');

console.log('OK filtros del catálogo: búsqueda sin tildes, categorías, disponibilidad, moneda, estado, ficha, rango y selección.');
