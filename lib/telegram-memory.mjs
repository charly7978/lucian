/* ============================================================
   Memoria del agente de Telegram.

   Diseño basado en la arquitectura de observación → reflexión →
   recuperación (Park et al., "Generative Agents", arXiv:2304.03442)
   y en el patrón de memoria de agentes LLM (Zhang et al., survey
   arXiv:2404.13501): registrar observaciones, sintetizar reglas de
   nivel superior y recuperar solo lo relevante para cada turno.

   Todo es local, auditable y determinista: no se inventa memoria.
   ============================================================ */
import { generateJson, isAIReady, resolveAIConfig } from './ai.mjs';
import { asNumber, asObject, asString, nowISO, truncate } from './util.mjs';

export const MEMORY_VERSION = 2;
export const MEMORY_TYPES = ['preferencia', 'restriccion', 'objetivo', 'hecho', 'correccion'];
const MAX_MEMORIES = 60;
const MAX_VALUE = 240;
const MAX_AI_MEMORIES = 4;

const PATTERNS = [
  { type: 'restriccion', re: /\b(no\s+(quiero|deseo|voy a)|nunca|evit[aá]|prohibid|sin\s+consentimiento|no\s+env[ií]es|no\s+hagas)\b/i },
  { type: 'preferencia', re: /\b(prefiero|me\s+gust(a|an)|me\s+interesa|trabajo\s+con|vendo\s+a|mi\s+(nicho|mercado)|siempre|por\s+defecto)\b/i },
  { type: 'objetivo', re: /\b(quiero|necesito|objetivo|meta|este\s+mes|esta\s+semana|apunto\s+a)\b/i },
  { type: 'hecho', re: /\b(mi\s+(precio|margen|plazo|capacidad|producci[oó]n)(?:\s+[a-záéíóúñ]+){0,2}\s+(es|de|en)|cuesta|vale|puedo\s+hacer|tardo)\b/i },
];

/* El límite de palabra no puede ir después de una coma: "no," termina en un
   carácter no alfanumérico y `\b` no encuentra transición. Por eso cada
   alternativa lleva su propio ancla. */
const CORRECTION = /(?:\bno\s*[,:]|\bno\s+es\b|\ben\s+realidad\b|\bcorrecci[oó]n\b|\bmejor\s+dije\b|\bolvid[áa]\b|\bcambio\s+de\s+idea\b|\bequivocad)/i;
const STOP_WORDS = new Set([
  'de', 'la', 'el', 'los', 'las', 'un', 'una', 'que', 'para', 'por', 'con', 'del', 'al',
  'y', 'o', 'en', 'es', 'se', 'me', 'mi', 'lo', 'su', 'sus', 'no', 'si', 'qué', 'como',
  'cómo', 'cuál', 'cuando', 'donde', 'the', 'and', 'for', 'with',
]);

function tokens(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
}

export function prepareMemory(session) {
  const s = session || {};
  s.memory = Array.isArray(s.memory) ? s.memory : [];
  s.reflection = typeof s.reflection === 'string' ? s.reflection : '';
  s.memoryVersion = MEMORY_VERSION;
  return s;
}

