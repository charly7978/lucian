'use strict';
// Adaptación puntual de la consulta Resend, sin reemplazar servidor/interfaz completos.
// API no envía correos, no cambia configuraciones ni se conecta a servicios al instalar.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const target = path.resolve(process.argv[2] || '');
const mode = process.argv[3] || '--check';
const patchDir = path.join(__dirname, 'files');
function fail(message) { throw Error(message); }
function read(f) { return fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''); }
function sha(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function exactlyOne(haystack, needle, where) {
  const count = haystack.split(needle).length - 1;
  if (count !== 1) fail(`Estructura no compatible en ${where}: marcador esperado ${count} vez/veces. No se modifica nada.`);
}
function syntax(code, filename) {
  const res = spawnSync(process.execPath, ['--check', '--input-type=module'], { input: code, encoding: 'utf8', timeout: 15000 });
  if (res.status !== 0) fail(`Error de sintaxis en ${filename}: ${(res.stderr || '').slice(0, 800)}`);
}
const result = { target, files: [], counts: {}, alreadyInstalled: false };
if (mode !== '--check' && mode !== '--apply') fail('Modo inválido.');
for (const name of ['server.mjs','public/app.js','package.json','data/products.json','lib/outbox.mjs']) {
  if (!fs.existsSync(path.join(target, name))) fail(`No encontré ${name} en la instalación elegida.`);
}
const products = JSON.parse(read(path.join(target, 'data/products.json')));
if (!Array.isArray(products) || products.length < 33) fail('El catálogo no alcanza las 33 lámparas originales. Cancelado sin cambios.');
for (const name of ['products','threads','missions','content']) {
  const f = path.join(target, 'data', `${name}.json`);
  if (fs.existsSync(f)) { const v = JSON.parse(read(f)); if (!Array.isArray(v)) fail(`Los datos de ${name} no tienen formato esperado.`); result.counts[name] = v.length; }
  else result.counts[name] = 0;
}
let server = read(path.join(target, 'server.mjs'));
let app = read(path.join(target, 'public/app.js'));
const BEFORE = new Map([
  ['server.mjs', fs.readFileSync(path.join(target,'server.mjs'))],
  ['public/app.js', fs.readFileSync(path.join(target,'public/app.js'))]
]);
if (!server.includes('obtainResendDeliveryReport')) {
  const importMarker = 'const __dirname =';
  exactlyOne(server,importMarker,'server.mjs (importación)');
  server = server.replace(importMarker,
    "import { obtainResendDeliveryReport, applyResendDeliveryReport } from './lib/resend-delivery.mjs';\n\n" + importMarker);
  const endpoint = [
    "  // Resend: sólo GET hacia el proveedor. Nunca envía mensajes.",
    "  if (pathname === '/api/sales/reconcile-resend' && method === 'POST') {",
    "    const body = await readJson(req);",
    "    if (body.confirm !== true) throw new HttpError(400, 'Confirmá la consulta de entregas de Resend.');",
    "    const key = store.settings().email?.resendKey || '';",
    "    let report;",
    "    try { report = await obtainResendDeliveryReport({ threads: store.get('threads'), apiKey: key }); }",
    "    catch (error) { throw new HttpError(502, error.message); }",
    "    const changed = applyResendDeliveryReport(store.get('threads'), report);",
    "    if (changed) await store.set('threads', store.get('threads'));",
    "    await store.activity('outreach', `Resend conciliado: ${report.counts.found}/${report.counts.tracked} mensajes identificados; ${changed} estados actualizados. Sin envíos.`, { source: 'resend-readonly' });",
    "    json(res, 200, { ok: true, ...report, changed });",
    "    return;",
    "  }",
    "",
  ].join('\n') + '\n';
  const endpointAnchors = [
    "  if (pathname === '/api/sales/prepare-one' && method === 'POST') {",
    "  if (pathname === '/api/email/check-inbox' && method === 'POST') {",
  ];
  const anchor = endpointAnchors.find(x => server.includes(x));
  if (!anchor) fail('Servidor sin rutas de ventas conocidas. No se modifica nada.');
  exactlyOne(server,anchor,'server.mjs (ruta API)');
  server = server.replace(anchor,endpoint + anchor);
  const channelLine = "  const channel = ['resend', 'webhook', 'gmail', 'manual'].includes(body.channel) ? body.channel : 'manual';";
  exactlyOne(server,channelLine,'server.mjs (protección de reenvíos)');
  server = server.replace(channelLine,channelLine + "\n  if (channel !== 'manual' && (thread.messages || []).some(message => message.direction === 'out' && ['bounced', 'suppressed', 'complained'].includes(message.deliveryStatus))) {\n    throw new HttpError(409, 'Hay un rebote, supresión o queja confirmada para este contacto. Revisá su dirección y permisos antes de volver a enviar.');\n  }");
} else if (!server.includes("pathname === '/api/sales/reconcile-resend'")) fail('Encontré módulo Resend importado sin su ruta HTTP. Requiere revisión manual; no se modifica nada.');

if (!app.includes("case 'reconcile-resend':")) {
  const actionAnchor = "    case 'prepare-resends': await prepareResends(); return;";
  exactlyOne(app,actionAnchor,'public/app.js (acción de interfaz)');
  const action = [
    "    case 'reconcile-resend': {",
    "      const confirmed = await confirmAction({ title: 'Comprobar entregas con Resend', message: 'Consulta el estado de correos enviados desde Lucian; no envía mensajes.', confirmLabel: 'Consultar estados' });",
    "      if (!confirmed) return;",
    "      const button = el; button.disabled = true;",
    "      try {",
    "        const result = await api('/api/sales/reconcile-resend', { method: 'POST', body: {confirm: true} });",
    "        await loadState({silent:true,render:false}); render();",
    "        const c = result.counts || {};",
    "        openModal({ title: 'Entregas comprobadas con Resend', subtitle: result.complete ? 'Consulta completa' : 'Consulta parcial',",
    "          body: `<p class=\"small\">Identificados: <b>${num(c.found || 0)} de ${num(c.tracked || 0)}</b>.</p><p class=\"small mt-2\">Entregados: ${num(c.delivered || 0)} · Rebotados: ${num(c.bounced || 0)} · Suprimidos: ${num(c.suppressed || 0)} · Quejas: ${num(c.complained || 0)} · Demorados: ${num(c.delayed || 0)}.</p><p class=\"small muted\">${esc(result.explanation || '')}</p><p class=\"tiny muted\">Entregado no significa leído ni respondido.</p>`,",
    "          footer: '<button class=\"btn btn-primary\" data-action=\"close-modal\">Cerrar</button>' });",
    "      } catch (error) { button.disabled = false; toast(error.message || 'No se pudo consultar Resend.', 'error'); }",
    "      return;",
    "    }",
  ].join('\n') + '\n';
  app = app.replace(actionAnchor,action+actionAnchor);
}
if (!app.includes('data-action="reconcile-resend"')) {
  const start = app.indexOf('function renderVentas() {');
  if (start < 0) fail('La interfaz no tiene renderVentas: no puedo agregar el botón de forma segura.');
  const beginning = app.slice(0,start);
  let remainder = app.slice(start);
  const actionBar = '    <div class="page-actions">';
  exactlyOne(remainder.slice(0,2500), actionBar, 'Ventas (barra de acciones)');
  remainder = remainder.replace(actionBar,actionBar + '\n      ${S.state.settings?.email?.provider === \'resend\' ? `<button class="btn btn-ghost btn-sm" type="button" data-action="reconcile-resend">Comprobar entregas en Resend</button>` : \'\'}');
  app = beginning + remainder;
}
syntax(server,'server.mjs');
syntax(app,'public/app.js');
const changes = [];
if (server !== read(path.join(target, 'server.mjs'))) changes.push({ relative:'server.mjs', data: Buffer.from(server,'utf8') });
if (app !== read(path.join(target, 'public/app.js'))) changes.push({ relative:'public/app.js', data: Buffer.from(app,'utf8') });
for (const relative of ['lib/resend-delivery.mjs','tools/test-resend-delivery.mjs','tools/test-resend-delivery-http.mjs']) {
  const source = path.join(patchDir,relative);
  const destination = path.join(target,relative);
  const data = fs.readFileSync(source);
  if (!fs.existsSync(destination)) changes.push({ relative, data });
  else if (sha(data) !== sha(fs.readFileSync(destination))) fail(`Archivo ${relative} diferente del esperado. Se conserva y no se modifica nada.`);
}
result.alreadyInstalled = changes.length === 0;
result.files = changes.map(x=>x.relative);
console.log('===========================================================');
console.log('  LUCIAN V8.1.2 - PARCHE COMPATIBLE CORREGIDO');
console.log('===========================================================');
console.log('Instalación:',target);
console.log(`Lámparas: ${result.counts.products} | Conversaciones: ${result.counts.threads} | Misiones: ${result.counts.missions} | Contenidos: ${result.counts.content}`);
console.log(result.alreadyInstalled?'[OK] Esta función ya está instalada.':'Archivos a modificar/agregar: '+result.files.join(', '));
console.log('Se conservan los cambios de las demás versiones y TODA la carpeta data.');
if (mode === '--check') process.exit(0);
if (!changes.length) process.exit(0);
const backup = path.join(target,'respaldo-codigo-parche-resend-'+new Date().toISOString().replace(/[-:]/g,'').replace(/\..*/,''));
const copied = [],created=[];
try {
  fs.mkdirSync(backup,{recursive:true});
  for (const {relative} of changes) {
    const dest = path.join(target,relative);
    if (fs.existsSync(dest)) {
      const out = path.join(backup,relative); fs.mkdirSync(path.dirname(out),{recursive:true}); fs.copyFileSync(dest,out); copied.push(relative);
    } else created.push(relative);
  }
  for (const {relative,data} of changes) {
    const dest = path.join(target,relative);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,data);
    if (sha(fs.readFileSync(dest)) !== sha(data)) fail(`Hash incorrecto al guardar ${relative}`);
  }
  for (const p of ['server.mjs','public/app.js','lib/resend-delivery.mjs']) syntax(read(path.join(target,p)),p);
  const test = spawnSync(process.execPath,[path.join(target,'tools/test-resend-delivery.mjs')], {cwd:target,encoding:'utf8',timeout:30000,env:{...process.env,LUCIAN_TEST_MODE:'1'}});
  if(test.status!==0) fail('Prueba autónoma de Resend no pasó: '+String(test.stderr||test.stdout).slice(0,900));
  // Integración HTTP contra carpeta TEMPORAL: no abre tu archivo data ni envía mensajes.
  const integration = spawnSync(process.execPath,[path.join(target,'tools/test-resend-delivery-http.mjs')], {cwd:target,encoding:'utf8',timeout:30000,env:{...process.env,LUCIAN_TEST_MODE:'1'}});
  if(integration.status!==0) fail('Prueba HTTP local no pasó: '+String(integration.stderr||integration.stdout).slice(0,900));
  console.log('[OK] Parche aplicado. Pruebas autónomas y HTTP aprobadas.');
  console.log('Respaldo del código anterior:',backup);
  console.log('No se modificó data, no se enviaron correos.');
}catch(error){
  console.error('[ERROR] '+error.message+' -- revirtiendo archivos modificados.');
  for(const p of copied)fs.copyFileSync(path.join(backup,p),path.join(target,p));
  for(const p of created){const d=path.join(target,p);if(fs.existsSync(d))fs.unlinkSync(d)}
  throw error;
}
