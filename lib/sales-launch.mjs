import { productReadiness } from './readiness.mjs';

const RECENT_DAYS = 7;
const BLOCKING_STATUSES = new Set(['queued', 'running', 'done', 'done_with_warnings']);
const ACTIVE_STATUSES = new Set(['queued', 'running']);
const DAY_MS = 86400000;

function marketKey(value) {
  return String(value || '').trim().normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

export function supervisedMissionPreflight({ products = [], missions = [], settings = {}, aiReady = false, searchInfo = {}, now = Date.now() } = {}) {
  const reasons = [];
  const warnings = [];
  const timestamp = Number(now);
  const markets = (Array.isArray(settings.mission?.markets) ? settings.mission.markets : [])
    .map(value => String(value || '').trim()).filter(Boolean).slice(0, 6);
  if (!aiReady) reasons.push('Falta configurar una IA real en Ajustes → Inteligencia artificial. No se utilizará una demostración.');
  if (!markets.length) reasons.push('Elegí al menos un mercado en Ajustes → Misiones.');
  if (!searchInfo.provider || searchInfo.provider === 'none' || searchInfo.ready !== true) reasons.push('Configurá un motor de búsqueda disponible en Ajustes → Búsqueda.');
  if (searchInfo.provider === 'duckduckgo') warnings.push('La búsqueda pública puede fallar o limitar consultas: verificá los resultados de la misión.');
  if (missions.some(m => !m.demo && ACTIVE_STATUSES.has(m.status))) reasons.push('Ya hay una misión real en ejecución o en cola: terminá esa antes de lanzar otra.');
  const recentMarkets = new Map();
  for (const mission of missions) {
    const age = timestamp - Date.parse(mission.createdAt || '');
    if (mission.demo || !BLOCKING_STATUSES.has(mission.status)
      || !Number.isFinite(age) || age < 0 || age >= RECENT_DAYS * DAY_MS) continue;
    const previous = recentMarkets.get(mission.productId) || new Set();
    const keys = (Array.isArray(mission.markets) ? mission.markets : []).map(marketKey).filter(Boolean);
    // Una misión antigua sin mercados registrados conserva la protección.
    for (const key of keys.length ? keys : ['']) previous.add(key);
    recentMarkets.set(mission.productId, previous);
  }
  const active = products.filter(p => p && p.id && !p.demo && p.status !== 'archivado');
  const eligible = active.map(product => {
    const previous = recentMarkets.get(product.id);
    const availableMarkets = previous?.has('') ? [] : markets.filter(market => !previous?.has(marketKey(market)));
    return { product, readiness: productReadiness(product), availableMarkets };
  })
    .filter(item => item.readiness.readyForProspecting && item.availableMarkets.length)
    .sort((a, b) => b.readiness.score - a.readiness.score
      || Number(b.product.status === 'listo') - Number(a.product.status === 'listo')
      || String(a.product.name || '').localeCompare(String(b.product.name || '')));
  const candidates = eligible.slice(0, 15)
    .map(item => ({ id: item.product.id, name: item.product.name, score: item.readiness.score }));
  const recent = [...recentMarkets.values()].filter(previous => previous.has('')
    || (markets.length && markets.every(market => previous.has(marketKey(market))))).length;
  const unready = active.filter(p => !productReadiness(p).readyForProspecting).length;
  if (!eligible.length) reasons.push(active.length
    ? 'No hay lámparas nuevas listas: completá fichas o esperá a que venza el intervalo de 7 días para repetir la prospección.'
    : 'No hay lámparas activas disponibles.');
  return {
    canStart: !reasons.length, reasons, warnings, markets: eligible[0]?.availableMarkets || markets,
    candidate: candidates[0] || null, candidates,
    eligible: eligible.length, unready, recent,
    activeMissions: missions.filter(m => !m.demo && ACTIVE_STATUSES.has(m.status)).length,
    maximumProspects: 8, mode: 'real',
    guarantee: 'Revisión humana obligatoria de cada borrador. Esta acción NO envía mensajes ni confirma ventas.'
  };
}

export function scheduledB2BPlan(input, lastAttempt) {
  if (input.settings?.mission?.scheduledB2B !== true) return { enabled: false };
  const { canStart, candidate, markets, reasons } = supervisedMissionPreflight(input);
  const next = Date.parse(lastAttempt) + DAY_MS;
  const waiting = next > (input.now ?? Date.now());
  return {
    enabled: true,
    canStart: canStart && !waiting,
    candidate,
    markets: markets.slice(0, 1),
    reasons,
    nextAt: waiting ? new Date(next).toISOString() : null,
    lastAttempt: lastAttempt || null,
  };
}

export async function runScheduledB2B(store, { createMission, aiReady, searchInfo, now = Date.now() }) {
  const settings = store.settings();
  const plan = scheduledB2BPlan({
    settings, now, products: store.get('products'), missions: store.get('missions'),
    aiReady: aiReady(settings), searchInfo: searchInfo(settings),
  }, store.get('meta').lastScheduledB2B);
  if (!plan.canStart) return null;

  // Reservá el turno antes de llamar a los agentes, incluso si se reinicia
  // el servidor o el proveedor falla. El disparo manual comparte el turno.
  await store.setMeta({ lastScheduledB2B: new Date(now).toISOString() });
  if (store.settings().mission?.scheduledB2B !== true
    || store.get('missions').some(mission => !mission.demo && ACTIVE_STATUSES.has(mission.status))) return null;
  return createMission({
    productId: plan.candidate.id,
    name: `${plan.candidate.name} · hoteles y mayoristas`,
    markets: plan.markets,
    mode: 'real',
    depth: 'estandar',
    goal: 'conseguir-mayoristas',
    maxProspects: settings.mission.maxProspects,
    notes: 'Prospección B2B. Buscá hoteles con encaje en decoración y distribuidores mayoristas de iluminación o diseño. Justificá el encaje de cada empresa con la lámpara y el mercado. Priorizá compras corporativas y pedidos por volumen.',
  }, { b2bFocus: true });
}
