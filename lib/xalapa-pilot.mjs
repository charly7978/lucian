import { galapaProductUrl, GALAPA_CATALOG_URL } from './galapa-catalog.mjs';
import { xalapaProducts } from './xalapa-sales.mjs';
import { normalizeText } from './hunter.mjs';
import { normalizeEmail } from './email.mjs';
import { hasDocumentedOptIn } from './security.mjs';
import { nowISO, truncate, uid } from './util.mjs';

export const XALAPA_REPLY_SOURCE = 'respuesta Xalapa';
export const XALAPA_OUTREACH_SOURCE = 'propuesta Xalapa';

export function mailReference(id) {
  return String(id || '').trim().replace(/^<|>$/g, '');
}

export function repliesToThread(thread, inbound) {
  const refs = new Set([inbound.inReplyTo, ...(Array.isArray(inbound.references) ? inbound.references : [])].map(mailReference).filter(Boolean));
  return refs.size > 0 && (thread.messages || []).some((m) => m.direction === 'out' && refs.has(mailReference(m.messageId)));
}

function originalReply(body) {
  return String(body || '').split(/\n(?:>+|\s*On .+wrote:|\s*El .+escribi[oó]:|\s*De: .+@|\s*[-_]{3,}\s*(?:forwarded|mensaje original|mensaje reenviado)|--\s*$)/im)[0].slice(0, 2500).trim();
}

const BUY_REQUEST = /\b(?:quiero|quisiera|deseo|vamos a|queremos|me interesa|necesito|necesitamos) (?:comprar|pedir|encargar|hacer (?:el|un) pedido|pagar)\b|\b(?:como|donde) (?:puedo |podemos )?(?:comprar|compro|hacer el pedido|pagar|pago)\b|\b(?:link|enlace) (?:de |para )?(?:compra|pago|comprar|pagar)\b/;
const BULK_REQUEST = /\b(?:cotiz\w*|presupuest\w*|precio mayorista|precios mayoristas|pedido por cantidad)\b/;
const STOP_REQUEST = /\b(?:no (?:me |nos )?(?:interesa|interesan|quiero|queremos|necesito|necesitamos|envies|envien|cotices)|cancel(?:ar|en|alo)|ya (?:compre|compramos|pague)|sin interes|baja|unsubscribe|reembolso|estado de (?:mi|nuestro) pedido)\b/;

function namedProducts(text, raw, products) {
  const explicitLinks = new Set([...raw.matchAll(/https:\/\/galapa\.com\.ar\/productos\/[a-z0-9-]+\/?/gi)]
    .map(([url]) => galapaProductUrl(url)).filter(Boolean));
  if (explicitLinks.size) return products.filter((p) => explicitLinks.has(galapaProductUrl(p.storefront?.url)));
  const words = ` ${text} `;
  const mentions = (value) => value.length >= 4 && words.includes(` ${value} `);
  const precise = products.filter((p) => mentions(normalizeText(p.name)) || mentions(normalizeText(p.code)));
  return precise.length ? precise : products.filter((p) => mentions(normalizeText(String(p.name || '').split(/\s+-\s+/)[0])));
}

export function classifyXalapaInquiry({ thread, inbound, products, email }) {
  if (!inbound.replyAllowed || !inbound.messageId && !inbound.sourceId || thread.demo || thread.optOut
    || normalizeEmail(email) !== normalizeEmail(thread.contact?.email) || ['perdido', 'ganado'].includes(thread.stage)) return null;
  const raw = originalReply(inbound.text);
  const text = normalizeText(raw);
  if (!text || STOP_REQUEST.test(text)) return null;

  const matches = namedProducts(text, raw, products);
  const recent = (thread.drafts || []).find((d) => d.xalapaAuto?.kind === 'model'
    && d.xalapaAuto.state === 'sent' && Date.now() - Date.parse(d.sentAt || d.createdAt) < 7 * 86400000);
  const purchase = BUY_REQUEST.test(text) || (matches.length === 1 && /\b(?:quiero|queremos|necesito|necesitamos) \d{1,5}\b/.test(text));
  const interest = matches.length === 1 && /\b(?:me interesa|nos interesa|ten[eé]s disponible|tienen disponible|precio de)\b/.test(text);
  const quote = BULK_REQUEST.test(text);
  const knownReply = repliesToThread(thread, inbound);
  const shortInterest = knownReply && /^(?:si )?(?:me|nos) interesa$/.test(text);
  const brand = /\b(?:xalapa|galapa)\b/.test(text);
  if (!purchase && !interest && !shortInterest && !quote && !(recent && matches.length === 1 && text.length < 180)) return null;
  if (!matches.length && !knownReply && !brand && !recent) return null;

  const product = matches.length === 1 ? matches[0]
    : !matches.length && knownReply ? products.find((p) => p.id === thread.productId) : null;
  const available = product && xalapaProducts([product]).length > 0;
  const quantity = text.match(/\b(\d{1,5})\s+(?:unidades?|l[aá]mparas?|veladores?|piezas?)\b/)?.[1];
  const kind = quote ? 'quote' : available ? 'checkout' : 'model';
  const link = available ? galapaProductUrl(product.storefront.url) : GALAPA_CATALOG_URL;
  return { kind, link, product: available ? product : null, quantity: quantity ? Number(quantity) : null };
}

