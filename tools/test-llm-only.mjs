/* ============================================================
   Contrato "solo LLM": ningún agente del equipo responde con texto
   escrito de antemano, ningún módulo de IA está en Python y los 12
   especialistas pasan por el mismo proveedor de lenguaje real.
   El proveedor se simula SOLO en esta prueba para comprobar que la
   llamada ocurre; el sistema en producción no trae esta respuesta.
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENTS, systemFor } from '../lib/prompts.mjs';
import { askTeam } from '../lib/agents.mjs';
import { isAIReady } from '../lib/ai.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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

/* 1. No hay agentes Python ni respuestas prefabricadas en el árbol activo. */
const IGNORED = new Set(['node_modules', '.git', 'data', 'backups', 'LEGACY', 'ACTUALIZAR-LUCIAN-APIS-V71', 'ACTUALIZAR-LUCIAN-AGENDA']);
const pythonFiles = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.py')) pythonFiles.push(full);
  }
}
walk(root);
ok(pythonFiles.length === 0, `no hay módulos .py en el sistema vigente (${pythonFiles.length})`);

const agentsSource = fs.readFileSync(path.join(root, 'lib', 'agents.mjs'), 'utf8');
const demoSource = fs.readFileSync(path.join(root, 'lib', 'demo.mjs'), 'utf8');
ok(!/export\s+(?:async\s+)?function\s+demoAsk\b/.test(demoSource), 'demoAsk fue eliminado: no existe respuesta simulada de agente');
ok(!agentsSource.includes('demoAsk'), 'ningún agente importa ni llama a demoAsk');
ok(!agentsSource.includes('offlineStatusAnswer'), 'no hay resumen "sin IA" disfrazado de respuesta del agente');
ok(!/demo:\s*true/.test(agentsSource.slice(agentsSource.indexOf('export async function askTeam'))), 'askTeam nunca devuelve demo:true');

/* 2. Los 12 especialistas tienen prompt propio y distinto. */
ok(AGENTS.length === 12, `el equipo tiene exactamente 12 agentes (${AGENTS.length})`);
const systems = AGENTS.map((agent) => systemFor(agent.id));
ok(new Set(systems).size === 12, 'cada agente tiene su propio system prompt');
ok(systems.every((text) => text && text.length > 80), 'todos los prompts son sustantivos');

/* 3. Sin proveedor, preguntar al equipo falla con código accionable. */
function makeStore(settings) {
  const data = {
    products: [], missions: [], threads: [], learnings: [], activity: [], settings,
  };
  const tracked = [];
  return {
    tracked,
    settings: () => settings,
    get: (key) => data[key] || [],
    activity: async () => {},
    trackAgent: async (id) => { tracked.push(id); },
  };
}

const noAiStore = makeStore({ ai: {}, brand: { name: 'Lucian' } });
ok(!isAIReady(noAiStore.settings()), 'la prueba sin IA efectivamente no tiene proveedor');
let requiredError = null;
try {
  await askTeam({ question: 'hola', store: noAiStore });
} catch (error) {
  requiredError = error;
}
ok(requiredError?.code === 'AI_REQUIRED', 'sin IA el error es AI_REQUIRED');
ok(requiredError?.status === 409, 'sin IA se devuelve 409');
ok(/modelo de lenguaje real/.test(requiredError?.message || ''), 'el error explica que se necesita un modelo real');

/* 4. Con proveedor, LOS 12 agentes llaman al modelo y devuelven su texto. */
const aiSettings = {
  ai: { provider: 'openai', apiKey: 'sk-test', model: 'modelo-de-prueba', baseUrl: 'https://api.openai.com/v1' },
  brand: { name: 'Lucian' },
};
const store = makeStore(aiSettings);
ok(isAIReady(aiSettings), 'la prueba con IA tiene proveedor configurado');

const originalFetch = globalThis.fetch;
const calls = [];
let answerForModel = 'RESPUESTA GENERADA POR EL MODELO EN ESTA PRUEBA';
let finishReason = 'stop';
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers });
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({
        choices: [{ message: { content: answerForModel }, finish_reason: finishReason }],
        usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 },
      });
    },
  };
};

try {
  for (const agent of AGENTS) {
    calls.length = 0;
    const result = await askTeam({ question: '¿qué me recomendás?', agentId: agent.id, store });
    ok(calls.length === 1, `${agent.id} hace una llamada al proveedor`);
    ok(calls[0].url.includes('/chat/completions'), `${agent.id} usa el endpoint de chat`);
    ok(calls[0].body.messages[0].content === systemFor(agent.id), `${agent.id} envía su system prompt, no uno genérico`);
    ok(result.answer === answerForModel, `${agent.id} devuelve el texto del modelo`);
    ok(result.demo === false, `${agent.id} no se marca como demo`);
  }
  ok(store.tracked.length === 12, 'los 12 agentes registran su uso');

  /* 5. Si el modelo no da texto, se informa el fallo: nunca se inventa una respuesta. */
  answerForModel = '';
  finishReason = 'length';
  calls.length = 0;
  let unavailable = null;
  try {
    await askTeam({ question: 'hola', agentId: 'director', store });
  } catch (error) {
    unavailable = error;
  }
  ok(unavailable?.code === 'AI_UNAVAILABLE', 'un fallo del modelo produce AI_UNAVAILABLE');
  ok(unavailable?.status === 502, 'el fallo del modelo se traduce en 502');
  ok(/No hay respuesta simulada/.test(unavailable?.message || ''), 'el mensaje descarta explícitamente respuestas simuladas');

  /* 6. Respuesta vacía del modelo tampoco se rellena con texto propio. */
  answerForModel = '   \n';
  finishReason = 'stop';
  let empty = null;
  try {
    await askTeam({ question: 'hola', agentId: 'director', store });
  } catch (error) {
    empty = error;
  }
  ok(empty?.code === 'AI_EMPTY', 'una respuesta vacía se rechaza con AI_EMPTY');
} finally {
  globalThis.fetch = originalFetch;
}

console.log(`\nSolo LLM: ${passed} comprobaciones OK`);
