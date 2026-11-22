/* Dominios de envío: validación, tope de 200/día por dominio, rotación
   equilibrada y espaciado por dominio en la cola automática. */
import {
  activeSendDomains, assertCanSend, chooseSendDomain, domainLimitInfo, domainStats,
  normalizeDomain, normalizeSendDomains, sendDomainStatus, validateSendDomains,
} from '../lib/email.mjs';
import { Outbox } from '../lib/outbox.mjs';

let passed = 0;
function ok(condition, label) {
  if (!condition) {
    console.error(`FALLO: ${label}`);
    process.exitCode = 1;
    throw new Error(label);
  }
  passed += 1;
  console.log(`OK ${label}`);
}

/* 1. Normalización estricta: nunca se envía desde un dominio inventado. */
ok(normalizeDomain('https://Ventas.MiMarca.com/ruta?x=1') === 'ventas.mimarca.com', 'normaliza dominio con esquema y ruta');
ok(normalizeDomain('  HOLA@LUCIAN.COM  ') === 'lucian.com', 'normaliza dominio con @ y mayúsculas');
ok(normalizeDomain('example') === '', 'rechaza dominio sin TLD');
ok(normalizeDomain('marca..com') === '', 'rechaza dominio con puntos dobles');

/* 2. Validación de la API: errores concretos, nunca silenciosos. */
const twoDomains = [
  { domain: 'lucian.com', from: 'Lucian <hola@lucian.com>', dailyLimit: 200 },
  { domain: 'ventas.lucian.com', from: 'Ventas <hola@ventas.lucian.com>', dailyLimit: 150 },
];
ok(validateSendDomains(twoDomains).ok, 'acepta dominios válidos');
ok(!validateSendDomains([{ domain: 'otro.com', from: 'Lucian <hola@lucian.com>' }]).ok, 'rechaza remitente de otro dominio');
ok(!validateSendDomains([{ domain: 'lucian.com', from: 'x@lucian.com' }, { domain: 'lucian.com', from: 'y@lucian.com' }]).ok, 'rechaza dominios repetidos');
ok(!validateSendDomains([{ domain: 'lucian.com', from: 'x@lucian.com', dailyLimit: 201 }]).ok, 'rechaza límite mayor a 200');
ok(!validateSendDomains('lucian.com').ok, 'rechaza un valor que no es lista');

/* 3. Compatibilidad: sin lista, se usa el remitente clásico con su límite. */
const legacy = normalizeSendDomains([], { email: { from: 'Lucian <hola@lucian.com>', dailyLimit: 20, warmup: true } });
ok(legacy.length === 1 && legacy[0].legacy, 'remitente único se convierte en dominio heredado');
ok(legacy[0].dailyLimit === 20 && legacy[0].warmup === true, 'el modo heredado conserva límite y calentamiento');
ok(normalizeSendDomains([], { email: {} }).length === 0, 'sin remitente no hay dominio de envío');

/* 4. Configuración nueva: tope 200, inválidos se descartan, sin duplicados. */
const normalized = normalizeSendDomains([
  ...twoDomains,
  { domain: 'mal.com', from: 'x@otro.com' },
  { domain: 'lucian.com', from: 'otro@lucian.com' },
  { domain: 'extra.lucian.com', from: 'x@extra.lucian.com', dailyLimit: 9999 },
], { email: {} });
ok(normalized.length === 3, 'descarta inválidos y repetidos');
ok(normalized.every((domain) => domain.dailyLimit <= 200), 'ningún dominio supera 200/día');
ok(normalized.at(-1).dailyLimit === 200, 'el límite se recorta a 200');

const settings = {
  email: {
    provider: 'webhook',
    webhookUrl: 'https://hook.test/send',
    autopilot: true,
    autopilotSpacingMin: 1,
    from: 'Lucian <hola@lucian.com>',
    dailyLimit: 20,
    warmup: false,
    sendDomains: twoDomains,
  },
};

