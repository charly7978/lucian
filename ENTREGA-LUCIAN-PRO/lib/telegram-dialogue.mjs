/* ============================================================
   Diálogo serio por Telegram.

   Contrato:
   - detectIntent(text) -> intención determinista (sin gastar IA).
   - prepareSession(session) -> memoria comprimida y acotada.
   - contextTurns(session) -> historial aumentado con el resumen.
   - quickReplyMarkup() / confirmReplyMarkup() -> teclados inline.
   - parseCallback(data) -> acción de un botón inline.

   Basado en la documentación oficial de Telegram Bot API: comandos
   globales /start, /help, /settings; inline keyboards con callback_data
   y edición del markup en lugar de enviar mensajes nuevos.
   ============================================================ */
import { truncate } from './util.mjs';

export const DIALOGUE_VERSION = 2;
export const RECENT_TURNS = 24;
const COMPRESS_AT = 40;
const SUMMARY_MAX = 1400;

export const BOT_COMMANDS = [
  { command: 'start', description: 'Arrancar y ver qué puedo hacer' },
  { command: 'help', description: 'Ayuda, comandos y límites' },
  { command: 'estado', description: 'Estado de hoy' },
  { command: 'misiones', description: 'Últimas misiones' },
  { command: 'resumen', description: 'Resumen del día' },
  { command: 'pausar', description: 'Pausar avisos' },
  { command: 'activar', description: 'Reactivar avisos' },
  { command: 'reiniciar', description: 'Borrar memoria de la charla' },
];

const ALIASES = new Map([
  ['start', 'start'], ['ayuda', 'help'], ['help', 'help'], ['settings', 'help'],
  ['estado', 'status'], ['misiones', 'missions'], ['resumen', 'summary'],
  ['pausar', 'pause'], ['activar', 'resume'], ['reiniciar', 'reset'],
  ['confirmar', 'confirm'], ['cancelar', 'cancel'], ['si', 'confirm'], ['sí', 'confirm'],
  ['dale', 'confirm'], ['ok', 'confirm'], ['no', 'cancel'], ['cancel', 'cancel'],
  ['perfil', 'profile'], ['memoria', 'profile'], ['olvidar', 'forget'],
]);

export function normalizeText(value) {
  return String(value || '').trim().toLowerCase().replace(/^@[\w]+\s*/, '').replace(/\s+/g, ' ');
}

