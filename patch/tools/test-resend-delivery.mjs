import assert from 'node:assert/strict';
import { obtainResendDeliveryReport, applyResendDeliveryReport, classifyResendEvent } from '../lib/resend-delivery.mjs';
import { auditOutreach } from '../lib/outreach-audit.mjs';

const threads = [
  {id:'t1', contact:{email:'buyer1@test.invalid'}, messages:[
    {id:'m1',direction:'out',provider:'resend',channel:'resend',providerId:'abcdef12-1234-1234-1234-abcdef123456',at:'2026-11-15T00:00:00Z'},
    {id:'m2',direction:'out',provider:'resend',channel:'resend',providerId:'abcdef12-1234-1234-1234-abcdef123457',at:'2026-11-15T00:00:00Z'},
  ]},
  {id:'t2', contact:{email:'buyer2@test.invalid'}, messages:[{id:'m3',direction:'out',provider:'resend',providerId:'abcdef12-1234-1234-1234-abcdef123458',at:'2026-11-15T00:00:00Z'}]},
  {id:'demo', demo:true,messages:[{direction:'out',provider:'resend',providerId:'abcdef12-1234-1234-1234-abcdef123459'}]},
];
let calls=0;
const fetcher=async (url,opts)=>{
  calls++;
  assert.equal(opts.method,'GET','no se debe enviar');
  assert.ok(opts.headers.authorization.startsWith('Bearer re_test'));
  assert.ok(!url.includes('re_test'));
  const page=Number(new URL(url).searchParams.has('after'));
  return {ok:true,json:async()=>({data:page ? [
    {id:'abcdef12-1234-1234-1234-abcdef123458',last_event:'suppressed'},
  ] : [
    {id:'abcdef12-1234-1234-1234-abcdef123456',last_event:'delivered'},
    {id:'abcdef12-1234-1234-1234-abcdef123457',last_event:'bounced'},
  ],has_more:!page})};
};
const report=await obtainResendDeliveryReport({threads,apiKey:'re_test',fetcher});
assert.equal(calls,2);
assert.equal(report.counts.found,3);
assert.equal(report.counts.delivered,1);
assert.equal(report.counts.bounced,1);
assert.equal(report.counts.suppressed,1);
assert.equal(report.complete,true);
assert.equal(applyResendDeliveryReport(threads,report,'2026-11-21T00:00:00Z'),3);
assert.equal(applyResendDeliveryReport(threads,report,'2026-11-21T00:00:00Z'),0,'idempotencia');
assert.equal(threads[0].messages[0].deliveryStatus,'delivered');
assert.equal(threads[1].messages[0].deliveryStatus,'suppressed');
assert.equal(threads[2].messages[0].deliveryStatus,undefined);
const audit=auditOutreach({threads,now:Date.parse('2026-11-21T00:00:00Z')});
assert.equal(audit.counts.providerFailedDelivery,2);
assert.equal(audit.counts.deliveryUnknown,0);
assert.equal(audit.counts.deliveryConfirmed,1);
assert.equal(classifyResendEvent('opened'),'delivered');
assert.equal(classifyResendEvent('not_known'),'unknown');
await assert.rejects(obtainResendDeliveryReport({threads,apiKey:'re_test',fetcher:async()=>({ok:false,status:403})}),/permisos/);
assert.ok(!JSON.stringify(report).includes('re_test'),'nunca devolver clave');
const partial=await obtainResendDeliveryReport({threads,apiKey:'re_test',fetcher:async()=>({ok:true,json:async()=>({data:[{id:'abcdef12-1234-1234-1234-abcdef123456',last_event:'sent'}],has_more:false})})});
assert.equal(partial.counts.notFound,2);
assert.equal(partial.counts.found,1);
console.log('OK: Resend GET, páginas, evidencias, rebotes, idempotencia, no envío, redacción y respuestas parciales.');
