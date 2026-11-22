import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const data=await mkdtemp(path.join(os.tmpdir(),'lucian-delivery-http-'));
const port=48000+Math.floor(Math.random()*8000);
const base=`http://127.0.0.1:${port}`;
const proc=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,LUCIAN_DATA_DIR:data,LUCIAN_NO_OPEN:'1',LUCIAN_HOST:'127.0.0.1',PORT:String(port)},stdio:'ignore'});
try {
  let okay=false;
  for(let i=0;i<90;i++) { try{if((await fetch(base+'/api/health')).ok){okay=true;break}}catch{} await new Promise(r=>setTimeout(r,120)); }
  assert.ok(okay,'Lucian debe iniciar');
  const before=await (await fetch(base+'/api/state')).json();
  // Compatible también con Lucian V7.1 sin el módulo opcional de V8.
  async function call(body,expect){
    const r=await fetch(base+'/api/sales/reconcile-resend',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    const j=await r.json();assert.equal(r.status,expect,JSON.stringify(j));return j;
  }
  await call({confirm:false},400);
  const rejection=await call({confirm:true},502);
  assert.ok(/Resend|clave/.test(JSON.stringify(rejection)),'Falta credencial de Resend');
  const after=await (await fetch(base+'/api/state')).json();
  assert.deepEqual(after.counts,before.counts,'No crear contactos, misiones ni contenido por error');
  if (before.outreachAudit?.counts && after.outreachAudit?.counts) {
    assert.equal(after.outreachAudit.counts.outboundMessages,before.outreachAudit.counts.outboundMessages);
  }
  console.log('OK HTTP: botón real, API protegida, falla sin credencial y conserva datos.');
} finally {
  proc.kill();
  await new Promise(r=>{if(proc.exitCode!==null)return r();proc.once('exit',r);setTimeout(r,1200)});
  await rm(data,{recursive:true,force:true});
}
