import assert from 'node:assert/strict';
import { parseUidSearchResponse } from '../lib/imap.mjs';
import { testResend } from '../lib/email.mjs';
import { testTelegram } from '../lib/notify.mjs';
import { diagnoseConnections, testConnection, redactDiagnosticError } from '../lib/connections.mjs';

assert.deepEqual(parseUidSearchResponse(['* SEARCH 12 13 14', 'A3 OK SEARCH completed']), [12,13,14]);
assert.deepEqual(parseUidSearchResponse(['* SEARCH', 'A3 OK SEARCH completed']), []);
assert.deepEqual(parseUidSearchResponse(['* SEARCH 15 15 17', '* 1 EXISTS']), [15,17]);

const oldFetch = globalThis.fetch;
const calls = [];
try {
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({url:String(url),method:opts.method || 'GET'});
    if (String(url).includes('/domains')) return new Response(JSON.stringify({ data: [
      { name:'lucian.test',status:'pending' },{ name:'verificado.test',status:'verified' } ] }), {status:200,headers:{'content-type':'application/json'}});
    if (String(url).includes('/getMe')) return new Response(JSON.stringify({ok:true,result:{username:'lucian_test_bot',first_name:'Lucian'}}),{status:200,headers:{'content-type':'application/json'}});
    throw new Error('Una prueba de conexión intentó usar un endpoint de envío: ' + url);
  };
  const base = { ai: {provider:'openai',apiKey:'sk-PRIVADO-1234567890',model:'gpt-4.1-mini'},
    search:{provider:'none'},email:{provider:'resend',resendKey:'re_PRUEBA_SECRETA_12345',from:'Lucian <ventas@lucian.test>'},
    notify:{telegram:{enabled:true,token:'111:BOT_SECRETO',chatId:'333'},whatsapp:{enabled:false}},
    hunter:{enabled:false},fallback:{enabled:false} };
  let state = await diagnoseConnections(base);
  assert.equal(state.connections.find(c=>c.id==='email').status,'configurado');
  assert.equal(state.connections.find(c=>c.id==='email').ok,false);
  assert.equal(state.connections.find(c=>c.id==='search').status,'pendiente');
  let r=await testResend(base);
  assert.equal(r.senderReady,false);
  assert.equal(r.fromDomainStatus,'pending');
  const bad = await testConnection('email',base);
  assert.equal(bad.ok,false);
  assert.ok(bad.detail.includes('pending'));
  state=await diagnoseConnections(base);
  assert.equal(state.connections.find(c=>c.id==='email').status,'error');
  const verified={...base,email:{...base.email,from:'Lucian <ventas@verificado.test>'}};
  r=await testConnection('email',verified);
  assert.equal(r.ok,true);
  state=await diagnoseConnections(verified);
  assert.equal(state.connections.find(c=>c.id==='email').status,'verificado');
  assert.equal(state.connections.find(c=>c.id==='email').ok,true);
  // A change of sender invalidates previous verification, without touching data or mail.
  state=await diagnoseConnections({...verified,email:{...verified.email,from:'otro@verificado.test'}});
  assert.equal(state.connections.find(c=>c.id==='email').status,'configurado');
  const tg=await testConnection('telegram',base);
  assert.equal(tg.ok,true);
  assert.match(tg.detail,/NO se envió mensaje/);
  assert.ok(calls.some(c=>c.url.endsWith('/getMe')));
  assert.ok(!calls.some(c=>/sendMessage|sendPhoto|sendDocument/.test(c.url)));
  assert.ok(!calls.some(c=>c.method !== 'GET'));
  assert.equal((await testConnection('nonexistent',base)).ok,false);
  assert.ok(!redactDiagnosticError(new Error('Error https://api.telegram.org/bot111:BOT_SECRETO/getMe and key re_PRUEBA_SECRETA_12345'),base).includes('BOT_SECRETO'));
  assert.ok(!redactDiagnosticError(new Error('Error https://api.telegram.org/bot111:BOT_SECRETO/getMe and key re_PRUEBA_SECRETA_12345'),base).includes('re_PRUEBA_SECRETA_12345'));
  console.log('OK API diagnostics: estado config/verificado, Resend pendiente, cambio de remitente, Telegram sin mensajes, UID SEARCH, secretos ocultos');
} finally { globalThis.fetch=oldFetch; }
