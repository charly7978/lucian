import crypto from 'node:crypto';
import { fetchJson, localDayKey } from './util.mjs';
import { sendWithGmailSmtp } from './smtp.mjs';

/* ─────────────────────────────────────────────────────────────
   Correo: composición, .eml, Resend y webhook.
   El envío nunca es automático. Siempre lo confirma el dueño.
   ───────────────────────────────────────────────────────────── */

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(String(email || '').trim());
}

export function hasConfiguredEmailProvider(settings) {
  const email = settings?.email;
  return (email?.provider === 'resend' && Boolean(String(email.resendKey || '').trim()))
    || (email?.provider === 'webhook' && Boolean(String(email.webhookUrl || '').trim()))
    || (email?.provider === 'gmail' && isValidEmail(email.smtpUser) && Boolean(String(email.smtpPassword || '').trim()));
}

export function isDemoEmail(email) {
  const domain = String(email || '').split('@')[1]?.toLowerCase() || '';
  return domain === 'example.com' || domain === 'example.org' || domain === 'example.net' || domain.endsWith('.example.com');
}

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function emailDomain(email) {
  const clean = normalizeEmail(email);
  return clean.includes('@') ? clean.split('@').pop() : '';
}

/* Dominios donde varias empresas comparten el mismo dominio.
   No sirven para deduplicar por dominio. */
const SHARED_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'outlook.com', 'live.com', 'yahoo.com',
  'icloud.com', 'me.com', 'proton.me', 'protonmail.com', 'aol.com', 'gmx.com',
  'example.com', 'example.org', 'example.net',
]);

export function isSharedEmailDomain(domain) {
  return SHARED_EMAIL_DOMAINS.has(String(domain || '').toLowerCase());
}

/* ─────────────────────────────────────────────────────────────
   Detección de baja (opt-out) en respuestas.
   Regla de oro: ante la duda, NO suprimir. Un falso positivo pierde
   un lead real y es más caro que pedir una confirmación humana.
   Por eso se ignora todo el texto citado (el pie de nuestros propios
   correos incluye "respondé BAJA" y no debe disparar la baja).
   ───────────────────────────────────────────────────────────── */

const QUOTE_SEPARATORS = [
  /^\s*el\s+.+\s+escribi[oó]:\s*$/i,
  /^\s*la\s+.+\s+escribi[oó]:\s*$/i,
  /^\s*on\s+.+\s+wrote:\s*$/i,
  /^\s*le\s+.+\s+a\s+[ée]crit\s*:\s*$/i,
  /^\s*-{2,}\s*(original message|mensaje original|forwarded message|mensaje reenviado)\s*-{2,}\s*$/i,
  /^\s*_{8,}\s*$/,
  /^\s*-{8,}\s*$/,
  /^\s*_{5,}\s*$/,
];

function isQuoteHeaderStart(line) {
  return QUOTE_SEPARATORS.some((pattern) => pattern.test(line));
}

function looksLikeOutlookHeaders(lines, index) {
  if (!/^\s*(de|from):\s+/i.test(lines[index] || '')) return false;
  const window = lines.slice(index + 1, index + 6).join('\n');
  return /(enviado|sent|fecha|date):\s+/i.test(window)
    || /(para|to):\s+/i.test(window);
}

/* Devuelve solo el texto nuevo de una respuesta: sin citas ">",
   sin cabeceras de reenvío/respuesta y sin nuestro pie de baja. */
export function stripQuotedText(text) {
  let body = String(text || '').replace(/\r\n?/g, '\n');
  // Webhooks de correo a veces entregan solo HTML: el bloque citado suele
  // venir en <blockquote> o en un div de Gmail. Se descarta antes de buscar.
  if (/<\/?(?:blockquote|div|p|br|html|body)\b/i.test(body)) {
    body = body
      .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, '\n')
      .replace(/<div[^>]*(?:gmail_quote|moz-cite-prefix|yahoo_quoted)[\s\S]*?<\/div>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|div|li|tr|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&gt;/gi, '>')
      .replace(/&lt;/gi, '<')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'");
  }
  // El pie que agrega ensureCompliance no es una petición del comprador.
  body = body.replace(/^\s*si prefer[ií]s no recibir m[aá]s mensajes[^\n]*$/gim, '');
  const lines = body.split('\n');
  const kept = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*>/.test(line)) continue;
    if (isQuoteHeaderStart(line)) break;
    if (looksLikeOutlookHeaders(lines, index)) break;
    kept.push(line);
  }
  return kept.join('\n').trim();
}

