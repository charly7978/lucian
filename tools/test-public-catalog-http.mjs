import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readZip } from '../lib/zip.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const data=await mkdtemp(path.join(os.tmpdir(),'lucian-public-catalog-'));
const port=43000+Math.floor(Math.random()*13000),origin=`http://127.0.0.1:${port}`;
const proc=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:String(port),LUCIAN_DATA_DIR:data,LUCIAN_NO_OPEN:'1',LUCIAN_HOST:'127.0.0.1'},stdio:'ignore'});
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X+4sAAAAASUVORK5CYII=';
async function api(url,body,expect=200){const res=await fetch(origin+url,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});if(expect!==null){const payload=await res.clone().json().catch(()=>({}));assert.equal(res.status,expect,`${url} ${JSON.stringify(payload)}`);}return res;}
try{
  let running=false;
  for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/health')).ok){running=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
  assert.equal(running,true,'Servidor disponible');
  const created=await (await api('/api/products',{name:'Lámpara publicada',price:15000,currency:'ARS',cost:4200,code:'SKU-C',description:'Lámpara de diseño real',photos:[{dataUrl:png,alt:'Foto del producto'}]},201)).json();
  const before=await (await api('/api/state')).json();
  await api('/api/sales/public-catalog',{productIds:[created.product.id],whatsapp:'5491144445555'},400);
  await api('/api/sales/public-catalog',{confirm:true,productIds:[created.product.id],whatsapp:'',email:''},400);
  const res=await api('/api/sales/public-catalog',{confirm:true,productIds:[created.product.id],brand:'LUCIAN',whatsapp:'5491144445555'},200);
  assert.equal(res.headers.get('content-type'),'application/zip');
  assert.equal(res.headers.get('x-lucian-exported'),'1');
  const zip=readZip(Buffer.from(await res.arrayBuffer()));
  const names=zip.map(x=>x.name);
  assert.ok(names.includes('index.html'));
  assert.ok(names.some(x=>x.startsWith('productos/')));
  assert.ok(names.some(x=>x.startsWith('assets/')&&x.endsWith('.png')));
  const html=zip.find(x=>x.name==='index.html').data.toString('utf8');
  assert.ok(html.includes('Lámpara publicada'));
  assert.ok(!html.includes('4200'),'Costo de fabricación no debe mostrarse al público');
  const after=await (await api('/api/state')).json();
  assert.equal(after.counts.missions,before.counts.missions);
  assert.equal(after.counts.threads,before.counts.threads);
  assert.deepEqual(after.products,before.products,'Exportar no cambia el catálogo');
  console.log('OK HTTP public-catalog: ZIP de producto real, fotos, API, confirmación, sin cambios ni mensajes.');
}finally{proc.kill();await new Promise(resolve=>{if(proc.exitCode!==null)return resolve();proc.once('exit',resolve);setTimeout(resolve,1200)});await rm(data,{recursive:true,force:true});}
