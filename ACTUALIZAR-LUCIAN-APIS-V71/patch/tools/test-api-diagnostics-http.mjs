import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = await mkdtemp(path.join(tmpdir(), 'lucian-api-diagnostics-'));
const port = 43000 + Math.floor(Math.random() * 13000);
const url = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['server.mjs'], { cwd:root,
  env:{ ...process.env,LUCIAN_DATA_DIR:dataDir,LUCIAN_HOST:'127.0.0.1',LUCIAN_NO_OPEN:'1',PORT:String(port),
    LUCIAN_AI_KEY:'',LUCIAN_AI_API_KEY:'',LUCIAN_RESEND_KEY:'',LUCIAN_SEARCH_KEY:'' }, stdio:'ignore' });
async function request(route, body) {
  const response = await fetch(url + route, {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined ? {} : {headers:{'content-type':'application/json'},body:JSON.stringify(body)})
  });
  assert.equal(response.status, 200, route);
  return response.json();
}
try {
  let healthy=false;
  for(let i=0;i<90;i++) {
    try { if((await fetch(url+'/api/health')).ok){healthy=true;break;} }catch{}
    await new Promise(r=>setTimeout(r,100));
  }
  assert.ok(healthy,'Servidor de prueba iniciado');
  const diag = await request('/api/connections');
  assert.ok(Array.isArray(diag.connections));
  assert.ok(diag.connections.length >= 7);
  for(const x of diag.connections) {
    assert.ok(['configurado','verificado','pendiente','error'].includes(x.status), x.name);
    assert.equal(x.ok,false,'Ninguna conexión probada debe figurar verificada por defecto');
    assert.equal(typeof x.detail,'string');
    assert.ok(!JSON.stringify(x).includes('apiKey'), 'No enviar credenciales en respuesta');
  }
  const telegram=await request('/api/connections/test',{id:'telegram'});
  assert.equal(telegram.ok,false,'No debe enviar notificaciones ni validar una conexión sin configurar');
  const config=await request('/api/settings/test',{target:'resend'});
  assert.equal(config.ok,false);
  assert.ok(String(config.error).includes('Resend'));
  console.log('OK API HTTP: configuración no equivale a conexión, prueba sin credenciales rechazada, sin exponer claves.');
}finally{
  server.kill();
  await new Promise(resolve=>{if(server.exitCode!==null)return resolve();server.once('exit',resolve);setTimeout(resolve,1500);});
  await rm(dataDir,{recursive:true,force:true});
}
