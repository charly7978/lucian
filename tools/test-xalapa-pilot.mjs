import assert from 'node:assert/strict';
import { parseRawEmail } from '../lib/imap.mjs';
import { allowsXalapaAutoMail, classifyXalapaInquiry, makeXalapaReply, repliesToThread, xalapaSalesSummary } from '../lib/xalapa-pilot.mjs';
import { syncGalapaOrders } from '../lib/galapa-orders.mjs';
import { Notifier } from '../lib/notify.mjs';

const email = 'compras@tienda.test';
const products = [
  { id: 'l-1', name: 'AWASA - Velador', status: 'listo', price: 20, code: 'AW-01', storefront: { url: 'https://galapa.com.ar/productos/awasa/', available: true } },
  { id: 'l-2', name: 'AWASA - Pie', status: 'listo', price: 30, code: 'AW-02', storefront: { url: 'https://galapa.com.ar/productos/awasa-pie/', available: true } },
];
const reference = 'offer@galapa.com.ar';
const thread = { contact: { email }, productId: 'l-1', stage: 'contactado', messages: [{ direction: 'out', messageId: '<'+reference+'>' }] };
const raw = [
  'From: Compras <'+email+'>', 'To: ventas@galapa.com.ar', 'Subject: Consulta',
  'Message-ID: <request@tienda.test>', 'In-Reply-To: <'+reference+'>',
  'Authentication-Results: mx.google.com; dmarc=pass (p=NONE) header.from=tienda.test',
].join('\r\n');
const inbound = parseRawEmail(raw+'\r\n\r\nSí, quiero comprar AWASA - Velador.');
const classify = (input, t = thread) => classifyXalapaInquiry({ thread: t, inbound: input, email, products });
assert.equal(inbound.replyAllowed, true);
assert.equal(repliesToThread(thread, inbound), true);
assert.equal(classify(inbound).link, products[0].storefront.url);
assert.equal(classify({ ...inbound, text: 'Sí, me interesa' }).link, products[0].storefront.url);
assert.equal(classify({ ...inbound, text: 'Quiero comprar AWASA' }).kind, 'model');
assert.equal(classify({ ...inbound, text: 'Cotización para 20 unidades de AWASA - Pie' }).quantity, 20);
assert.equal(classify({ ...inbound, text: 'No necesito cotización de AWASA - Pie' }), null);
assert.equal(classify({ ...inbound, text: 'Gracias\n> Quiero comprar AWASA - Velador' }), null);
assert.equal(classify(parseRawEmail(raw.replace('dmarc=pass', 'dmarc=fail')+'\r\n\r\nQuiero comprar AWASA - Pie')), null);
assert.equal(classify(parseRawEmail(raw+'\r\nAuto-Submitted: auto-replied\r\n\r\nQuiero comprar AWASA - Pie')), null);
assert.equal(classify({ ...inbound, text: 'Quiero comprar una lámpara' }, { ...thread, messages: [] }), null);
assert.equal(classify({ ...inbound, text: 'Quiero comprar https://galapa.com.ar/productos/awasa-pie/' }).product.id, 'l-2');
const msg = { id:'i-1', subject:'Consulta', direction:'in', xalapaRequest:true };
thread.messages.push(msg);
const draft = makeXalapaReply({ inquiry: classify(inbound), inbound, message: msg, email });
assert.match(draft.body, /https:\/\/galapa\.com\.ar\/productos\/awasa\//);
assert.equal(allowsXalapaAutoMail(thread, draft, products), true);
assert.equal(allowsXalapaAutoMail(thread, draft, []), false);
assert.equal(allowsXalapaAutoMail({ ...thread, contact:{ email:'otro@tienda.test' } }, draft, products), false);
assert.equal(allowsXalapaAutoMail({ ...thread, messages:[...thread.messages, { id:'i-2',direction:'in',xalapaRecipientVerified:true }] }, draft, products), false);
assert.equal(allowsXalapaAutoMail({ ...thread, messages:[...thread.messages, { id:'i-2',direction:'in' }] }, draft, products), true);
const cold = { ...draft, source:'propuesta Xalapa', xalapaAuto:{kind:'outreach',recipient:email,productId:'l-1'} };
assert.equal(allowsXalapaAutoMail({ ...thread, messages:[] }, cold, products), false);
const authorized = { ...thread, messages:[], contact:{email,permission:{status:'opted_in', evidence:'Formulario del comprador', capturedAt:new Date().toISOString()}} };
assert.equal(allowsXalapaAutoMail(authorized,cold,products),true);
assert.equal(xalapaSalesSummary([{ ...thread, messages:[{status:'enviado',direction:'out',xalapaKind:'checkout'}] }]).checkout,0);

const now = Date.parse('2026-11-26T12:00:00Z');
const checked = new Date(now).toISOString();
const config = { storeId:'123', token:'test' };
const shop = { id:123, domains:['galapa.com.ar'] };
const order = { id:1, number:10, status:'closed', payment_status:'paid', created_at:checked, paid_at:checked, products:[{name:'Awasa - Velador'}] };
const fetcher = async (url, opts) => {
  assert.equal(opts.headers.Authentication,'bearer test');
  return Response.json(url.endsWith('/store') ? shop : [order,{...order,id:2,products:[{name:'Otro producto'}]}]);
};
const options={config,products,fetcher,now};
const result = await syncGalapaOrders(options);
assert.equal(result.orders.length,1);
assert.equal(result.orders[0].payment,'paid');
const refunded = await syncGalapaOrders({...options,previous:result.orders,checkedAt:checked,fetcher:async url => Response.json(url.endsWith('/store') ? shop : [{...order,payment_status:'refunded'}])});
assert.equal(refunded.orders[0].payment,'refunded');
await assert.rejects(syncGalapaOrders({...options,fetcher:async () => Response.json({...shop,domains:['otra.test']})}),/galapa.com.ar/);

let hunt = '';
const meta = { telegramSessions: {} };
const notifier = new Notifier({ store: {
  settings: () => ({sales:{xalapaAuto:true},notify:{telegram:{chatId:'owner'}}}),
  get: (key) => meta[key],
  set: async (key,value) => {meta[key]=value;},
}, actions: {startXalapaSearch: async (target) => {hunt=target;},xalapaStatusText: () => 'Enlaces y pedidos registrados'} });
assert.match(await notifier.handleOwnerText('/cazar hoteles','telegram','owner'),/en marcha/);
assert.equal(hunt,'hoteles');
assert.equal(await notifier.handleOwnerText('/ventas','telegram','owner'),'Enlaces y pedidos registrados');
assert.equal(await notifier.handleOwnerText('/cazar','telegram','otro'),'');
assert.equal(hunt,'hoteles');
console.log('OK: confianza Gmail, modelo correcto, guardas de envío, pedidos pagados/reembolsados y comandos de Telegram.');
