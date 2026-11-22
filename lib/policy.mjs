/* ============================================================
   Política única: el dueño aprueba UNA VEZ las reglas con las que
   trabajan los agentes y, desde ese momento, los borradores que
   cumplen esas reglas salen sin aprobación individual.

   Qué NO hace (guardas que no se negocian):
   - No salta el consentimiento documentado del destinatario.
   - No aprueba bloqueos de cumplimiento, textos sin mensaje 1:1,
     misiones supervisadas ni cotizaciones (precio siempre se revisa).
   - No toca el límite diario, el calentamiento ni el espaciado.
   - Se desactiva sola si la política cambia: hay que reaprobarla.
   ============================================================ */
import crypto from 'node:crypto';
import { nowISO } from './util.mjs';
import { isSuppressed } from './email.mjs';
import { hasDocumentedOptIn } from './security.mjs';

export const POLICY_VERSION = 1;

/* Advertencias que son solo verificación de comprador o de nombre. */
export const AUTO_APPROVABLE_KINDS = ['conocimiento', 'directorio', 'nombre'];

/* Nunca se auto-aprueban: son bloqueos duros o decisiones comerciales. */
const NEVER_AUTO_APPROVE = new Set([
  'bloqueado', 'cumplimiento', 'revision-faltante', 'sin-mensaje',
  'operacion-supervisada', 'cotizacion',
]);

function asText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

/* La política es el conjunto de reglas que el dueño aprueba. Si cualquiera
   de estos valores cambia, el hash cambia y el modo automático se apaga. */
export function policyConfig(settings) {
  const s = settings || {};
  const markets = (Array.isArray(s.mission?.markets) ? s.mission.markets : [])
    .map((item) => asText(item))
    .filter(Boolean)
    .sort();
  const allowRedteamRisk = Boolean(s.policy?.allowRedteamRisk);
  const requested = Array.isArray(s.policy?.autoApproveKinds)
    ? s.policy.autoApproveKinds
    : AUTO_APPROVABLE_KINDS;
  const candidates = [...requested, ...(allowRedteamRisk ? ['redteam'] : [])];
  const autoApproveKinds = [...new Set(candidates.map((item) => asText(item)).filter((kind) => (
    kind === 'redteam' ? allowRedteamRisk : AUTO_APPROVABLE_KINDS.includes(kind)
  )))].sort();

  return {
    version: POLICY_VERSION,
    brand: asText(s.brand?.name),
    country: asText(s.brand?.country),
    tone: asText(s.mission?.tone),
    markets,
    maxProspects: clampInt(s.mission?.maxProspects, 1, 40, 12),
    dailyLimit: clampInt(s.email?.dailyLimit, 1, 200, 20),
    spacingMin: clampInt(s.email?.autopilotSpacingMin, 1, 120, 5),
    followUps: s.email?.followUps !== false,
    provider: asText(s.email?.provider, 'manual'),
    autoApproveKinds,
    allowRedteamRisk,
  };
}

export function policyFingerprint(config) {
  return crypto.createHash('sha256').update(JSON.stringify(config)).digest('hex');
}

export function isPolicyActive(settings) {
  const policy = settings?.policy || {};
  if (!policy.enabled || !policy.approvedAt || !policy.fingerprint) return false;
  return policy.fingerprint === policyFingerprint(policyConfig(settings));
}

export function approvePolicyPatch(settings) {
  return {
    enabled: true,
    approvedAt: nowISO(),
    fingerprint: policyFingerprint(policyConfig(settings)),
  };
}

export function revokePolicyPatch() {
  return { enabled: false, approvedAt: null, fingerprint: '' };
}

/* Estado completo para la API y la interfaz: si está aprobado, si sigue
   vigente y cuántos borradores ya pasaron sin intervención. */
