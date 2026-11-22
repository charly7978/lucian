import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { planCatalogBulk } from '../lib/catalog-bulk.mjs';

const products = Array.from({length: 135}, (_, i) => ({
  id: `p${String(i).padStart(3, '0')}`, name: `Lámpara ${i}`, code: `SKU-${i}`,
  status:'listo', price:100, cost:50, currency:'ARS',
  photos:[{file:`products/lamp-${i}.jpg`}], updatedAt:'2026-11-20T08:00:00Z',
}));
const ids = products.map(p=>p.id);
const up = planCatalogBulk(products, {productIds:ids,action:'percent-price',value:500});
assert.equal(up.count,135);
assert.equal(up.changed,135);
assert.ok(up.changes.every(c=>c.newPrice===600));
assert.equal(planCatalogBulk(products,{productIds:ids,action:'delete'}).changed,135);
assert.throws(()=>planCatalogBulk(products,{productIds:[],action:'delete'}));
assert.throws(()=>planCatalogBulk(products,{productIds:ids,action:'percent-price',value:-100}));

const folder=await fs.mkdtemp(path.join(os.tmpdir(),'lucian-v5-unlimited-'));
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
await fs.writeFile(path.join(folder,'products.json'),JSON.stringify(products),'utf8');
const port=45000+Math.floor(Math.random()*17000), origin=`http://127.0.0.1:${port}`;
const proc=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,LUCIAN_DATA_DIR:folder,LUCIAN_NO_OPEN:'1',LUCIAN_MOCK_DELAY:'0',PORT:String(port),LUCIAN_HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
let output=''; proc.stdout.on('data',d=>output+=d);proc.stderr.on('data',d=>output+=d);
const request=async(route,body,expected=200)=>{
  const res=await fetch(`${origin}${route}`,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const text=await res.text(); let result; try{result=JSON.parse(text)}catch{result={raw:text}}
  assert.equal(res.status,expected,`${route}: HTTP ${res.status}; ${text.slice(0,300)}; server=${output.slice(-400)}`);
  return result;
};
try {
  let ready=false;
  for(let i=0;i<80;i++){try{if((await fetch(origin+'/api/health')).ok){ready=true;break}}catch{} await new Promise(r=>setTimeout(r,100))}
  assert.ok(ready,'El servidor V5 debe arrancar');
  const body={name:'Campaña completa',productIds:ids, mode:'real',markets:['Argentina','Uruguay','Chile','España','México','Portugal','Italia'],goal:'conseguir-mayoristas',marketStrategy:'rotate',depth:'estandar',maxProspects:40,skipRecent:false};
  const prev=(await request('/api/campaigns/preview',body)).plan;
  assert.equal(prev.selected,135);
  assert.equal(prev.willStart,135);
  assert.equal(prev.remaining,0);
  assert.equal(prev.estimatedMaxProspects,5400);
  assert.equal(prev.markets.length,7);
  assert.ok(!prev.canStart,'Sin IA configurada solo se puede previsualizar, no iniciar');
  await request('/api/campaigns',{...body, confirm:true,snapshot:prev.snapshot},409);
  assert.equal((await request('/api/missions')).missions.length,0);
  const pricePreview=(await request('/api/products/bulk/preview',{productIds:ids,action:'percent-price',value:300})).plan;
  assert.equal(pricePreview.count,135);
  await request('/api/products/bulk',{productIds:ids,action:'percent-price',value:300,confirm:true,snapshot:pricePreview.snapshot});
  const after=await request('/api/products');
  assert.equal(after.products.length,135);
  assert.ok(after.products.every(p=>p.price===400));
  const deleteIds=[ids[0],ids[1]];
  const deletePreview=(await request('/api/products/bulk/preview',{productIds:deleteIds,action:'delete'})).plan;
  await request('/api/products/bulk',{productIds:deleteIds,action:'delete',confirm:true,snapshot:deletePreview.snapshot},400);
  await request('/api/products/bulk',{productIds:deleteIds,action:'delete',confirm:true,confirmWord:'ELIMINAR',snapshot:deletePreview.snapshot});
  assert.equal((await request('/api/products')).products.length,133);
  const retained=ids[2];
  const thread=(await request('/api/threads',{productId:retained,contact:{company:'Contacto QA',email:'qa@ejemplo.test'}},201)).thread;
  assert.equal(thread.productId,retained);
  const linkedPreview=(await request('/api/products/bulk/preview',{productIds:[retained],action:'delete'})).plan;
  await request('/api/products/bulk',{productIds:[retained],action:'delete',confirm:true,confirmWord:'ELIMINAR',snapshot:linkedPreview.snapshot},409);
  assert.equal((await request('/api/products')).products.length,133);
  assert.equal((await request('/api/threads')).threads.length,1);
  // Una campaña con 33 productos no se corta a 6 y se conserva el precio aprobado.
  const remaining=(await request('/api/products')).products.slice(0,33);
  const demoBody={name:'Colección íntegra',mode:'demo',productIds:remaining.map(p=>p.id),markets:['Argentina','Chile','Uruguay'],goal:'conseguir-mayoristas',maxProspects:8};
  const demoPreview=(await request('/api/campaigns/preview',demoBody)).plan;
  assert.equal(demoPreview.willStart,33);
  const campaign=(await request('/api/campaigns',{...demoBody,confirm:true,snapshot:demoPreview.snapshot},201)).campaign;
  assert.equal(campaign.created.length,33);
  const first=(await request(`/api/missions/${campaign.created[0].id}`)).mission;
  assert.equal(first.priceSnapshot.price,400);
  assert.equal(first.priceSnapshot.currency,'ARS');
  console.log('OK V5: 135 lámparas previsualizadas sin cap; mercado 7; tope prospectos 40; sin IA no se inicia; precios masivos; borrado protegido por historial.');
} finally {
  proc.kill('SIGTERM');
  await new Promise(r=>{if(proc.exitCode!==null)return r();proc.once('exit',r);setTimeout(r,1200)});
  await fs.rm(folder,{recursive:true,force:true});
}
