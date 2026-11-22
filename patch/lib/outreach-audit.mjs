/* Auditoria comercial de contactos: sin llamadas a red, sin escrituras, sin envios.
 * Las respuestas corresponden a lo REGISTRADO en Lucian, no a la bandeja externa completa.
 * 'enviado' significa aceptado por el canal; no hay prueba de entrega final salvo eventos explícitos.
 */
import { isSuppressed, isValidEmail } from './email.mjs';
import { hasDocumentedOptIn } from './security.mjs';

const DAY = 86_400_000;
const date = (v) => { const d = Date.parse(String(v || '')); return Number.isFinite(d) ? d : null; };
const safeCount = (value) => Math.max(0, Number(value) || 0);
const ACTIVE = new Set(['nuevo','contactado','respondio','interesado','negociando']);

export function auditOutreach({ threads = [], outbox = [], suppressions = [], now = Date.now(), limit = 12 } = {}) {
  const clock = Number(now);
  const real = threads.filter(t => t && t.id && !t.demo);
  const suppressed = (suppressions || []).filter(s => s && !s.demo);
  const counts = {
    contacts: real.length, contacted: 0, outboundMessages: 0, replied: 0,
    inboundMessages: 0, noReply: 0, noReplySevenDays: 0,
    providerAccepted: 0, deliveryConfirmed: 0, deliveryUnknown: 0,
    manualRecords: 0, blocked: 0, consented: 0, invalidEmail: 0,
    warm: 0, acceptedQuotes: 0,
    providerFailedDelivery: 0,
    failedQueueItems: (outbox || []).filter(x => x && x.status === 'error' && !x.demo).length,
    pendingQueueItems: (outbox || []).filter(x => x && x.status === 'pending' && !x.demo).length,
  };
  const channels = {};
  const aged = [];
  const priorities = [];
  const activeSuppression = (t) => Boolean(t.optOut) || isSuppressed(t.contact?.email, suppressed, t.contact?.company);

  for (const thread of real) {
    const messages = Array.isArray(thread.messages) ? thread.messages : [];
    const outbound = messages.filter(m => m?.direction === 'out');
    const inbound = messages.filter(m => m?.direction === 'in');
    const accepted = outbound.filter(m => m.status !== 'enviado_manual' && m.provider && m.provider !== 'manual');
    const manual = outbound.filter(m => m.status === 'enviado_manual' || m.provider === 'manual');
    const explicitlyDelivered = accepted.filter(m => m.deliveryStatus === 'delivered' || m.deliveredAt);
    const explicitlyFailed = accepted.filter(m => ['bounced', 'suppressed', 'complained'].includes(m.deliveryStatus));
    const muted = activeSuppression(thread);
    const permission = hasDocumentedOptIn(thread.contact);
    const hasReply = outbound.length && inbound.length && inbound.some(m => {
      const first = date(outbound[0].at);
      const incoming = date(m.at);
      return first === null || incoming === null || incoming >= first;
    });
    if (muted) counts.blocked++;
    if (permission) counts.consented++;
    if (!isValidEmail(thread.contact?.email)) counts.invalidEmail++;
    if (['interesado','negociando'].includes(thread.stage)) counts.warm++;
    counts.acceptedQuotes += (thread.quotes || []).filter(q => q.status === 'aceptada').length;
    counts.outboundMessages += outbound.length;
    counts.providerAccepted += accepted.length;
    counts.deliveryConfirmed += explicitlyDelivered.length;
    counts.providerFailedDelivery += explicitlyFailed.length;
    counts.deliveryUnknown += Math.max(0, accepted.length - explicitlyDelivered.length - explicitlyFailed.length);
    counts.manualRecords += manual.length;
    counts.inboundMessages += inbound.length;
    if (outbound.length) counts.contacted++;
    if (hasReply) counts.replied++;
    if (outbound.length && !hasReply) {
      counts.noReply++;
      const lastOut = outbound.map(m => date(m.at)).filter(x => x !== null).sort((a,b)=>b-a)[0] ?? null;
      const ageDays = lastOut === null || !Number.isFinite(clock) ? null : Math.floor(Math.max(0, clock - lastOut) / DAY);
      if (ageDays !== null && ageDays >= 7) counts.noReplySevenDays++;
      const status = muted ? 'no-contactar'
        : !permission ? 'revisar-permiso'
        : ageDays !== null && ageDays >= 7 ? 'revisar-oferta-canal'
        : 'esperar';
      aged.push({
        threadId: thread.id, company: String(thread.contact?.company || thread.contact?.name || thread.contact?.email || 'Contacto').slice(0,120),
        stage: String(thread.stage || 'nuevo'), daysSinceLastOutbound: ageDays, status,
        nextAction: muted ? 'No contactar: baja o supresión.'
          : !permission ? 'Revisar consentimiento y el canal permitido antes de cualquier seguimiento.'
          : ageDays !== null && ageDays >= 7 ? 'Revisar adecuación del comprador y la oferta; preparar un seguimiento útil para aprobación.'
          : 'Todavía es pronto para repetir el contacto. Revisar entrega y esperar.',
      });
    }
    if (inbound.length && ACTIVE.has(thread.stage) && !muted) {
      priorities.push({ threadId:thread.id, company:String(thread.contact?.company || thread.contact?.name || 'Comprador'), kind:'respuesta', action:'Responder la consulta registrada', priority:100 });
    }
    for (const m of outbound) {
      const channel = String(m.channel || m.provider || 'desconocido').toLowerCase().slice(0,32);
      channels[channel] = (channels[channel] || 0) + 1;
    }
  }
  const repliedContacts = counts.replied;
  const responseRatePercent = counts.contacted ? Math.round(1000 * repliedContacts / counts.contacted) / 10 : null;
  const agedActionable = aged.filter(x => x.daysSinceLastOutbound !== null && x.daysSinceLastOutbound >= 7 && x.status === 'revisar-oferta-canal');
  aged.sort((a,b) => (b.daysSinceLastOutbound ?? -1) - (a.daysSinceLastOutbound ?? -1));
  priorities.push(...agedActionable.slice(0, 12).map(x => ({ threadId:x.threadId, company:x.company, kind:'revision', action:x.nextAction, priority:60 })));
  priorities.sort((a,b)=>b.priority-a.priority || a.company.localeCompare(b.company));
  const diagnoses = [];
  if (counts.contacted === 0) diagnoses.push('No hay mensajes salientes registrados en los hilos reales de Lucian: no es posible evaluar respuestas desde el CRM.');
  else if (counts.replied === 0) diagnoses.push('Hay mensajes salientes pero ninguna respuesta asociada registrada. Antes de insistir, comprobar entregabilidad y recepción IMAP/webhooks.');
  else diagnoses.push('Hay respuestas registradas. Priorizar esas conversaciones frente a nuevos contactos.');
  if (counts.deliveryUnknown) diagnoses.push('Lucian no dispone de prueba de entrega final para muchos mensajes aceptados por proveedores. Aceptado no significa recibido ni leído.');
  if (counts.providerFailedDelivery) diagnoses.push('Resend informó rebotes, supresiones o quejas. No insistir a esos destinatarios; revisar el problema de entrega.');
  if (counts.failedQueueItems) diagnoses.push('La bandeja de salida tiene envíos fallidos: diagnosticar el proveedor antes de ampliar campañas.');
  if (counts.noReplySevenDays) diagnoses.push('Hay contactos sin respuesta durante 7 días o más. Revisar destinatario, oferta y canal; no reenviar el mismo texto automáticamente.');
  if (counts.blocked) diagnoses.push('Las bajas y supresiones deben mantenerse excluidas de toda secuencia comercial.');
  return {
    counts, responseRatePercent, channels, diagnoses,
    unanswered: aged.slice(0, Math.min(30, Math.max(1, safeCount(limit) || 12))),
    priorities: priorities.slice(0, Math.min(30, Math.max(1, safeCount(limit) || 12))),
    methodology: 'Solo datos registrados en Lucian, sin lectura directa de Gmail o Resend. Respuesta registrada ≠ tasa de lectura. Entrega aceptada ≠ entregada. Los registros manuales no prueban envío externo.',
    nextExperiment: 'Seleccionar dos segmentos de compradores con mayor afinidad, validar las fichas de tres lámparas, probar dos propuestas distintas mediante canales permitidos y medir consultas/cotizaciones por segmento. Evitar campañas indiscriminadas.',
  };
}