export function policyStatus(settings, store) {
  const config = policyConfig(settings);
  const fingerprint = policyFingerprint(config);
  const policy = settings?.policy || {};
  const approved = Boolean(policy.approvedAt && policy.fingerprint);
  const matches = approved && policy.fingerprint === fingerprint;
  const active = Boolean(policy.enabled) && matches;
  const warnings = [];

  if (approved && !matches) {
    warnings.push('La política cambió después de aprobarla. Volvé a aprobarla para reactivar el modo automático.');
  }
  if (active) {
    const provider = config.provider;
    const canSend = (provider === 'resend' && Boolean(settings?.email?.resendKey))
      || (provider === 'webhook' && Boolean(settings?.email?.webhookUrl));
    if (!canSend) {
      warnings.push('Los borradores se aprueban solos, pero el correo sigue en modo manual: configurá Resend o webhook para que salgan.');
    } else if (!settings?.email?.autopilot) {
      warnings.push('Falta activar el piloto de envío en Ajustes → Correo.');
    }
  }

  const counts = { listo: 0, revisar: 0, autoApproved: 0, missingConsent: 0 };
  const suppressions = (store?.get('suppressions') || []).filter((item) => !item.demo);
  for (const thread of store?.get('threads') || []) {
    if (thread?.demo) continue;
    for (const draft of thread.drafts || []) {
      if (draft.status === 'listo') counts.listo += 1;
      if (draft.status === 'revisar') counts.revisar += 1;
      if (draft.autoApproved) counts.autoApproved += 1;
      if (draft.status === 'listo' && draft.channel === 'email' && !hasDocumentedOptIn(thread.contact)) {
        if (!isSuppressed(thread.contact?.email, suppressions, thread.contact?.company)) counts.missingConsent += 1;
      }
    }
  }
  if (counts.missingConsent && active) {
    warnings.push(`${counts.missingConsent} borrador(es) listo(s) no tienen consentimiento documentado: el envío automático los va a omitir. Registralo en cada contacto si realmente lo obtuviste.`);
  }

  return {
    enabled: Boolean(policy.enabled),
    approved,
    active,
    matches,
    version: POLICY_VERSION,
    fingerprint,
    approvedFingerprint: policy.fingerprint || '',
    approvedAt: policy.approvedAt || null,
    config,
    counts,
    warnings,
  };
}

/* Aprueba un borrador en revisión cuando la política vigente lo permite.
   Devuelve true si lo cambió (para contarlo en la misión). */
export function maybeAutoApproveDraft(draft, thread, settings, { suppressions = [], now = nowISO() } = {}) {
  if (!isPolicyActive(settings)) return false;
  if (!draft || draft.status !== 'revisar' || draft.channel !== 'email') return false;
  if (draft.lockedReview || draft.source === 'cotizacion') return false;
  const kind = asText(draft.reviewKind);
  if (!kind || NEVER_AUTO_APPROVE.has(kind)) return false;
  const config = policyConfig(settings);
  if (!config.autoApproveKinds.includes(kind)) return false;
  if (isSuppressed(thread?.contact?.email, suppressions, thread?.contact?.company)) return false;

  draft.status = 'listo';
  draft.approvedAt = now;
  draft.approvedBy = 'política única';
  draft.approvedReviewKind = kind;
  draft.autoApproved = true;
  draft.policyFingerprint = settings.policy.fingerprint;
  draft.reviewNote = `Aprobado por la política única (${kind}). Sin aprobación individual.`;
  delete draft.lockedReview;
  return true;
}

/* Pasa todos los borradores pendientes a la política vigente. Se usa al
   aprobarla y también al revalidar, sin volver a ejecutar misiones. */
export async function applyPolicyToThreads(store, settings = store.settings()) {
  const suppressions = (store.get('suppressions') || []).filter((item) => !item.demo);
  const threads = store.get('threads') || [];
  const now = nowISO();
  let approved = 0;
  for (const thread of threads) {
    if (thread?.demo) continue;
    for (const draft of thread.drafts || []) {
      if (maybeAutoApproveDraft(draft, thread, settings, { suppressions, now })) approved += 1;
    }
  }
  if (approved) await store.set('threads', threads);
  return { approved };
}