export function makeXalapaReply({ inquiry, inbound, message, email }) {
  const { kind, link, product, quantity } = inquiry;
  const body = kind === 'checkout'
    ? `Hola. Acá tenés la ficha de ${product.name} de Xalapa para comprar en GALAPA:\n${link}\n\nEn la tienda podés elegir la variante, la cantidad y ver la disponibilidad, el costo de envío y los medios de pago.\n\nSaludos,\nXalapa`
    : kind === 'quote'
      ? `Hola. Recibimos tu solicitud de cotización${product ? ` por ${product.name}` : ''}${quantity ? ` para ${quantity} unidades` : ''}. ${quantity ? '¿Nos indicás la localidad y el código postal de entrega?' : '¿Nos indicás la cantidad y el código postal de entrega?'}${product ? `\n\nSi preferís comprar al precio publicado, en GALAPA podés consultar la disponibilidad y elegir la cantidad: ${link}` : ''}\n\nSaludos,\nXalapa`
      : `Hola. ¿Qué lámpara de Xalapa querés comprar? Respondeme con el nombre o el enlace de la ficha para ubicar el modelo disponible. Podés ver la colección acá:\n${link}\n\nSaludos,\nXalapa`;
  return {
    id: uid('drf'), subject: truncate(message.subject, 250), body,
    language: 'es', channel: 'email', source: XALAPA_REPLY_SOURCE, status: 'listo', guardVersion: 2,
    createdAt: nowISO(), xalapaAuto: {
      state: 'queued', kind, recipient: normalizeEmail(email), inboundId: message.id,
      originKey: mailReference(inbound.messageId) || inbound.sourceId,
      productId: product?.id || null, url: link, quantity,
    },
  };
}

export function allowsXalapaAutoMail(thread, draft, products) {
  const job = draft.xalapaAuto;
  if (!job || normalizeEmail(thread.contact?.email) !== job.recipient || thread.demo || thread.optOut
    || ['perdido', 'ganado'].includes(thread.stage)) return false;
  if (job.kind === 'outreach') return hasDocumentedOptIn(thread.contact) && draft.source === XALAPA_OUTREACH_SOURCE
    && xalapaProducts(products).some((p) => p.id === job.productId && draft.body.includes(galapaProductUrl(p.storefront.url)))
    && !(thread.messages || []).length;
  const inbound = (thread.messages || []).findLast((msg) => msg.direction === 'in' && (msg.xalapaRecipientVerified || msg.xalapaRequest));
  if (inbound?.id !== job.inboundId) return false;
  if (!inbound || inbound.direction !== 'in' || inbound.xalapaRequest !== true || draft.source !== XALAPA_REPLY_SOURCE) return false;
  if (!job.productId) return ['model', 'quote'].includes(job.kind) && job.url === GALAPA_CATALOG_URL;
  const product = xalapaProducts(products).find((p) => p.id === job.productId);
  return Boolean(product && galapaProductUrl(product.storefront.url) === job.url);
}

export function xalapaSalesSummary(threads, meta = {}) {
  const actual = threads.filter((t) => !t.demo);
  const sent = actual.flatMap((thread) => (thread.messages || []).filter((m) =>
    m.direction === 'out' && m.status === 'enviado' && m.providerId && m.xalapaKind && !m.deliveryNote
    && !['bounced', 'suppressed', 'complained', 'failed'].includes(m.deliveryStatus)));
  return {
    prospects: new Set(Object.values(meta.xalapaProspects || {}).flatMap((r) => (r.prospects || []).map((p) => p.id))).size,
    sent: sent.filter((m) => m.xalapaKind === 'outreach').length,
    checkout: sent.filter((m) => m.xalapaKind === 'checkout').length,
    quotes: actual.filter((t) => t.xalapaRequest?.kind === 'quote' && !['ganado', 'perdido'].includes(t.stage)).length,
    waiting: actual.reduce((sum, t) => sum + (t.drafts || []).filter((d) => ['queued', 'sending'].includes(d.xalapaAuto?.state)).length, 0),
    review: actual.filter((t) => (t.drafts || []).some((d) => d.xalapaAuto?.state === 'review')).length,
    paid: (meta.xalapaOrders || []).filter((order) => order.payment === 'paid').length,
    storeSync: meta.xalapaStoreSync || null,
  };
}
