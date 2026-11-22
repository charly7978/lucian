import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir = await mkdtemp(path.join(os.tmpdir(),'lucian-v6-offers-'));
const port = 41000 + Math.floor(Math.random()*15000);
const base = `http://127.0.0.1:${port}`;
const proc = spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:String(port),LUCIAN_HOST:'127.0.0.1',LUCIAN_DATA_DIR:dir,LUCIAN_NO_OPEN:'1'},stdio:'ignore'});
async function api(route,body,status=200,method=body===undefined?'GET':'POST') {
  const response = await fetch(base+route,{method,headers:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await response.json();
  assert.equal(response.status,status,`${method} ${route}: ${JSON.stringify(data)}`);
  return data;
}
try {
  let ready=false;
  for(let i=0;i<110;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
  assert.equal(ready,true,'Lucian inició');
  const created=(await api('/api/products',{name:'Lámpara QA ventas',price:120000,cost:60000,currency:'ARS',description:'Pieza decorativa de prueba que no se publica.',dimensions:'30 x 30 cm',leadTimeDays:7},201)).product;
  const before=(await api(`/api/products/${created.id}`)).product;
  const kit=(await api('/api/sales/offer-kit',{productId:created.id,channel:'mercadolibre',segment:'particular',platformFeePercent:12,packagingCost:2500})).kit;
  assert.equal(kit.pricing.offerPrice,120000);
  assert.equal(kit.pricing.estimatedProfit,43100);
  assert.equal(kit.audit.published,false);
  assert.ok(kit.content.listing.includes('Lámpara QA ventas'));
  await api('/api/sales/offer-kit',{productId:created.id,discountPercent:98},400);
  await api('/api/sales/offer-kit',{productId:'inexistente'},404);
  const after=(await api(`/api/products/${created.id}`)).product;
  assert.deepEqual(after,before,'generar kit no cambia productos ni datos');
  const bulk = await api('/api/sales/offer-kits',{channel:'pinterest'});
  assert.equal(bulk.count,1);
  assert.ok(bulk.csv.includes('BORRADOR SIN PUBLICAR'));
  assert.ok(bulk.csv.includes('Lámpara QA ventas'));
  await api('/api/sales/offer-kits',{discountPercent:100},400);
  const state=await api('/api/state');
  assert.equal(state.channelReadiness.products,1);
  assert.equal(state.counts.missions,0,'no inicia agentes');
  assert.equal(state.counts.threads,0,'no envía mensajes');
  console.log('OK HTTP: kit comercial, precios, warnings, auditoría, no mutación ni envíos.');
} finally {
  proc.kill();
  await new Promise(resolve=>{if(proc.exitCode!==null)return resolve();proc.once('exit',resolve);setTimeout(resolve,1200)});
  await rm(dir,{recursive:true,force:true});
}