export function detectIntent(text) {
  const raw = normalizeText(text);
  const command = raw.replace(/^\//, '').split(' ')[0];
  if (ALIASES.has(command)) return ALIASES.get(command);
  if (!raw) return 'empty';
  const words = raw.split(' ').filter(Boolean);
  if (words.length <= 2 && /^(hola|buenas|buen dia|buenos dias|hey|hi|hello|y\?|que tal|q tal)\b/.test(raw)) return 'greeting';
  if (words.length <= 3 && /^(preparar|lanzar|buscar|mandar|enviar|cargar|subir|cambiar|crear)\b/.test(raw)) return 'incomplete_action';
  return 'question';
}

/* No hay respuestas prefabricadas. Los saludos, las preguntas incompletas y
   cualquier texto libre los responde el modelo con systemFor('director') y
   dialogueHint(). `detectIntent` solo enruta los comandos deterministas. */

export function prepareSession(session) {
  const s = session || {};
  s.history = Array.isArray(s.history) ? s.history : [];
  s.summary = typeof s.summary === 'string' ? s.summary : '';
  s.turns = Number(s.turns) || 0;
  s.topics = Array.isArray(s.topics) ? s.topics.slice(-12) : [];
  if (s.history.length >= COMPRESS_AT) {
    const old = s.history.slice(0, s.history.length - RECENT_TURNS);
    const lines = old.map((h) => `${h.role === 'user' ? 'Dueño' : 'Agente'}: ${String(h.text || '').slice(0, 280)}`);
    s.summary = truncate([s.summary, ...lines].filter(Boolean).join('\n'), SUMMARY_MAX);
    s.history = s.history.slice(-RECENT_TURNS);
  }
  if (s.history.length > RECENT_TURNS) s.history = s.history.slice(-RECENT_TURNS);
  return s;
}

export function contextTurns(session) {
  const s = prepareSession(session);
  const turns = [];
  if (s.summary) {
    turns.push({ role: 'assistant', text: `MEMORIA DE LA CHARLA (hechos ya acordados): ${s.summary}` });
  }
  for (const item of s.history.slice(0, -1)) {
    turns.push({ role: item.role, text: truncate(String(item.text || ''), 600) });
  }
  return turns.slice(-RECENT_TURNS);
}

export function rememberTopic(session, topic) {
  const value = truncate(String(topic || '').trim(), 80);
  if (!value) return;
  const s = prepareSession(session);
  s.topics = [...new Set([...s.topics, value])].slice(-12);
}

/* botones de acceso rápido: callback_data corto y estable. */
export function quickReplyMarkup() {
  return {
    inline_keyboard: [
      [{ text: 'Estado', callback_data: 'q:estado' }, { text: 'Resumen', callback_data: 'q:resumen' }],
      [{ text: 'Misiones', callback_data: 'q:misiones' }, { text: 'Ayuda', callback_data: 'q:help' }],
    ],
  };
}

export function confirmReplyMarkup(token) {
  const safe = String(token || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24);
  return {
    inline_keyboard: [[
      { text: 'Confirmar', callback_data: `cb:confirm:${safe}` },
      { text: 'Cancelar', callback_data: `cb:cancel:${safe}` },
    ]],
  };
}

export function parseCallback(data) {
  const raw = String(data || '');
  if (raw.startsWith('q:')) {
    const command = raw.slice(2);
    return { kind: 'quick', command: ALIASES.get(command) || command, text: `/${command}` };
  }
  const match = raw.match(/^cb:(confirm|cancel):(.+)$/);
  if (match) return { kind: match[1], token: match[2], text: match[1] === 'confirm' ? 'confirmar' : 'cancelar' };
  return null;
}

export function choiceReplyMarkup(options, prefix = 'q') {
  const rows = [];
  const list = Array.isArray(options) ? options.slice(0, 6) : [];
  for (let i = 0; i < list.length; i += 2) {
    const row = list.slice(i, i + 2).map((option, index) => ({
      text: truncate(String(option?.text || option || '').trim(), 40),
      callback_data: `${prefix}:${String(option?.value || option || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || `op${i + index}`}`,
    }));
    if (row.every((button) => button.text)) rows.push(row);
  }
  return rows.length ? { inline_keyboard: rows } : null;
}

/* Resuelve referencias dégicas contra los temas de la charla. */
export function resolveReference(text, session) {
  const raw = String(text || '').trim();
  if (!/\b(ese|esa|eso|el anterior|la anterior|lo de antes|lo mismo|eso mismo|de nuevo)\b/i.test(raw)) return raw;
  const topics = (session?.topics || []).filter(Boolean).slice(-3);
  if (!topics.length) return raw;
  return `${raw}\n(Se refiere a: ${topics.join(', ')}.)`;
}

const STYLES = {
  directo: 'Respondé en dos frases como máximo. Andá al grano y dime la acción concreta.',
  estrategico: 'Respondé con una recomendación, el motivo y el riesgo principal. Pensá en márgenes y en el próximo paso.',
  serio: 'Respondé con precisión, sin adornos. Si no sabés algo, decilo.',
};

export function dialogueHint(style = 'serio') {
  return [
    'MANTENÉ UN DIÁLOGO SERIO, FLEXIBLE Y PROFESIONAL:',
    '- Seguí el hilo de la conversación. Si el dueño usa "ese" o "lo de antes", usá el tema de la charla.',
    '- Si falta un dato para actuar, hacé UNA pregunta concreta con opciones en vez de asumirlo.',
    '- Diferenciá hechos verificados de supuestos. Decí de dónde sale cada número.',
    '- No prometas ventas, plazos ni envíos que no estén en los datos de Lucian.',
    '- Respondé en español rioplatense neutro, sin emojis y sin halagos.',
    '- Si el dueño te corrige, adoptá la corrección y no vuelvas al valor anterior.',
    '- Si el dueño pide una acción irreversible (enviar, lanzar misión, cobrar), confirmala antes.',
    STYLES[String(style)] || STYLES.serio,
  ].join('\n');
}

export function helpText() {
  return [
    'Agente de Lucian · ayuda',
    '',
    'Comandos: /start, /help, /estado, /misiones, /resumen, /perfil, /olvidar, /pausar, /activar, /reiniciar.',
    '',
    'Puedo informarte y ejecutar acciones sobre tus datos reales:',
    '· /estado — misiones activas, leads calientes y borradores listos',
    '· /misiones — últimas misiones y su estado',
    '· /resumen — resumen del día',
    '· /pausar y /activar — avisos',
    '· /perfil — lo que aprendí de tus preferencias y reglas',
    '· /olvidar [tema] — borrar una entrada o toda la memoria aprendida',
    '· /reiniciar — borrar el historial de esta charla',
    '',
    'También podés escribirme libremente: “¿qué lámpara conviene empujar este mes?”, “prepará una respuesta para X” o “buscá tiendas en Madrid”. Si falta un dato, te lo pregunto.',
    '',
    'Nunca envío nada sin tu confirmación. Los límites diarios y la política única se respetan igual desde acá.',
  ].join('\n');
}