/* 5. Contabilidad por dominio y límites individuales. */
const now = new Date().toISOString();
const threads = [
  {
    id: 't1', contact: { email: 'a@hotel.test' },
    messages: Array.from({ length: 200 }, () => ({ direction: 'out', status: 'enviado', at: now, sendDomain: 'lucian.com' })),
  },
  {
    id: 't2', contact: { email: 'b@hotel.test' },
    messages: [
      { direction: 'out', status: 'enviado', at: now, from: 'Ventas <hola@ventas.lucian.com>' },
      { direction: 'out', status: 'enviado', at: now, channel: 'manual', from: 'Lucian <hola@lucian.com>' },
    ],
  },
];
const stats = domainStats(threads, normalized);
ok(stats.get('lucian.com').count === 200, 'cuenta 200 envíos del primer dominio');
ok(stats.get('ventas.lucian.com').count === 1, 'cuenta el envío del segundo dominio por el From');
ok(domainLimitInfo(settings, threads, 'lucian.com').remaining === 0, 'el dominio agotado no tiene cupo');
ok(domainLimitInfo(settings, threads, 'ventas.lucian.com').remaining === 149, 'el otro dominio conserva su cupo');
const status = sendDomainStatus(settings, threads);
ok(status.capacity === 350 && status.used === 201 && status.remaining === 149, 'el resumen agrega capacidad, uso y cupo');

let blockedError = null;
try {
  assertCanSend(settings, threads, 'nuevo@hotel.test', [], { sendDomain: 'lucian.com' });
} catch (error) {
  blockedError = error;
}
ok(/límite de 200/.test(blockedError?.message || ''), 'assertCanSend bloquea el dominio agotado');
ok(assertCanSend(settings, threads, 'nuevo@hotel.test', [], { sendDomain: 'ventas.lucian.com' }).remaining === 149, 'assertCanSend permite el dominio con cupo');

/* 6. Rotación: equilibrio, exclusión por espaciado y determinismo. */
const emptyThreads = [];
const picks = ['a', 'b', 'c', 'd', 'e'].map((seed) => chooseSendDomain({ settings, threads: emptyThreads, seed })?.domain);
ok(new Set(picks).size >= 2, 'la rotación reparte entre dominios');
const withoutExhausted = { ...settings, email: { ...settings.email, sendDomains: twoDomains.map((d, i) => ({ ...d, dailyLimit: i === 0 ? 1 : 200 })) } };
const exhaustedThreads = [{
  id: 'tx', messages: [{ direction: 'out', status: 'enviado', at: now, sendDomain: 'lucian.com' }],
}];
ok(chooseSendDomain({ settings: withoutExhausted, threads: exhaustedThreads, seed: 'x' })?.domain === 'ventas.lucian.com', 'salta un dominio sin cupo');
ok(chooseSendDomain({ settings, threads: emptyThreads, seed: 'x', blocked: ['lucian.com'] })?.domain === 'ventas.lucian.com', 'respeta dominios en pausa por espaciado');
ok(activeSendDomains(settings).length === 2, 'solo se cuentan dominios activos');

/* 7. La cola aplica espaciado POR DOMINIO, no global. */
function fakeStore(settingsValue) {
  const data = {
    settings: settingsValue,
    outbox: [
      { id: 'out1', threadId: 't1', draftId: 'd1', status: 'pending', runAt: new Date(Date.now() - 60000).toISOString(), attempts: 0 },
      { id: 'out2', threadId: 't2', draftId: 'd2', status: 'pending', runAt: new Date(Date.now() - 60000).toISOString(), attempts: 0 },
    ],
    threads: [
      {
        id: 't1', stage: 'contactado', contact: { email: 'a@hotel.test', company: 'A' },
        drafts: [{ id: 'd1', status: 'listo', channel: 'email' }], messages: [],
      },
      {
        id: 't2', stage: 'contactado', contact: { email: 'b@hotel.test', company: 'B' },
        drafts: [{ id: 'd2', status: 'listo', channel: 'email' }], messages: [],
      },
    ],
    suppressions: [],
    meta: {},
    activity: [],
  };
  return {
    data,
    settings: () => data.settings,
    get: (key) => data[key],
    set: async (key, value) => { data[key] = value; },
    setMeta: async (patch) => { data.meta = { ...data.meta, ...patch }; },
    setDebounced: async () => {},
    activity: async (...args) => { data.activity.push(args); },
    find: () => null,
  };
}

const store = fakeStore(settings);
const sent = [];
const outbox = new Outbox({
  store,
  deliver: async ({ threadId, sendDomain }) => {
    sent.push({ threadId, sendDomain });
    return { ok: true };
  },
});
const processed = await outbox.processQueue(settings);
ok(processed === 2, 'la cola procesó los dos vencidos');
ok(sent.length === 2, 'se entregaron los dos mensajes');
ok(new Set(sent.map((entry) => entry.sendDomain)).size === 2, 'cada mensaje salió por un dominio distinto');
ok(Object.keys(store.data.meta.lastSendByDomain || {}).length === 2, 'se registró el último envío por dominio');
ok(store.data.outbox.every((item) => item.status === 'sent'), 'ambos elementos quedan marcados como enviados');

console.log(`\nDominios de envío: ${passed} comprobaciones OK`);
