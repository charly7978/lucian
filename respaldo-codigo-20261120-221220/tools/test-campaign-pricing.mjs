import assert from 'node:assert/strict';
import { campaignPriceMap, campaignProductView } from '../lib/campaign-pricing.mjs';
const products = [
  { id:'a', name:'Mesa', price:100, currency:'ARS', photos:[{file:'a.jpg'}] },
  { id:'b', name:'Techo', price:200, currency:'USD' },
  { id:'c', name:'Aplique', price:0, currency:'ARS' },
];
const map = campaignPriceMap(products, {a: '140.25', b: 180, c: '0.01'});
assert.equal(map.size, 3);
assert.equal(map.get('a'), 140.25);
const view = campaignProductView(products[0], map);
assert.equal(view.price,140.25);
assert.equal(view.campaignPriceOverridden,true);
assert.equal(products[0].price,100,'El catálogo original nunca cambia');
assert.deepEqual([...campaignPriceMap(products, {}).entries()],[]);
for(const override of [{a:0}, {a:-1},{a:''},{a:'abc'},{a:'14,5'},{a:1.234},{a:1e50},{missing:200},{a:null}]) {
  assert.throws(()=>campaignPriceMap(products, override),undefined,JSON.stringify(override));
}
assert.throws(()=>campaignPriceMap(products, []));
console.log('OK: precio exclusivo por lámpara, sin cambios al catálogo, valores inválidos rechazados.');