const OPT_OUT_PATTERNS = [
  { rule: 'dar de baja', pattern: /\b(?:dar(?:me|nos)?|darme|denme|den|dense|pongan(?:me)?|ponerme)\s+de\s+baja\b/ },
  { rule: 'baja de la lista', pattern: /\b(?:baja|bajarme|bajenme|bajarse)\s+(?:del?|de\s+la|de\s+este|de\s+su)\s+(?:lista|listado|base|correo|mailing|comunicaciones)\b/ },
  { rule: 'no me escriban más', pattern: /\bno\s+(?:me\s+)?(?:escrib|contact|mand|envi)(?:as|an|es|en|e|a)\s+(?:m[aá]s|nunca|nuevamente)\b/ },
  { rule: 'no quiero recibir más', pattern: /\bno\s+(?:quiero|deseo)\s+(?:recibir|que\s+me\s+(?:escriban|contacten))\s+(?:m[aá]s|nuevamente|nunca)\b/ },
  { rule: 'no volver a escribir', pattern: /\bno\s+volver\s+a\s+(?:escribir|contactar|molestar)\b/ },
  { rule: 'dejen de escribir', pattern: /\bdejen\s+de\s+(?:escribir|contactar|enviar|mandar)\b/ },
  { rule: 'unsubscribe', pattern: /\b(?:unsubscribe|remove\s+me|stop\s+emailing|opt[\s-]?out|do\s+not\s+contact)\b/ },
  { rule: 'do not email', pattern: /\b(?:do\s+not|don't)\s+(?:email|contact|write)\b/ },
  { rule: 'stop sending', pattern: /\b(?:stop|cease)\s+(?:emailing|contacting|sending)\b/ },
  { rule: 'take me off', pattern: /\btake\s+me\s+off\b/ },
];

function normalizeForOptOut(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/* Devuelve null si no hay baja, o { phrase, rule } si la hay. */
export function detectOptOut(text) {
  const stripped = stripQuotedText(text);
  if (!stripped) return null;
  const lines = stripped.split('\n').map(normalizeForOptOut).filter(Boolean);
  const compact = normalizeForOptOut(stripped);
  const whole = /^(baja|bajarme|bajenme|baja por favor|desuscribirme|unsubscribe|opt out|opt-out|remove me|stop|stop emailing|do not contact|no contactar|no me contacten)$/;
  for (const line of lines) {
    const candidate = line.replace(/[.,;!¿?]+$/g, '').trim();
    if (whole.test(candidate)) return { phrase: candidate, rule: 'mensaje de baja' };
  }
  if (whole.test(compact.replace(/[.,;!¿?]+$/g, '').trim())) {
    return { phrase: compact, rule: 'mensaje de baja' };
  }
  for (const { rule, pattern } of OPT_OUT_PATTERNS) {
    const match = compact.match(pattern);
    if (match) return { phrase: match[0].trim(), rule };
  }
  return null;
}

export function isOptOutText(text) {
  return Boolean(detectOptOut(text));
}

export function normalizeCompany(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

/* Una supresión puede ser por email exacto, por dominio explícito o por empresa.
   Los dominios compartidos (Gmail, Outlook...) nunca se usan para bloquear
   por dominio: bloquearían a miles de personas ajenas. */
export function findSuppression(email, suppressions = [], company = '') {
  const target = normalizeEmail(email);
  const companyKey = normalizeCompany(company);
  const domain = emailDomain(target);
  return (suppressions || []).find((item) => {
    if (!item || typeof item !== 'object') return false;
    const itemEmail = normalizeEmail(item.email);
    if (target && itemEmail && itemEmail === target) return true;
    const itemDomain = String(item.domain || '').toLowerCase();
    if (domain && itemDomain && !isSharedEmailDomain(itemDomain) && itemDomain === domain) return true;
    if (companyKey && normalizeCompany(item.company) === companyKey) return true;
    return false;
  }) || null;
}

export function isSuppressed(email, suppressions = [], company = '') {
  return Boolean(findSuppression(email, suppressions, company));
}

function sanitizeHeader(value) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
}

function encodeHeader(value) {
  const clean = sanitizeHeader(value);
  if (!/[^\x20-\x7E]/.test(clean)) return clean;
  return `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`;
}

function splitFrom(from) {
  const match = String(from || '').match(/^(.*)<([^>]+)>$/);
  if (match) return { name: match[1].trim().replace(/^"|"$/g, ''), email: match[2].trim() };
  return { name: '', email: String(from || '').trim() };
}

function formatAddress(name, email) {
  const cleanName = sanitizeHeader(name);
  if (!cleanName) return email;
  return `"${encodeHeader(cleanName)}" <${email}>`;
}

export function htmlFromText(text, { accent = '#b8632f' } = {}) {
  const escaped = String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const linked = escaped.replace(/(https?:\/\/[^\s<]+)/g, (url) => {
    const clean = url.replace(/[.,;:)]+$/, '');
    return `<a href="${clean}" style="color:${accent};text-decoration:underline">${clean}</a>`;
  });

  const paragraphs = linked.split(/\n{2,}/).map((block) => {
    const withBreaks = block.replace(/\n/g, '<br>');
    return `<p style="margin:0 0 14px;line-height:1.65">${withBreaks}</p>`;
  }).join('');

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f6f0e6;font-family:Georgia,'Times New Roman',serif;color:#211b16">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f0e6;padding:28px 14px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fffaf2;border:1px solid #e6d9c7;border-radius:14px;padding:32px 30px">
        <tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#211b16">${paragraphs}</td></tr>
      </table>
      <div style="max-width:560px;margin:14px auto 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#8b7b68;text-align:center">
        Enviado con Lucian
      </div>
    </td></tr>
  </table>
</body></html>`;
}

export function ensureCompliance(text, settings) {
  let body = String(text || '').trim();
  const brand = settings?.brand || {};
  const email = settings?.email || {};
  const optOutPattern = /(respond[eé]\s+baja|unsubscribe|date de baja|no\s+recibir\s+m[aá]s)/i;
  if (!optOutPattern.test(body)) {
    body += '\n\nSi preferís no recibir más mensajes, respondé BAJA y no vuelvo a escribirte.';
  }

  // CAN-SPAM exige una dirección postal física en los correos comerciales.
  // Si el dueño la cargó, se incluye en todas las piezas; si no, al menos
  // queda la ciudad, que es un dato verificable de ubicación.
  const identity = [brand.maker || brand.name, brand.address || brand.city, brand.website]
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index)
    .join(' · ');
  if (identity && !body.includes(identity)) {
    body += `\n\n${identity}`;
  }

  const footer = String(email.footer || '').trim();
  if (footer && !body.includes(footer)) {
    body += `\n\n${footer}`;
  }

  return body;
}

export function composeEmail(thread, draft, settings, { from: fromOverride } = {}) {
  const contact = thread?.contact || {};
  const brand = settings?.brand || {};
  const from = String(fromOverride || settings?.email?.from || '').trim() || (brand.email ? `${brand.name} <${brand.email}>` : '');
  const subject = String(draft?.subject || '').trim() || `Una pieza de ${brand.name || 'Lucian'} para ${contact.company || 'tu tienda'}`;
  const body = String(draft?.body || '').trim();
  const placeholder = /\[(?:nombre|name|empresa|company|producto|product|precio|price|enlace|link|insert[^\]]*)\]|\{\{[^{}\n]+\}\}/i;
  if (!body || placeholder.test(`${subject}\n${body}`) || /^(?:apertura del mensaje|asunto del correo|email subject|subject line)$/i.test(subject)) {
    throw new Error('El mensaje está incompleto y necesita revisión. Completá el texto y los campos de la plantilla antes de enviar.');
  }
  if (/^encaje:\s*[^\n]+$/i.test(body)) {
    throw new Error('El mensaje contiene solo una nota de encaje y necesita revisión. Prepará la propuesta para el destinatario antes de enviar.');
  }
  const text = ensureCompliance(body, settings);
  return {
    to: contact.email || '',
    from,
    replyTo: settings?.email?.replyTo || '',
    subject,
    text,
    html: htmlFromText(text),
    demo: Boolean(thread?.demo || isDemoEmail(contact.email)),
  };
}

export function buildEml(message) {
  const { from, to, subject, text, html, replyTo, messageId, inReplyTo, references } = message;
  const parsedFrom = splitFrom(from);
  if (!parsedFrom.email) throw new Error('Falta el remitente');
  if (!isValidEmail(to)) throw new Error('El destinatario no es un email válido');

  const domain = parsedFrom.email.split('@')[1] || 'lucian.local';
  const id = sanitizeHeader(messageId) || `<${crypto.randomUUID()}@${domain}>`;
  const date = new Date().toUTCString();
  const boundary = `lucian_${crypto.randomUUID().replace(/-/g, '')}`;
  const bodyText = Buffer.from(String(text || ''), 'utf8').toString('base64');
  const bodyHtml = Buffer.from(String(html || htmlFromText(text)), 'utf8').toString('base64');

  const headers = [
    `From: ${formatAddress(parsedFrom.name, parsedFrom.email)}`,
    `To: ${sanitizeHeader(to)}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${date}`,
    `Message-ID: ${id}`,
    'MIME-Version: 1.0',
  ];
  if (replyTo && isValidEmail(splitFrom(replyTo).email)) headers.push(`Reply-To: ${sanitizeHeader(replyTo)}`);
  // Hilos: sin In-Reply-To/References el cliente de correo del comprador abre
  // una conversación nueva y las respuestas se pierden.
  if (inReplyTo) headers.push(`In-Reply-To: ${sanitizeHeader(inReplyTo)}`);
  if (references) headers.push(`References: ${sanitizeHeader(references)}`);
  headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);

  return `${headers.join('\r\n')}\r\n\r\n--${boundary}\r\nContent-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${bodyText}\r\n--${boundary}\r\nContent-Type: text/html; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${bodyHtml}\r\n--${boundary}--\r\n`;
}

export function emlFilename(thread, draft) {
  const company = String(thread?.contact?.company || 'contacto').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '');
  const subject = String(draft?.subject || 'mensaje').slice(0, 40).replace(/[^a-zA-Z0-9_-]+/g, '-');
  return `${company || 'contacto'}-${subject || 'mensaje'}.eml`;
}

export async function sendWithResend(settings, message) {
  const key = settings?.email?.resendKey;
  if (!key) throw new Error('Falta la clave de Resend en Ajustes → Correo');
  if (!message.from) throw new Error('Falta configurar el remitente en Ajustes → Correo');
  if (message.consentVerified !== true) throw new Error('Resend requiere consentimiento explícito y documentado del destinatario.');
  if (!/^lumbre-[a-f0-9]{64}$/.test(String(message.idempotencyKey || ''))) {
    throw new Error('Resend requiere una clave de idempotencia persistente por borrador aprobado.');
  }

  const headers = {};
  if (message.messageId) headers['Message-ID'] = sanitizeHeader(message.messageId);
  if (message.inReplyTo) headers['In-Reply-To'] = sanitizeHeader(message.inReplyTo);
  if (message.references) headers.References = sanitizeHeader(message.references);

  const { ok, data, text } = await fetchJson('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'idempotency-key': message.idempotencyKey },
    body: {
      from: message.from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html,
      ...(message.replyTo ? { reply_to: message.replyTo } : {}),
      ...(Object.keys(headers).length ? { headers } : {}),
    },
    timeoutMs: 30000,
  });
  if (!ok) throw new Error(`Resend: ${data?.message || data?.error?.message || text.slice(0, 300)}`);
  return { id: data?.id || '', provider: 'resend' };
}

export async function sendWithGmail(settings, message) {
  const email = settings?.email || {};
  const user = String(email.smtpUser || '').trim();
  const pass = String(email.smtpPassword || '').trim();
  if (!user || !pass) throw new Error('Falta el usuario o la contraseña de aplicación de Gmail en Ajustes → Correo.');
  return await sendWithGmailSmtp({
    user,
    appPassword: pass,
    from: message.from || user,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
    replyTo: message.replyTo,
    messageId: message.messageId,
    inReplyTo: message.inReplyTo,
    references: message.references,
  });
}

export async function sendWithWebhook(settings, message, extra = {}) {
  const url = settings?.email?.webhookUrl;
  if (!url) throw new Error('Falta la URL del webhook en Ajustes → Correo');
  const { ok, data, text } = await fetchJson(url, {
    method: 'POST',
    headers: settings?.email?.webhookToken ? { 'x-lucian-token': settings.email.webhookToken } : {},
    body: {
      to: message.to,
      from: message.from,
      subject: message.subject,
      text: message.text,
      html: message.html,
      ...(message.replyTo ? { reply_to: message.replyTo } : {}),
      ...(message.messageId ? { messageId: message.messageId } : {}),
      ...(message.inReplyTo ? { inReplyTo: message.inReplyTo } : {}),
      ...(message.references ? { references: message.references } : {}),
      ...extra,
    },
    timeoutMs: 30000,
  });
  // Un webhook de correo debe responder con JSON confirmando el envío.
  // Si devuelve una página HTML (como una web cualquiera), NO es un
  // servicio de correo: marcarlo como "enviado" sería un falso positivo.
  // Antes pasaba: https://lucian.com devolvía 200 con HTML y los correos
  // quedaban como enviados sin que nadie los recibiera.
  const looksLikeHtml = /<(!doctype|html|head|body)\b/i.test(text || '');
  if (looksLikeHtml) {
    throw new Error('El webhook devolvió una página web en vez de una confirmación JSON. No es un servicio de correo: revisá la URL en Ajustes → Correo.');
  }
  if (!ok) throw new Error(`Webhook: ${data?.message || text.slice(0, 300)}`);
  if (!data || typeof data !== 'object') {
    throw new Error('El webhook no confirmó el envío con JSON. No se marcó como enviado.');
  }
  return { id: data?.id || '', provider: 'webhook' };
}

export async function testResend(settings) {
  const key = settings?.email?.resendKey;
  if (!key) throw new Error('Falta la clave de Resend');
  const response = await fetch('https://api.resend.com/domains', {
    headers: { authorization: `Bearer ${key}` },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Resend: ${text.slice(0, 300)}`);
  const data = JSON.parse(text || '{}');
  return { domains: (data.data || []).map((d) => ({ name: d.name, status: d.status })) };
}

/* ─────────────────────────────────────────────────────────────
   Límites de envío y calentamiento
   ───────────────────────────────────────────────────────────── */

export function sentToday(threads) {
  const today = localDayKey();
  let count = 0;
  for (const thread of threads || []) {
    for (const message of thread.messages || []) {
      if (message.direction !== 'out') continue;
      // Los envíos marcados a mano desde el correo del dueño no consumen
      // el cupo de calentamiento del envío automático.
      if (message.status !== 'enviado') continue;
      if (message.provider === 'manual' || message.channel === 'manual') continue;
      if (localDayKey(message.at || message.sentAt) !== today) continue;
      count += 1;
    }
  }
  return count;
}

export function firstSentDate(threads) {
  let first = null;
  for (const thread of threads || []) {
    for (const message of thread.messages || []) {
      if (message.direction !== 'out' || message.status !== 'enviado') continue;
      if (message.provider === 'manual' || message.channel === 'manual') continue;
      const date = new Date(message.at || message.sentAt);
      if (Number.isNaN(date.getTime())) continue;
      if (!first || date < first) first = date;
    }
  }
  return first;
}

export function dailyLimitInfo(settings, threads) {
  const configured = Number(settings?.email?.dailyLimit) || 20;
  const used = sentToday(threads);
  if (!settings?.email?.warmup) {
    return { limit: configured, used, remaining: Math.max(0, configured - used), warmup: false, day: null };
  }
  const first = firstSentDate(threads);
  if (!first) {
    const limit = Math.min(configured, 10);
    return { limit, used, remaining: Math.max(0, limit - used), warmup: true, day: 1 };
  }
  const days = Math.max(1, Math.floor((Date.now() - first.getTime()) / 86400000) + 1);
  const week = Math.ceil(days / 7);
  const limit = Math.min(configured, week <= 1 ? 10 : week === 2 ? 20 : week === 3 ? 30 : configured);
  return { limit, used, remaining: Math.max(0, limit - used), warmup: true, day: days };
}

/* ─────────────────────────────────────────────────────────────
   Dominios de envío.

   Un dominio (o subdominio) verificado tiene su propia reputación. Resend
   permite varios dominios y recomienda subdominios para separar propósitos;
   el límite de 200/día es una guarda conservadora por dominio, no una
   autorización para enviar sin consentimiento. Cada mensaje guarda el
   dominio con el que salió para que la contabilidad sea exacta.
   ───────────────────────────────────────────────────────────── */

export const MAX_SEND_DOMAINS = 100;
export const MAX_DAILY_PER_DOMAIN = 200;
const SEND_DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

export function normalizeDomain(value) {
  const raw = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .split(/[/?#]/)[0]
    .split('@')
    .pop();
  return SEND_DOMAIN_RE.test(raw) ? raw : '';
}

function senderAddress(from) {
  const raw = String(from || '').trim();
  const match = raw.match(/<([^>]+)>/);
  const email = String(match ? match[1] : raw).trim().toLowerCase();
  return { email, domain: normalizeDomain(email.split('@')[1] || '') };
}

function clampDomainLimit(value, fallback = MAX_DAILY_PER_DOMAIN) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.min(MAX_DAILY_PER_DOMAIN, Math.round(number))) : fallback;
}

/* Configuración nueva: array de { domain, from, dailyLimit, enabled }.
   Configuración antigua: un solo `email.from` con su límite y calentamiento. */
export function normalizeSendDomains(value, settings = {}) {
  const emailSettings = settings?.email || {};
  const brand = settings?.brand || {};
  const raw = Array.isArray(value) ? value : [];
  if (!raw.length) {
    const from = String(emailSettings.from || emailSettings.smtpUser || brand.email || '').trim();
    const parsed = senderAddress(from);
    if (!parsed.email || !isValidEmail(parsed.email) || !parsed.domain) return [];
    return [{
      id: 'legacy',
      domain: parsed.domain,
      from,
      label: parsed.domain,
      dailyLimit: clampDomainLimit(emailSettings.dailyLimit, 20),
      enabled: true,
      warmup: emailSettings.warmup !== false,
      legacy: true,
    }];
  }

  const seen = new Set();
  const list = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const from = String(item.from || '').trim();
    const parsed = senderAddress(from);
    const domain = normalizeDomain(item.domain) || parsed.domain;
    if (!parsed.email || !isValidEmail(parsed.email) || !domain || parsed.domain !== domain) continue;
    if (seen.has(domain)) continue;
    seen.add(domain);
    list.push({
      id: String(item.id || `dom_${domain}`).slice(0, 80),
      domain,
      from,
      label: String(item.label || domain).slice(0, 80),
      dailyLimit: clampDomainLimit(item.dailyLimit),
      enabled: item.enabled !== false,
      warmup: item.warmup === true,
      legacy: false,
    });
    if (list.length >= MAX_SEND_DOMAINS) break;
  }
  // Si el dueño configuró dominios pero todos son inválidos, no callamos a
  // un remitente distinto: bloqueamos el envío y mostramos el error.
  return list;
}

