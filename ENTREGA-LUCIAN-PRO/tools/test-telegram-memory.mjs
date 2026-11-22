import {
  MEMORY_VERSION, extractMemory, forget, learn, memoryBlock, prepareMemory,
  profileText, recall, reflect, remember,
} from '../lib/telegram-memory.mjs';
import { choiceReplyMarkup, dialogueHint, resolveReference } from '../lib/telegram-dialogue.mjs';
import { Notifier } from '../lib/notify.mjs';
import { Store } from '../lib/store.mjs';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

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

/* 1. Extracción: solo aprende frases con patrón, no ruido. */
ok(extractMemory('hola, ¿cómo estás?') === null, 'no aprende un saludo');
ok(extractMemory('prefiero trabajar solo con hoteles B2B')?.type === 'preferencia', 'aprende una preferencia');
ok(extractMemory('nunca envíes sin consentimiento')?.type === 'restriccion', 'aprende una restricción');
ok(extractMemory('mi margen mínimo es 30%')?.type === 'hecho', 'aprende un hecho');
ok(extractMemory('este mes quiero cerrar 3 distribuidores')?.type === 'objetivo', 'aprende un objetivo');
ok(extractMemory('no, en realidad vendo a mayoristas')?.type === 'correccion', 'detecta una corrección');

/* 2. Memoria persistente, dedupe y correcciones que reemplazan. */
{
  const session = { memory: [], reflection: '' };
  remember(session, 'prefiero hoteles boutique');
  remember(session, 'prefiero hoteles boutique');
  ok(session.memory.length === 1, 'no duplica la misma memoria');
  remember(session, 'nunca envíes sin consentimiento');
  remember(session, 'mi margen mínimo es 30%');
  remember(session, 'este mes quiero distribuidores');
  ok(reflect(session).includes('preferencia:'), 'la reflexión agrupa por tipo');
  const before = session.memory.length;
  remember(session, 'no, prefiero distribuidores, no hoteles');
  ok(session.memory.length === before + 1, 'la corrección se guarda como entrada nueva');
  ok(session.memory.some((m) => m.supersedes), 'la corrección referencia a la memoria anterior');
  ok(session.memory.some((m) => m.supersededAt), 'la memoria anterior queda marcada como superada');
  ok(prepareMemory(session).memoryVersion === MEMORY_VERSION, 'la memoria queda versionada');
}

/* 3. Recuperación por relevancia: recuerda lo que aplica a la pregunta. */
{
  const session = { memory: [], reflection: '' };
  remember(session, 'prefiero hoteles boutique en España');
  remember(session, 'mi margen mínimo es 30 por ciento');
  remember(session, 'nunca envíes correos sin consentimiento');
  const found = recall(session, '¿qué margen uso para los hoteles?');
  ok(found.length > 0 && found[0].value.includes('margen'), 'recupera primero la memoria relevante');
  const block = memoryBlock(session, 'hoteles');
  ok(block.includes('MEMORIA APRENDIDA'), 'el bloque se inyecta al prompt');
  ok(block.includes('hoteles'), 'el bloque incluye el recuerdo pertinente');
  ok(profileText(session).includes('entradas'), 'el perfil muestra lo aprendido');
}

/* 4. Olvidar: por tema o todo. */
{
  const session = { memory: [], reflection: '' };
  remember(session, 'prefiero hoteles boutique');
  remember(session, 'nunca envíes sin consentimiento');
  const partial = forget(session, 'hoteles');
  ok(partial.removed === 1, 'borra una entrada por tema');
  forget(session, 'todo');
  ok(session.memory.length === 0 && session.reflection === '', 'borra toda la memoria');
}

/* 5. Diálogo flexible: estilos, referencias y opciones. */
ok(dialogueHint('directo').includes('dos frases'), 'el estilo directo cambia la instrucción');
ok(dialogueHint('estrategico').includes('riesgo'), 'el estilo estratégico pide riesgo');
ok(resolveReference('hacé lo mismo', { topics: ['misions de hoteles'] }).includes('misions de hoteles'), 'resuelve "lo mismo" con el tema');
ok(resolveReference('hacé lo mismo', { topics: [] }) === 'hacé lo mismo', 'sin tema no inventa referencia');
{
  const markup = choiceReplyMarkup([{ text: 'Ver estado', value: 'estado' }, { text: 'Ayuda', value: 'help' }]);
  ok(markup.inline_keyboard.flat().every((b) => b.callback_data.length <= 64), 'las opciones caben en callback_data');
}

/* 6. Integración real: el dueño enseña una regla y el agente la conserva. */
{
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lucian-memory-'));
  const store = new Store(dir);
  await store.init();
  store.get('settings').notify.telegram = { enabled: true, token: 't', chatId: '42', style: 'serio' };
  await store.saveSettings(store.get('settings'));
  let askCalls = 0;
  const notifier = new Notifier({ store, ask: async () => { askCalls += 1; return 'Respuesta del modelo.'; }, actions: {} });

  // Un saludo NO se responde con texto prefabricado: llega al agente (LLM).
  const greeting = await notifier.handleOwnerText('hola', 'telegram', '42');
  ok(askCalls === 1, 'el saludo libre se consulta con el modelo');
  ok(greeting === 'Respuesta del modelo.', 'la respuesta del saludo es la del modelo, no una frase fija');

  await notifier.handleOwnerText('prefiero trabajar solo con hoteles B2B', 'telegram', '42');
  await notifier.handleOwnerText('/perfil', 'telegram', '42');
  const session = store.get('telegramSessions')['42'];
  ok(session.memory.some((m) => m.type === 'preferencia' && m.value.includes('hoteles')), 'aprendió la preferencia del dueño');
  ok(store.settings().notify.telegram.style === 'serio', 'el estilo se conserva en ajustes');
  await fs.rm(dir, { recursive: true, force: true });
}

/* 7. El aprendizaje real usa el modelo; el patrón es solo respaldo. */
{
  const session = prepareMemory({ memory: [], reflection: '' });
  let generateCalls = 0;
  const generate = async () => {
    generateCalls += 1;
    return { data: { memories: [{ type: 'restriccion', value: 'nunca contactar sin consentimiento', confidence: 0.9 }] } };
  };
  const result = await learn(session, 'nunca me contactes sin consentimiento', {
    cfg: { provider: 'openai', baseUrl: 'https://example.test/v1', model: 'x' },
    generate,
  });
  ok(generateCalls === 1, 'aprender con IA llama al modelo');
  ok(result.source === 'llm', 'la extracción se marca como proveniente del LLM');
  ok(session.memory[0]?.type === 'restriccion', 'guarda el tipo que devolvió el modelo');

  const fallbackSession = prepareMemory({ memory: [], reflection: '' });
  const fallback = await learn(fallbackSession, 'prefiero hoteles boutique', {
    cfg: { provider: 'openai', baseUrl: 'https://example.test/v1', model: 'x' },
    generate: async () => { throw new Error('sin saldo'); },
  });
  ok(fallback.source === 'regex-fallback', 'si el modelo falla, queda registrado el respaldo');
  ok(fallbackSession.memory[0]?.type === 'preferencia', 'el respaldo sigue aprendiendo patrones claros');
}

console.log(`\nMemoria del agente: ${passed} comprobaciones OK`);
