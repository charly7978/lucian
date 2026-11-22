import assert from 'node:assert/strict';
import { runScheduledB2B, scheduledB2BPlan, supervisedMissionPreflight } from '../lib/sales-launch.mjs';
import { verifyProspectArtifact } from '../lib/agents.mjs';
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
