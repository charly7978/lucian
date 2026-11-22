import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = await mkdtemp(path.join(os.tmpdir(), 'lucian-supervised-'));
const port = 46000 + Math.floor(Math.random() * 10000);
const base = `http://127.0.0.1:${port}`;
const now = new Date().toISOString();
await writeFile(path.join(data, 'missions.json'), JSON.stringify([
  { id: 'b2b', name: 'Hoteles y mayoristas', b2bFocus: true, status: 'done', createdAt: now },
]));
await writeFile(path.join(data, 'threads.json'), JSON.stringify(['hotel', 'mayorista', 'sin-permiso'].map(id => ({
  id, missionId: 'b2b', stage: 'nuevo', contact: { company: id, email: `compras@${id}.test` },
  drafts: [{ id: `draft-${id}`, source: 'mision', channel: 'email', status: id === 'mayorista' ? 'revisar' : 'listo',
    subject: 'Propuesta de iluminación', body: `Una propuesta para ${id}.`, guardVersion: 2, createdAt: now }],
  messages: [],
}))));
const proc = spawn(process.execPath, ['server.mjs'], {cwd:root,env:{...process.env,PORT:String(port),LUCIAN_DATA_DIR:data,LUCIAN_NO_OPEN:'1',LUCIAN_HOST:'127.0.0.1'},stdio:'ignore'});
async function call(route, body, expect, method = body === undefined ? 'GET' : 'POST') {
  const res = await fetch(base+route,{method,headers:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const j = await res.json();
  assert.equal(res.status,expect,`${route}: ${JSON.stringify(j)}`);
  return j;
}
try{
  let okay=false;
  for(let i=0;i<90;i++){try{if((await fetch(base+'/api/health')).ok){okay=true;break}}catch{};await new Promise(r=>setTimeout(r,120))}
  assert.ok(okay,'Servidor local iniciado');
  const before=await call('/api/state',undefined,200);
  assert.equal(before.salesLaunch.canStart,false,'Sin IA real configurada no debe correr');
  assert.equal(before.scheduledB2B.enabled, false);
  await call('/api/settings', { mission: { scheduledB2B: true } }, 200, 'PUT');
  await call('/api/autopilot/run', {}, 200);
  await call('/api/sales/prepare-one',{productId:'x'},400);
  await call('/api/sales/prepare-one',{confirm:true,productId:'x'},409);
  const after=await call('/api/state',undefined,200);
  assert.equal(after.counts.missions,before.counts.missions,'No se crean misiones por solicitudes rechazadas');
  assert.equal(after.scheduledB2B.enabled, true);
  assert.equal(after.scheduledB2B.canStart, false);
  assert.equal(after.scheduledB2B.lastAttempt, null);
  console.log('OK HTTP: preflight visible, rechazo de inicio sin configuracion, y sin misiones creadas.');

  const evidence = 'Pidió recibir el catálogo en una reunión el 20 de noviembre.';
  const permission = { status: 'opted_in', evidence };
  await call('/api/settings', { email: { provider: 'webhook', webhookUrl: 'http://127.0.0.1:1/test' } }, 200, 'PUT');
  for (const id of ['hotel', 'mayorista']) {
    await call(`/api/threads/${id}`, { contact: { permission } }, 200, 'PATCH');
  }
  assert.equal((await call('/api/outbox', undefined, 200)).pending, 0);
  await call('/api/policy/approve', {}, 200);
  assert.deepEqual((await call('/api/outbox', undefined, 200)).items.map(item => item.threadId), ['hotel']);
  await call('/api/threads/mayorista/drafts/draft-mayorista', { status: 'listo' }, 200, 'PATCH');
  await call('/api/policy/apply', {}, 200);
  let queue = await call('/api/outbox', undefined, 200);
  assert.deepEqual(queue.items.map(item => item.threadId).sort(), ['hotel', 'mayorista']);
  const hotel = queue.items.find(item => item.threadId === 'hotel');
  await call(`/api/outbox/${hotel.id}/cancel`, {}, 200);
  await call('/api/policy/apply', {}, 200);
  const changed = await call('/api/threads/mayorista', { contact: { email: 'nuevo@mayorista.test', permission } }, 200, 'PATCH');
  assert.equal(changed.thread.contact.permission.status, 'unknown');
  queue = await call('/api/outbox', undefined, 200);
  assert.equal(queue.items.length, 2);
  assert.equal(queue.items.find(item => item.id === hotel.id).status, 'cancelled');
  console.log('OK HTTP: cola B2B con Política única y permiso, sin duplicados ni transferencia de permiso.');
}finally{proc.kill();await new Promise(r=>{if(proc.exitCode!==null)return r();proc.once('exit',r);setTimeout(r,1200)});await rm(data,{recursive:true,force:true})}