function memoryEntry({ type, value, confidence = 0.7, evidence = '', supersedes = null }) {
  return {
    id: `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    type: MEMORY_TYPES.includes(type) ? type : 'hecho',
    value: truncate(String(value || '').trim(), MAX_VALUE),
    confidence: Math.min(1, Math.max(0, Number(confidence) || 0.7)),
    evidence: truncate(String(evidence || value || '').trim(), MAX_VALUE),
    capturedAt: nowISO(),
    supersedes,
  };
}

/* Convierte una frase del dueño en una memoria estructurada. Es el respaldo
   local para cuando no hay IA: no guarda texto libre sin patrón, así evita
   "aprender" ruido o secretos. */
export function extractMemory(text) {
  const clean = String(text || '').trim().replace(/\s+/g, ' ');
  if (!clean || clean.length > 600) return null;
  const correction = CORRECTION.test(clean);
  const matched = PATTERNS.find((entry) => entry.re.test(clean));
  if (!matched && !correction) return null;
  return memoryEntry({
    type: correction ? 'correccion' : matched.type,
    value: clean,
    confidence: correction ? 0.9 : matched.type === 'hecho' ? 0.8 : 0.7,
    evidence: clean,
  });
}

/* Extracción con el modelo real. El esquema es cerrado: el LLM no puede
   inventar tipos ni guardar campos arbitrarios. Si no hay nada que recordar,
   devuelve una lista vacía y no se escribe memoria. */
const MEMORY_SYSTEM = [
  'Sos el extractor de memoria de un agente comercial que trabaja para el dueño de una marca de lámparas.',
  'Leé el mensaje y extraé SOLO preferencias, restricciones, objetivos o hechos explícitos que sirvan para futuras decisiones.',
  'No inventes, no resumas preguntas, no guardes saludos ni datos sensibles (claves, contraseñas, tarjetas).',
  'Si el dueño corrige algo que dijo antes, usá type "correccion" y escribí el valor nuevo, no el viejo.',
  'Si no hay nada que recordar, devolvé {"memories":[]}.',
].join('\n');

export async function extractMemoriesWithAI(text, { cfg, generate = generateJson } = {}) {
  const clean = String(text || '').trim();
  if (!cfg || !clean || clean.length > 1200) return [];
  const result = await generate(cfg, {
    system: MEMORY_SYSTEM,
    prompt: `MENSAJE DEL DUEÑO:\n"""${clean}"""\n\nDevolvé {"memories":[{"type":"preferencia|restriccion|objetivo|hecho|correccion","value":"texto breve, en primera persona","confidence":0.0}]} con un máximo de ${MAX_AI_MEMORIES} entradas.`,
    temperature: 0.1,
    maxTokens: 700,
    expects: 'object',
    attempts: 2,
  });
  const data = asObject(result?.data);
  const list = Array.isArray(data.memories) ? data.memories : [];
  return list.slice(0, MAX_AI_MEMORIES).map((item) => {
    const type = asString(item?.type).trim().toLowerCase();
    const value = asString(item?.value).trim();
    if (!value || !MEMORY_TYPES.includes(type)) return null;
    return memoryEntry({
      type,
      value,
      confidence: asNumber(item?.confidence, 0.75),
      evidence: clean,
    });
  }).filter(Boolean);
}

/* Registra una entrada y resuelve correcciones: una corrección reemplaza a
   la memoria anterior cuando comparte al menos dos tokens con ella. */
function applyEntry(s, entry) {
  if (entry.type === 'correccion') {
    const targetTokens = new Set(tokens(entry.value));
    const previous = [...s.memory].reverse().find((item) => {
      if (item.supersededAt) return false;
      const shared = tokens(item.value).filter((word) => targetTokens.has(word)).length;
      return shared >= 2;
    });
    if (previous) {
      entry.supersedes = previous.id;
      previous.supersededAt = nowISO();
      entry.type = previous.type;
      entry.value = `Corrección: ${entry.value.replace(/^no[,: ]*/i, '')}`;
    }
  }
  const duplicate = s.memory.find((item) => !item.supersededAt && item.value === entry.value);
  if (duplicate) return false;
  s.memory.unshift(entry);
  s.memory = s.memory.slice(0, MAX_MEMORIES);
  return true;
}

function registerEntries(s, entries) {
  let added = 0;
  for (const entry of entries) {
    if (entry && applyEntry(s, entry)) added += 1;
  }
  if (added) reflect(s);
  return { added, entries: entries.filter(Boolean) };
}

/* Registro local determinista. Se conserva para pruebas y para el respaldo
   sin IA; la conversación real usa `learn`, que prioriza el modelo. */
export function remember(session, text) {
  const s = prepareMemory(session);
  const entry = extractMemory(text);
  if (!entry) return { added: 0, entry: null };
  const result = registerEntries(s, [entry]);
  return { added: result.added, entry: result.added ? entry : null };
}

/* Aprendizaje real del agente: si hay IA configurada, la extracción la hace
   el modelo con JSON estricto. El patrón local queda solo como respaldo
   cuando el proveedor no está disponible o no hay IA. */
export async function learn(session, text, { settings = null, cfg = null, generate = generateJson } = {}) {
  const s = prepareMemory(session);
  const config = cfg || (settings && isAIReady(settings) ? resolveAIConfig(settings) : null);
  let entries = [];
  let source = 'regex-offline';
  if (config) {
    try {
      entries = await extractMemoriesWithAI(text, { cfg: config, generate });
      source = 'llm';
    } catch {
      source = 'regex-fallback';
    }
  }
  if (source !== 'llm') {
    const fallback = extractMemory(text);
    entries = fallback ? [fallback] : [];
  }
  const result = registerEntries(s, entries);
  return { ...result, source };
}

/* Reflexión determinista: agrupa las memorias vigentes por tipo y produce
   una regla de nivel superior que se inyecta en el próximo turno. */
export function reflect(session) {
  const s = prepareMemory(session);
  const active = s.memory.filter((item) => !item.supersededAt);
  if (active.length < 4) return s.reflection;
  const lines = [];
  for (const type of MEMORY_TYPES) {
    const items = active.filter((item) => item.type === type).slice(0, 3);
    if (items.length) lines.push(`${type}: ${items.map((item) => item.value).join(' | ')}`);
  }
  s.reflection = truncate(lines.join('\n'), 1200);
  return s.reflection;
}

/* Recuperación por relevancia + recencia. Complejidad O(n·m) sobre un
   conjunto acotado a 60 elementos, suficiente y predecible. */
export function recall(session, question, limit = 6) {
  const s = prepareMemory(session);
  const wanted = new Set(tokens(question));
  if (!wanted.size) return s.memory.filter((item) => !item.supersededAt).slice(0, limit);
  const now = Date.now();
  return s.memory
    .filter((item) => !item.supersededAt)
    .map((item) => {
      const itemTokens = new Set(tokens(`${item.value} ${item.type}`));
      let overlap = 0;
      for (const word of wanted) if (itemTokens.has(word)) overlap += 1;
      const age = Math.max(0, now - Date.parse(item.capturedAt || 0)) / 86400000;
      return { item, score: overlap * 2 + Number(item.confidence || 0.5) - Math.min(age, 30) * 0.01 };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.item);
}

export function memoryBlock(session, question) {
  const s = prepareMemory(session);
  const relevant = recall(s, question);
  if (!relevant.length && !s.reflection) return '';
  const lines = ['MEMORIA APRENDIDA DEL DUEÑO (usala, no la repitas):'];
  if (s.reflection) lines.push(s.reflection);
  for (const item of relevant) lines.push(`- [${item.type}] ${item.value}`);
  return lines.join('\n');
}

export function profileText(session) {
  const s = prepareMemory(session);
  const active = s.memory.filter((item) => !item.supersededAt);
  if (!active.length) return 'Todavía no aprendí nada explícito sobre tus preferencias. Decime, por ejemplo: "siempre trabajo B2B", "mi margen mínimo es 30%" o "nunca enviés sin consentimiento".';
  const lines = [`Memoria aprendida (${active.length} entradas):`, ''];
  for (const item of active.slice(0, 20)) {
    lines.push(`· [${item.type}] ${item.value}`);
  }
  return lines.join('\n');
}

export function forget(session, match) {
  const s = prepareMemory(session);
  const needle = String(match || '').trim().toLowerCase();
  if (!needle || needle === 'todo') {
    s.memory = [];
    s.reflection = '';
    return { removed: 'todo' };
  }
  const before = s.memory.length;
  s.memory = s.memory.filter((item) => !item.value.toLowerCase().includes(needle));
  reflect(s);
  return { removed: before - s.memory.length };
}
