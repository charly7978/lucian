import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lucian-ventas-'));
const port = 44000 + Math.floor(Math.random() * 18000);
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['server.mjs'], {
  cwd: root, env: { ...process.env, PORT: String(port), LUCIAN_DATA_DIR: dataDir, LUCIAN_NO_OPEN: '1', LUCIAN_HOST: '127.0.0.1' }, stdio: 'ignore',
});
async function api(route, body, method = 'GET', expected = 200) {
  const response = await fetch(origin + route, {
    method, headers: { 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json = await response.json();
  assert.equal(response.status, expected, `${method} ${route}: ${JSON.stringify(json)}`);
  return json;
}
async function ready() {
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(origin + '/api/health'); if (r.ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  throw new Error('Servidor de pruebas no iniciado');
}
try {
  await ready();
  const p = await api('/api/products', { name: 'Lámpara de prueba', price: 100, currency: 'USD', description: 'Pieza para validar ventas', status: 'listo' }, 'POST', 201);
  const productId = p.product.id;
  const t = await api('/api/threads', { productId, contact: { name: 'Comprador', company: 'Comercial QA', email: 'comprador@ejemplo.test' } }, 'POST', 201);
  const threadId = t.thread.id;
  const quote = (await api(`/api/threads/${threadId}/quotes`, { quantity: 2, unitPrice: 100, approve: false }, 'POST', 201)).quote;
  const base = `/api/threads/${threadId}/quotes/${quote.id}`;
  const payment = `${base}/payments`;
  await api(payment, { amount: 50, reference: 'OP-001', method: 'transferencia', confirm: true }, 'POST', 409);
  const accepted = await api(base, { status: 'aceptada' }, 'PATCH');
  assert.equal(accepted.quote.status, 'aceptada');
  let sales = (await api('/api/state')).sales;
  assert.equal(sales.acceptedQuotes, 1);
  assert.equal(sales.revenue, 0, 'Aceptar no debe generar cobro');
  assert.equal(sales.outstandingByCurrency.USD, 200);
  await api(payment, { amount: 50, reference: 'OP-001', method: 'transferencia', confirm: false }, 'POST', 400);
  await api(payment, { amount: 201, reference: 'OP-001', method: 'transferencia', confirm: true }, 'POST', 409);
  await api(payment, { amount: -10, reference: 'OP-001', method: 'transferencia', confirm: true }, 'POST', 400);
  await api(payment, { amount: 0.001, reference: 'OP-001', method: 'transferencia', confirm: true }, 'POST', 400);
  await api(payment, { amount: 50, reference: 'x', method: 'transferencia', confirm: true }, 'POST', 400);
  const first = await api(payment, { amount: 50, reference: 'OP-001', method: 'transferencia', confirm: true }, 'POST', 201);
  assert.equal(first.totals.remaining, 150);
  const duplicate = await api(payment, { amount: 50, reference: 'OP-001', method: 'transferencia', confirm: true }, 'POST');
  assert.equal(duplicate.alreadyRecorded, true);
  await api(payment, { amount: 60, reference: 'OP-001', method: 'transferencia', confirm: true }, 'POST', 409);
  await api(base, { status: 'rechazada' }, 'PATCH', 409);
  sales = (await api('/api/state')).sales;
  assert.equal(sales.revenue, 50);
  assert.equal(sales.outstandingByCurrency.USD, 150);
  await api(payment, { amount: 150, reference: 'OP-002', method: 'mercadopago', confirm: true }, 'POST', 201);
  sales = (await api('/api/state')).sales;
  assert.equal(sales.revenue, 200);
  assert.equal(sales.outstandingByCurrency.USD, 0);
  assert.equal(sales.unpaidAcceptedQuotes, 0);
  const detail = (await api(`/api/threads/${threadId}`)).thread;
  assert.equal(detail.quotes[0].payments.length, 2);
  assert.equal(detail.quotes[0].payments[0].verifiedByProvider, false);
  const js = await fs.readFile(path.join(root, 'public/app.js'), 'utf8');
  assert.match(js, /async function setQuoteStatusUI\(/, 'El botón Aceptada debe tener manejador');
  assert.match(js, /case 'save-payment'/, 'La interfaz debe guardar pagos');
  console.log('OK ventas: aceptación, cobros parciales, saldo, rechazo, idempotencia y UI.');
} finally {
  server.kill();
  await new Promise(resolve => { if (server.exitCode !== null) return resolve(); server.once('exit', resolve); setTimeout(resolve, 1500); });
  await fs.rm(dataDir, { recursive: true, force: true });
}