/* Validación para la API: devuelve errores concretos en vez de descartar
   dominios mal escritos sin que el dueño se entere. */
export function validateSendDomains(value) {
  if (value === undefined || value === null) return { ok: true, errors: [] };
  if (!Array.isArray(value)) return { ok: false, errors: ['Dominios de envío debe ser una lista.'] };
  if (value.length > MAX_SEND_DOMAINS) {
    return { ok: false, errors: [`Máximo ${MAX_SEND_DOMAINS} dominios de envío.`] };
  }
  const errors = [];
  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    const label = `Dominio ${index + 1}`;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push(`${label}: datos inválidos.`);
      continue;
    }
    const from = String(item.from || '').trim();
    const parsed = senderAddress(from);
    const domain = normalizeDomain(item.domain) || parsed.domain;
    if (!isValidEmail(parsed.email)) errors.push(`${label}: el remitente no es un email válido.`);
    if (!domain) errors.push(`${label}: el dominio no es válido.`);
    if (domain && parsed.domain !== domain) errors.push(`${label}: el remitente no pertenece a ${domain}.`);
    if (domain && seen.has(domain)) errors.push(`${label}: dominio repetido.`);
    if (domain) seen.add(domain);
    if (item.dailyLimit !== undefined && (!Number.isFinite(Number(item.dailyLimit)) || Number(item.dailyLimit) < 1 || Number(item.dailyLimit) > MAX_DAILY_PER_DOMAIN)) {
      errors.push(`${label}: el límite debe estar entre 1 y ${MAX_DAILY_PER_DOMAIN}.`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function activeSendDomains(settings) {
  return normalizeSendDomains(settings?.email?.sendDomains, settings).filter((domain) => domain.enabled);
}

/* Contabilidad por dominio en el día local. Los envíos marcados a mano no
   consumen cupo: son el correo personal del dueño, no la cola automática. */
export function domainStats(threads, domains = []) {
  const today = localDayKey();
  const map = new Map();
  const fallback = domains.length === 1
    ? domains[0].domain
    : (domains.find((domain) => domain.legacy)?.domain || '');
  for (const thread of threads || []) {
    for (const message of thread.messages || []) {
      if (message?.direction !== 'out' || message.status !== 'enviado') continue;
      if (message.provider === 'manual' || message.channel === 'manual') continue;
      if (localDayKey(message.at || message.sentAt) !== today) continue;
      const domain = normalizeDomain(message.sendDomain) || senderAddress(message.from).domain || fallback;
      if (!domain) continue;
      const stat = map.get(domain) || { count: 0, first: null };
      stat.count += 1;
      const at = Date.parse(message.at || message.sentAt);
      if (Number.isFinite(at) && (!stat.first || at < stat.first)) stat.first = at;
      map.set(domain, stat);
    }
  }
  return map;
}

function warmupLimit(configured, dayIndex = 0) {
  if (dayIndex <= 0) return Math.min(configured, 10);
  const week = Math.ceil(dayIndex / 7);
  return Math.min(configured, week <= 1 ? 10 : week === 2 ? 20 : week === 3 ? 30 : configured);
}

export function domainLimitInfo(settings, threads, domain, { domains: knownDomains, stats: knownStats } = {}) {
  const domains = knownDomains || normalizeSendDomains(settings?.email?.sendDomains, settings);
  const key = normalizeDomain(domain) || String(domain || '');
  const config = domains.find((item) => item.domain === key || item.id === key);
  if (!config) {
    return { domain: key, from: '', limit: 0, used: 0, remaining: 0, warmup: false, day: null, error: 'Dominio de envío no configurado.' };
  }
  const stats = (knownStats || domainStats(threads, domains)).get(config.domain) || { count: 0, first: null };
  let limit = config.dailyLimit;
  let day = null;
  if (config.warmup) {
    day = stats.first ? Math.max(1, Math.floor((Date.now() - stats.first) / 86400000) + 1) : 1;
    limit = warmupLimit(config.dailyLimit, day);
  }
  return {
    id: config.id,
    domain: config.domain,
    from: config.from,
    limit,
    used: stats.count,
    remaining: Math.max(0, limit - stats.count),
    warmup: Boolean(config.warmup),
    day,
  };
}

export function sendDomainStatus(settings, threads) {
  const domains = normalizeSendDomains(settings?.email?.sendDomains, settings);
  const stats = domainStats(threads, domains);
  const rows = domains.map((config) => {
    const stat = stats.get(config.domain) || { count: 0, first: null };
    let limit = config.dailyLimit;
    let day = null;
    if (config.warmup) {
      day = stat.first ? Math.max(1, Math.floor((Date.now() - stat.first) / 86400000) + 1) : 1;
      limit = warmupLimit(config.dailyLimit, day);
    }
    return {
      id: config.id,
      domain: config.domain,
      from: config.from,
      label: config.label,
      enabled: config.enabled,
      legacy: config.legacy,
      limit,
      used: stat.count,
      remaining: Math.max(0, limit - stat.count),
      warmup: Boolean(config.warmup),
      day,
    };
  });
  return {
    domains: rows,
    capacity: rows.filter((row) => row.enabled).reduce((sum, row) => sum + row.limit, 0),
    used: rows.reduce((sum, row) => sum + row.used, 0),
    remaining: rows.filter((row) => row.enabled).reduce((sum, row) => sum + row.remaining, 0),
  };
}

/* Elección determinista y equilibrada: primero el dominio con menos envíos
   hoy; en empate, un hash del día y de la misión reparte la carga sin estado
   oculto. Los dominios en `blocked` (espaciado) se excluyen. Complejidad
   O(D log D) con D ≤ 100. */
export function chooseSendDomain({ settings, threads, seed = '', blocked = [] } = {}) {
  const domains = activeSendDomains(settings);
  if (!domains.length) return null;
  const stats = domainStats(threads, domains);
  const excluded = new Set(blocked.map((domain) => normalizeDomain(domain)).filter(Boolean));
  const candidates = domains.filter((domain) => {
    if (excluded.has(domain.domain)) return false;
    const config = domainLimitInfo(settings, threads, domain.domain, { domains, stats });
    return !config.error && config.remaining > 0;
  });
  if (!candidates.length) return null;
  const counts = candidates.map((domain) => stats.get(domain.domain)?.count || 0);
  const min = Math.min(...counts);
  const tied = candidates.filter((domain, index) => counts[index] === min);
  if (tied.length === 1) return tied[0];
  const digest = crypto.createHash('sha256').update(`${localDayKey()}|${seed}`).digest();
  return tied[digest[0] % tied.length];
}

export function assertCanSend(settings, threads, email, suppressions = [], options = {}) {
  const manual = options.manual === true;
  const company = options.company || '';
  const target = normalizeEmail(email);

  if (isSuppressed(target, suppressions, company)) {
    throw new Error('Ese contacto pidió no recibir más mensajes (lista de no contactar).');
  }
  // El envío manual es el dueño usando su propio correo o el formulario de la
  // tienda: no necesita dirección, no consume cupo y sirve para registrar
  // contactos por LinkedIn/formulario. Los canales reales sí exigen email.
  if (manual) return dailyLimitInfo(settings, threads);

  if (options.sendDomain) {
    const info = domainLimitInfo(settings, threads, options.sendDomain);
    if (info.error) throw new Error(info.error);
    if (info.remaining <= 0) {
      throw new Error(`Llegaste al límite de ${info.limit} envíos por hoy para ${info.domain}${info.warmup ? ` (calentamiento, día ${info.day})` : ''}.`);
    }
    return info;
  }

  if (!isValidEmail(target)) throw new Error('El contacto no tiene un email válido.');
  if (isDemoEmail(target)) throw new Error('Es un email de ejemplo (example.com). No se puede enviar desde una misión demo.');
  if (settings?.email?.provider === 'resend' && !settings?.email?.resendKey) {
    throw new Error('Elegiste Resend pero falta la clave en Ajustes → Correo.');
  }
  if (settings?.email?.provider === 'gmail') {
    if (!settings?.email?.smtpUser || !settings?.email?.smtpPassword) {
      throw new Error('Elegiste Gmail pero faltan el usuario o la contraseña de aplicación en Ajustes → Correo.');
    }
  }
  const info = dailyLimitInfo(settings, threads);
  if (info.remaining <= 0) {
    throw new Error(`Llegaste al límite de ${info.limit} envíos por hoy${info.warmup ? ` (semana de calentamiento, día ${info.day})` : ''}.`);
  }
  return info;
}

/* Los proveedores de correo entrante mandan los identificadores de hilo con
   nombres distintos y, a veces, dentro de `headers`. Normalizamos ambos
   formatos: sin esto, dos hilos del mismo comprador se mezclan. */
function headerValue(source, name) {
  if (!source || typeof source !== 'object') return '';
  const headers = source.headers && typeof source.headers === 'object' ? source.headers : source;
  const wanted = String(name).toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() !== wanted) continue;
    if (Array.isArray(value)) return value.filter(Boolean).join(' ').trim();
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function referenceList(value) {
  const raw = Array.isArray(value) ? value : String(value || '').match(/<[^>]+>/g) || [];
  return raw.map((item) => String(item).trim()).filter((item) => /^<[^>]+>$/.test(item));
}

export function parseInbound(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const data = payload.data && typeof payload.data === 'object' ? payload.data : payload;
  const fromRaw = data.from || data.sender || data.email || '';
  const from = typeof fromRaw === 'string' ? fromRaw : fromRaw?.email || '';
  const to = Array.isArray(data.to) ? data.to[0] : data.to || '';
  const subject = data.subject || '';
  const text = data.text || data.plain || data.body || '';
  const html = data.html || '';
  if (!from || (!text && !html)) return null;
  const messageId = data.messageId || data.message_id || headerValue(data, 'message-id');
  const inReplyTo = data.inReplyTo || data.in_reply_to || headerValue(data, 'in-reply-to');
  const referencesRaw = data.references || headerValue(data, 'references');
  return {
    from: String(from),
    to: String(to),
    subject: String(subject),
    text: String(text),
    html: String(html),
    messageId: String(messageId || '').trim(),
    inReplyTo: String(inReplyTo || '').trim(),
    references: referenceList(referencesRaw),
  };
}

/* Eventos de entrega (Resend y formatos equivalentes). Un rebote duro o una
   queja de spam no son una respuesta: hay que suprimir la dirección antes de
   que el siguiente envío queme el dominio. */
const EMAIL_EVENTS = {
  'email.bounced': 'bounce',
  'email.complained': 'complaint',
  'email.delivered': 'delivered',
  'email.opened': 'opened',
  'email.clicked': 'clicked',
  'email.delivery_delayed': 'delayed',
};

function eventEmail(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/<([^>]+)>/);
  return normalizeEmail(match ? match[1] : raw);
}

export function parseEmailEvent(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const type = String(payload.type || payload.event || payload.event_type || '').toLowerCase();
  let kind = EMAIL_EVENTS[type] || '';
  if (!kind && /bounce/.test(type)) kind = 'bounce';
  if (!kind && /complain/.test(type)) kind = 'complaint';
  if (!kind) return null;
  const data = payload.data && typeof payload.data === 'object' ? payload.data : payload;
  const recipients = data.to ?? data.recipient ?? data.recipients ?? data.email ?? '';
  const emails = [...new Set((Array.isArray(recipients) ? recipients : [recipients]).map(eventEmail).filter(isValidEmail))];
  const bounce = data.bounce && typeof data.bounce === 'object' ? data.bounce : {};
  const severity = `${bounce.type || ''} ${bounce.subType || ''} ${data.severity || ''}`;
  return {
    type,
    kind,
    emails,
    hard: kind === 'complaint' || (kind === 'bounce' && !/transient|soft|delayed/i.test(severity)),
    messageId: String(data.messageId || data.message_id || headerValue(data, 'message-id') || '').trim(),
    reason: String(bounce.message || data.reason || data.error || '').slice(0, 500),
  };
}
