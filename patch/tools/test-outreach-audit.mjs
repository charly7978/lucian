import assert from 'node:assert/strict';
import { auditOutreach } from '../lib/outreach-audit.mjs';
const now = Date.parse('2026-11-21T10:00:00Z');
const optIn = {permission:{status:'opted_in', evidence:'Formulario de contacto voluntario',capturedAt:'2026-11-01T00:00:00Z'}};
const thread = (id, overrides = {}) => ({ id, demo:false, stage:'contactado', contact:{ email:`${id}@example.org`, company:id, ...optIn }, messages:[],quotes:[], ...overrides });
const old = '2026-11-05T10:00:00Z';
const sent = (at=old) => ({direction:'out',channel:'resend',provider:'resend',status:'enviado',at,subject:'Lampara'});
const input = {
  now,
  threads:[
    thread('a',{messages:[sent(),sent()],stage:'contactado'}),
    thread('b',{messages:[sent(), {direction:'in',at:'2026-11-06T10:00:00Z'}],stage:'respondio'}),
    thread('c',{messages:[sent()],optOut:{at:'2026-11-08T10:00:00Z'}}),
    thread('d',{messages:[{...sent(), status:'enviado_manual',provider:'manual',channel:'whatsapp'}],contact:{ email:'d@example.org' }}),
    thread('e',{messages:[], stage:'interesado'}),
    thread('fake',{demo:true,messages:[sent(),{direction:'in'}]}),
  ],
  outbox:[{status:'error'},{status:'pending'}],
};
const r = auditOutreach(input);
assert.equal(r.counts.contacts,5);
assert.equal(r.counts.contacted,4);
assert.equal(r.counts.replied,1);
assert.equal(r.responseRatePercent,25);
assert.equal(r.counts.outboundMessages,5);
assert.equal(r.counts.providerAccepted,4);
assert.equal(r.counts.deliveryConfirmed,0);
assert.equal(r.counts.deliveryUnknown,4);
assert.equal(r.counts.blocked,1);
assert.equal(r.counts.noReply,3);
assert.equal(r.counts.noReplySevenDays,3);
assert.equal(r.counts.failedQueueItems,1);
assert.equal(r.counts.pendingQueueItems,1);
assert.ok(r.priorities.some(x=>x.threadId==='b'&&x.kind==='respuesta'));
assert.ok(!r.priorities.some(x=>x.threadId==='c'));
assert.ok(!r.priorities.some(x=>x.threadId==='d'));
assert.ok(r.unanswered.some(x=>x.threadId==='c' && x.status==='no-contactar'));
assert.ok(r.unanswered.some(x=>x.threadId==='d' && x.status==='revisar-permiso'));
assert.ok(r.methodology.includes('Aceptada') || r.methodology.includes('aceptada'));
const empty=auditOutreach({threads:[]});
assert.equal(empty.responseRatePercent,null);
assert.equal(empty.counts.contacted,0);
const noMutation=JSON.stringify(input);
auditOutreach(input);
assert.equal(JSON.stringify(input),noMutation);
console.log('OK: indicadores de respuestas reales, entrega no demostrada, contactos sin contestar, bloqueos y sin mutación.');
