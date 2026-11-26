import assert from 'node:assert/strict';
import { runScheduledB2B, scheduledB2BPlan, supervisedMissionPreflight } from '../lib/sales-launch.mjs';
import { verifyProspectArtifact } from '../lib/agents.mjs';
import { findXalapaProspects, xalapaProducts } from '../lib/xalapa-sales.mjs';
const now = Date.parse('2026-11-20T22:00:00Z');
const product = (id, p = {}) => ({ id, name: `Lampara ${id}`, photos: [{file: 'foto.jpg'}], price: 100, ...p });
const data = { now, products: [product('A'), product('B'), product('C', {photos:[]}), product('D', { status:'archivado'})],
  missions: [], settings: { mission: {markets:['Argentina']} }, aiReady: true, searchInfo: {provider:'duckduckgo', ready:true} };
let plan = supervisedMissionPreflight(data);
assert.equal(plan.canStart, true);
assert.equal(plan.eligible, 2);
assert.equal(plan.unready, 1);
assert.equal(plan.maximumProspects, 8);
assert.equal(plan.candidate.id, 'A');
assert.equal(plan.warnings.length, 1);
assert.equal(supervisedMissionPreflight({...data, aiReady:false}).canStart, false);
assert.equal(supervisedMissionPreflight({...data, settings:{mission:{markets:[]}}}).canStart, false);
assert.equal(supervisedMissionPreflight({...data, searchInfo:{provider:'none',ready:true}}).canStart, false);
assert.equal(supervisedMissionPreflight({...data, searchInfo:{}}).canStart, false);
let recent = {productId:'A',demo:false,status:'done',createdAt: new Date(now-2*86400000).toISOString()};
plan = supervisedMissionPreflight({...data, missions:[recent]});
assert.equal(plan.candidate.id, 'B');
plan = supervisedMissionPreflight({...data, missions:[{...recent,status:'running'}]});
assert.equal(plan.canStart, false);
assert.ok(plan.reasons.some(x => x.includes('Ya hay una misión')));
plan = supervisedMissionPreflight({...data, missions:[{...recent,createdAt:new Date(now-8*86400000).toISOString()}]});
assert.equal(plan.eligible, 2);
plan = supervisedMissionPreflight({...data, missions:[{...recent,status:'error'}]});
assert.equal(plan.eligible, 2);
assert.equal(supervisedMissionPreflight({...data,products:[product('C',{photos:[]})]}).canStart,false);
assert.ok(plan.guarantee.includes('NO envía'));
console.log('OK: preflight IA, busqueda, mercados, fichas, misiones activas y deduplicacion por 7 dias.');

const automatic = { ...data, settings: { mission: { scheduledB2B: true, markets: ['Argentina', 'España'], maxProspects: 6 } } };
assert.deepEqual(scheduledB2BPlan(data), { enabled: false });
assert.equal(scheduledB2BPlan(automatic, new Date(now - 3600000).toISOString()).canStart, false);
assert.equal(scheduledB2BPlan({ ...automatic, aiReady: false }).canStart, false);

const meta = {};
const store = {
  settings: () => automatic.settings,
  get: (key) => key === 'meta' ? meta : automatic[key],
  setMeta: async (patch) => { Object.assign(meta, patch); },
};
const calls = [];
const deps = {
  now,
  aiReady: () => true,
  searchInfo: () => automatic.searchInfo,
  createMission: async (body, options) => { calls.push({ body, options }); return body; },
};
await Promise.all([runScheduledB2B(store, deps), runScheduledB2B(store, deps)]);
assert.equal(calls.length, 1);
assert.equal(calls[0].options.b2bFocus, true);
assert.equal(calls[0].body.manualReviewOnly, undefined);
assert.deepEqual(calls[0].body.markets, ['Argentina']);
assert.equal(calls[0].body.maxProspects, 6);
assert.equal(calls[0].body.mode, 'real');
assert.equal(await runScheduledB2B(store, { ...deps, now: now + 23 * 3600000 }), null);

const verified = await verifyProspectArtifact({ compradores: [
  { nombre: 'Tienda Ejemplo', tipo: 'tienda', por_que: 'Vende iluminación' },
  { nombre: 'Distribuidor Ejemplo', tipo: 'distribuidor' },
] }, { mission: { b2bFocus: true, markets: ['España'] } });
assert.equal(verified.compradores.length, 0);
assert.equal(verified.descartados.length, 2);
console.log('OK: prospección B2B optativa, límite de 24 h, disparos simultáneos y filtro de compradores.');

const storefront = { url: 'https://galapa.com.ar/productos/xalapa-uno/', available: true };
assert.deepEqual(xalapaProducts([
  product('real', { status: 'listo', storefront }),
  product('demo', { status: 'listo', storefront, demo: true }),
  product('foreign', { status: 'listo', storefront: { ...storefront, url: 'https://otro.test/productos/xalapa-uno/' } }),
  product('empty', { status: 'listo', storefront: { ...storefront, available: false } }),
]).map((item) => item.id), ['real']);

const reached = [];
const result = await findXalapaProspects({}, 'hoteles', {
  search: async () => ({
    engine: 'motor de prueba',
    results: [
      { url: 'https://booking.com/hotel/ar/foo' },
      { url: 'https://hotel-prueba.test/reservas' },
      { url: 'https://hotel-prueba.test/contacto' },
      { url: 'https://redireccion.test/' },
      { url: 'https://otro-negocio.test/' },
    ],
  }),
  inspect: async (origin) => {
    reached.push(origin);
    if (origin.includes('redireccion')) return {
      reachable: true, pages: ['https://booking.com/hotels'], title: 'Hotel', sample: 'Habitaciones Buenos Aires', emails: [],
    };
    if (origin.includes('otro-negocio')) return { reachable: true, pages: [origin], title: 'Tienda', sample: 'Indumentaria de Buenos Aires', emails: [] };
    return {
      reachable: true, pages: [origin, origin + '/contacto'], title: 'Hotel Buenos Aires | Sitio oficial',
      sample: 'Hotel boutique. Habitaciones y reservas en Buenos Aires.',
      emails: [{ email: 'compras@falsohotel-prueba.test', source: origin }, { email: 'compras@hotel-prueba.test', source: origin + '/contacto' }],
    };
  },
});
assert.equal(result.status, 'found');
assert.equal(result.checked, 3);
assert.equal(reached.length, 3);
assert.equal(result.prospects.length, 1);
assert.equal(result.prospects[0].email, 'compras@hotel-prueba.test');
assert.equal(result.prospects[0].contactUrl, 'https://hotel-prueba.test/contacto');
const wholesale = await findXalapaProspects({}, 'mayoristas', {
  search: async () => ({ results: [{ url: 'https://lighting-prueba.test/' }, { url: 'https://mixed-prueba.test/' }] }),
  inspect: async (origin) => ({
    reachable: true, pages: [origin], title: origin.includes('mixed') ? 'Bazar' : 'Iluminación de prueba',
    sample: origin.includes('mixed')
      ? `Venta mayorista Buenos Aires. ${'Artículos de cocina. '.repeat(10)} Lámparas.`
      : 'Venta mayorista de lámparas en Buenos Aires.',
    emails: [],
  }),
});
assert.deepEqual(wholesale.prospects.map((item) => item.id), ['lighting-prueba.test']);
assert.equal((await findXalapaProspects({}, 'mayoristas', {
  search: async () => ({ results: [] }),
})).status, 'unavailable');
console.log('OK: búsqueda Xalapa con sitios verificables, contacto publicado, deduplicación y catálogo activo.');
