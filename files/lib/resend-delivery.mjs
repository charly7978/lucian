/* Conciliación de entregas de Resend: SÓLO GET, no envíos.
   El endpoint recibe el estado más reciente, no la historia completa.
   Toda respuesta se correlaciona por providerId de un mensaje realmente enviado.
 */
const ID = /^[a-z0-9][a-z0-9_-]{7,100}$/i;
const EVENTS = new Map([
  ['delivered', 'delivered'], ['opened', 'delivered'], ['clicked', 'delivered'],
  ['bounced', 'bounced'], ['suppressed', 'suppressed'], ['complained', 'complained'],
  ['delivery_delayed', 'delayed'], ['delayed', 'delayed'],
  ['sent', 'sent'], ['received', 'sent'], ['queued', 'sent'],
]);

export function classifyResendEvent(event) {
  return EVENTS.get(String(event || '').trim().toLowerCase()) || 'unknown';
}

export function resendTrackedMessages(threads = []) {
  const tracked = new Map();
  for (const thread of threads) {
    if (!thread || thread.demo) continue;
    for (const message of thread.messages || []) {
      if (message?.direction !== 'out' || message.provider !== 'resend') continue;
      if (!ID.test(String(message.providerId || ''))) continue;
      if (!tracked.has(message.providerId)) tracked.set(message.providerId, []);
      tracked.get(message.providerId).push(message);
    }
  }
  return tracked;
}

export async function obtainResendDeliveryReport({ threads = [], apiKey, fetcher = fetch, maxPages = 15 } = {}) {
  if (typeof apiKey !== 'string' || !apiKey.startsWith('re_')) {
    throw new Error('No hay una clave Resend válida configurada. Revisá Conexiones.');
  }
  const tracked = resendTrackedMessages(threads);
  const counts = { tracked: tracked.size, found: 0, notFound: 0, pages: 0, delivered: 0, bounced: 0, suppressed: 0, complained: 0, delayed: 0, sent: 0, unknown: 0 };
  if (!tracked.size) return { counts, updates: [], complete: true, explanation: 'No hay correos de Resend con identificador de proveedor guardado en Lucian.' };
  const found = new Map();
  const allowedPages = Math.max(1, Math.min(50, Number(maxPages) || 15));
  let cursor = '';
  let complete = false;
  const seenCursors = new Set();
  for (let page = 0; page < allowedPages; page++) {
    const url = new URL('https://api.resend.com/emails');
    url.searchParams.set('limit', '100');
    if (cursor) url.searchParams.set('after', cursor);
    let response;
    try {
      response = await fetcher(url.toString(), {
        method: 'GET',
        headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      });
    } catch (error) {
      const code = String(error?.cause?.code || error?.code || '').slice(0, 32);
      throw new Error(code ? `Resend no respondió (${code}); revisá DNS, proxy, SSL y conexión.` : 'Resend no respondió: comprobá Internet o el tiempo de espera.');
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error(`Resend HTTP ${response.status}: revisá los permisos de lectura de la clave API.`);
      if (response.status === 429) throw new Error('Resend limitó temporalmente las consultas (HTTP 429). Reintentá más tarde.');
      throw new Error(`Resend devolvió HTTP ${response.status} al consultar entregas.`);
    }
    let payload;
    try { payload = await response.json(); } catch { throw new Error('Resend devolvió una respuesta no JSON.'); }
    if (!Array.isArray(payload?.data)) throw new Error('Resend devolvió un formato de lista inesperado.');
    counts.pages++;
    const items = payload.data;
    for (const item of items) {
      if (tracked.has(item?.id) && !found.has(item.id)) found.set(item.id, String(item.last_event || '').trim().toLowerCase());
    }
    if (found.size === tracked.size || payload.has_more !== true || items.length === 0) { complete = true; break; }
    const next = items[items.length - 1]?.id;
    if (!ID.test(String(next || '')) || seenCursors.has(next)) { complete = false; break; }
    seenCursors.add(next);
    cursor = next;
  }
  const updates = [];
  for (const [providerId, lastEvent] of found) {
    const status = classifyResendEvent(lastEvent);
    counts[status] = (counts[status] || 0) + 1;
    updates.push({ providerId, lastEvent, status });
  }
  counts.found = found.size;
  counts.notFound = tracked.size - found.size;
  return { counts, updates, complete, explanation: complete
    ? 'Consulta de Resend terminada. Último evento no equivale a lectura ni respuesta.'
    : 'Resultado parcial: algunos envíos anteriores no se encontraron dentro de las páginas consultadas.' };
}

export function applyResendDeliveryReport(threads, report, checkedAt = new Date().toISOString()) {
  const tracked = resendTrackedMessages(threads);
  let updated = 0;
  for (const entry of report.updates || []) {
    for (const message of tracked.get(entry.providerId) || []) {
      if (message.providerLastEvent === entry.lastEvent && message.deliveryStatus === entry.status) continue;
      message.providerLastEvent = entry.lastEvent;
      message.deliveryStatus = entry.status;
      message.lastDeliveryCheckAt = checkedAt;
      updated++;
    }
  }
  return updated;
}
