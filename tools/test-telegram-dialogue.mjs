import * as dialogue from '../lib/telegram-dialogue.mjs';
import {
  DIALOGUE_VERSION, RECENT_TURNS, confirmReplyMarkup,
  contextTurns, detectIntent, helpText, parseCallback, prepareSession,
  quickReplyMarkup,
} from '../lib/telegram-dialogue.mjs';
import { AGENTS, getAgent, systemFor } from '../lib/prompts.mjs';
import { sendTelegramText } from '../lib/notify.mjs';

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

/* 1. Intenciones deterministas: no gastamos IA en comandos ni saludos. */
ok(detectIntent('/start') === 'start', 'detecta /start');
ok(detectIntent('ayuda') === 'help', 'detecta alias ayuda');
ok(detectIntent('/estado') === 'status', 'detecta /estado');
ok(detectIntent('resumen') === 'summary', 'detecta resumen');
ok(detectIntent('pausar') === 'pause', 'detecta pausar');
ok(detectIntent('hola') === 'greeting', 'detecta saludo');
ok(detectIntent('lanzar') === 'incomplete_action', 'detecta acción incompleta');
ok(detectIntent('¿qué lámpara conviene empujar este mes?') === 'question', 'detecta pregunta abierta');
ok(detectIntent('') === 'empty', 'detecta mensaje vacío');

/* 2. No existen respuestas prefabricadas: el modelo responde hasta los saludos. */
ok(dialogue.clarificationFor === undefined, 'no hay aclaraciones escritas de antemano');
ok(dialogue.dialogueHint('serio').includes('UNA pregunta concreta'), 'el prompt pide una pregunta cuando falta un dato');
ok(dialogue.dialogueHint('serio').includes('No prometas ventas'), 'el prompt prohíbe inventar resultados');

/* 3. Memoria acotada con compresión determinista. */
{
  const session = {
    history: Array.from({ length: 60 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: `turno ${i}` })),
  };
  const prepared = prepareSession(session);
  ok(prepared.history.length === RECENT_TURNS, 'la memoria queda acotada a 24 turnos');
  ok(prepared.summary.includes('turno 0'), 'los turnos antiguas pasan al resumen');
  ok(!prepared.history.some((h) => h.text === 'turno 0'), 'los turnos resumidos salen del historial');
  const turns = contextTurns(prepared);
  ok(turns[0].text.includes('MEMORIA DE LA CHARLA'), 'el contexto inyecta la memoria comprimida');
  ok(!turns.slice(1).some((t) => t.text === 'turno 59'), 'el contexto no repite el último mensaje del dueño');
}

/* 4. Teclados inline y callbacks con payload corto. */
{
  const markup = quickReplyMarkup();
  const buttons = markup.inline_keyboard.flat();
  ok(buttons.length === 4, 'el teclado rápido tiene cuatro botones');
  ok(buttons.every((b) => b.callback_data.length <= 64), 'callback_data dentro del límite de Telegram');
  const confirm = confirmReplyMarkup('abc123');
  ok(parseCallback(confirm.inline_keyboard[0][0].callback_data).kind === 'confirm', 'parsea confirmar');
  ok(parseCallback(confirm.inline_keyboard[0][1].callback_data).kind === 'cancel', 'parsea cancelar');
  ok(parseCallback(markup.inline_keyboard[0][0].callback_data).kind === 'quick', 'parsea acceso rápido');
  ok(parseCallback('basura') === null, 'descarta callbacks desconocidos');
}

/* 5. Ayuda alineada con los comandos globales de Telegram. */
ok(helpText().includes('/start') && helpText().includes('/help'), 'la ayuda lista comandos globales');
ok(DIALOGUE_VERSION === 2, 'versión de diálogo estable');

/* 6. Agente de configuración conservado y accesible. */
{
  ok(Array.isArray(AGENTS) && AGENTS.length >= 12, `el equipo tiene ${AGENTS.length} agentes`);
  const agent = getAgent('configurador');
  ok(agent?.id === 'configurador', 'el asistente de configuración existe');
  ok(systemFor('configurador').includes('Asistente de Configuración'), 'el agente tiene system prompt propio');
}

/* 7. Envío con teclado: la forma del body es la que espera la Bot API. */
{
  const originalFetch = globalThis.fetch;
  let body = null;
  // fetchJson usa fetch: capturamos el cuerpo exacto que recibe la Bot API.
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(init.body);
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      async json() { return { ok: true, result: { message_id: 1 } }; },
      async text() { return JSON.stringify({ ok: true, result: { message_id: 1 } }); },
    };
  };
  try {
    await sendTelegramText(
      { notify: { telegram: { token: '123:abc', chatId: '42' } } },
      ' Probando ',
      { chatId: '42', replyMarkup: quickReplyMarkup() },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  ok(body?.chat_id === '42', 'envía al chat correcto');
  ok(typeof body?.reply_markup === 'string' && body.reply_markup.includes('inline_keyboard'), 'envía reply_markup como JSON string');
}

console.log(`\nDiálogo de Telegram: ${passed} comprobaciones OK`);
