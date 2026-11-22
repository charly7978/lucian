import assert from 'node:assert/strict';
import { buildOfferKit, buildBulkOfferRows, buildChannelReadiness, SALES_CHANNELS, SALES_SEGMENTS } from '../lib/sales-offers.mjs';

const base = { id: 'l-1', name:'Aurora', code:'AU-01', status:'listo', price:100000, currency:'ARS', cost:35000,
  photos:[{file:'media/aurora.jpg'}], description:'Lámpara para decorar espacios contemporáneos con formas originales.',
  dimensions:'32 x 18 cm', materials:'Material de impresión 3D', leadTimeDays:7, capacityPerWeek:5, weightGrams:900 };
const original = structuredClone(base);
const kit = buildOfferKit(base, {segment:'interiorista',channel:'b2b',discountPercent:10,platformFeePercent:12,paymentFeePercent:3,packagingCost:2000,shippingSubsidy:3000,adCostPerSale:1000,costsVerified:true});
assert.equal(kit.pricing.catalogPrice,100000);
assert.equal(kit.pricing.offerPrice,90000);
assert.equal(kit.pricing.feeEstimated,13500);
assert.equal(kit.pricing.fixedCost,6000);
assert.equal(kit.pricing.estimatedProfit,35500);
assert.equal(kit.pricing.estimatedMarginPct,39.44);
assert.equal(kit.audit.canSpendOnAds,true);
assert.equal(kit.audit.published,false);
assert.match(kit.content.listing,/32 x 18 cm/);
assert.match(kit.content.pitch,/ficha técnica/);
assert.equal(kit.content.hooks.length,3);
assert.deepEqual(base,original,'NO altera productos existentes');
const special = buildOfferKit(base,{priceOverride:170000,discountPercent:10});
assert.equal(special.pricing.offerPrice,153000);
assert.equal(base.price,100000,'precio original intacto');
assert.equal(special.pricing.breakEvenPrice,35000);
const loss = buildOfferKit(base,{discountPercent:70,platformFeePercent:15,packagingCost:9000});
assert.ok(loss.pricing.estimatedProfit<0);
assert.equal(loss.audit.canSpendOnAds,false);
assert.ok(loss.audit.missing.some(x=>x.includes('negativo')));
const unknown = buildOfferKit({...base,cost:0},{channel:'mercadolibre'});
assert.equal(unknown.pricing.estimatedProfit,null);
assert.equal(unknown.audit.canSpendOnAds,false);
assert.ok(unknown.audit.missing.some(x=>x.includes('costo de fabricación')));
const poor = buildOfferKit({...base,photos:[],dimensions:'',leadTimeDays:0,description:''},{channel:'google'});
assert.equal(poor.audit.canSpendOnAds,false);
assert.ok(poor.audit.missing.some(x=>x.includes('URL pública')));
const google = buildOfferKit(base,{channel:'google',publicProductUrl:'https://example.com/aurora'});
assert.ok(!google.audit.missing.some(x=>x.includes('URL pública')));
const etsy = buildOfferKit(base,{channel:'etsy'});
assert.ok(etsy.audit.missing.some(x=>x.includes('Etsy')));
assert.equal(etsy.content.pitch.includes('reseñas reales'),false);
for (const [options,error] of [
  [{discountPercent:-1},/entre 0/], [{discountPercent:90},/entre 0/],
  [{platformFeePercent:70,paymentFeePercent:30},/95%/],
  [{adCostPerSale:-3},/entre 0/], [{priceOverride:'nan'},/entre 0/],
  [{publicProductUrl:'http://evil.test'},/https/],
]) assert.throws(()=>buildOfferKit(base,options),error);
assert.ok(SALES_CHANNELS.length>=7);
assert.ok(SALES_SEGMENTS.length>=5);
assert.equal(buildChannelReadiness([base]).products,1);
assert.equal(buildChannelReadiness([{...base,cost:0}, {...base,id:'l-2',status:'archivado',cost:0}]).missingCost,1);
assert.equal(buildChannelReadiness([{...base,photos:[]}]).missingPhotos,1);
assert.equal(buildChannelReadiness([{...base,leadTimeDays:0}]).missingLeadTime,1);
assert.equal(buildOfferKit(base,{channel:'whatsapp'}).disclaimer.includes('no'),true);
const big = Array.from({length:135},(_,i)=>({...base,id:`lamp-${i}`,name:`Diseño ${i}`}));
const bulk = buildBulkOfferRows(big,{channel:'pinterest'});
assert.equal(bulk.rows.length,135,'Sin un límite arbitrario de seis lámparas');
assert.equal(bulk.rows[134].estado,'BORRADOR SIN PUBLICAR');
const filtered = buildBulkOfferRows(big,{productIds:['lamp-2','lamp-5'],segment:'tienda'});
assert.equal(filtered.rows.length,2);
assert.equal(filtered.rows[0].comprador,'Tiendas de diseño y revendedores');
assert.equal(big[2].price,base.price);
console.log('OK: ofertas por canal, precios, descuentos, costo real, margen, auditoría, no publicaciones, catálogo inmutable y URLs públicas.');
