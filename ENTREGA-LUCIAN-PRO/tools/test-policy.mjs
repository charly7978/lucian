import os from 'node:os';
import path from 'node:path';
import fsSync from 'node:fs';
process.env.LUCIAN_DATA_DIR = fsSync.mkdtempSync(path.join(os.tmpdir(), 'lucian-policy-test-'));

import { Store } from '../lib/store.mjs';
import {
  AUTO_APPROVABLE_KINDS, POLICY_VERSION, applyPolicyToThreads, approvePolicyPatch,
  isPolicyActive, maybeAutoApproveDraft, policyConfig, policyFingerprint,
  policyStatus, revokePolicyPatch,
} from '../lib/policy.mjs';

let passed = 0;
const dirs = [];
function ok(condition, label, detail = '') {
  if (!condition) {
    console.error(`FALLO: ${label}${detail ? ` — ${detail}` : ''}`);
    process.exitCode = 1;
    throw new Error(label);
  }
  passed += 1;
  console.log(`OK ${label}`);
}

async function freshStore() {
  const dir = path.join(os.tmpdir(), `lucian-policy-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  dirs.push(dir);
  const store = new Store(dir);
  await store.init();
  return store;
}

function baseSettings() {
  return {
    brand: { name: 'Lumbre', country: 'España' },
    mission: { tone: 'cercano, experto', markets: ['España', 'México'], maxProspects: 12 },
    email: {
      provider: 'resend', resendKey: 're_prueba', dailyLimit: 20,
      autopilotSpacingMin: 5, followUps: true, autopilot: false,
    },
    policy: {
      enabled: false, approvedAt: null, fingerprint: '',
      autoApproveKinds: [...AUTO_APPROVABLE_KINDS], allowRedteamRisk: false,
    },
  };
}

function approved(settings) {
  return { ...settings, policy: { ...settings.policy, ...approvePolicyPatch(settings) } };
}

function draft(kind, extra = {}) {
  return { id: 'drf_1', status: 'revisar', channel: 'email', source: 'mision', reviewKind: kind, ...extra };
}

function thread(contact = { email: 'compras@hotel-ejemplo.com', company: 'Hotel Ejemplo' }) {
  return { id: 'thr_1', contact, drafts: [] };
}

/* 1. La política se activa solo con aprobación y huella vigente. */
{
  const settings = baseSettings();
  ok(!isPolicyActive(settings), 'sin aprobar, el modo automático está apagado');
  const active = approved(settings);
  ok(isPolicyActive(active), 'aprobar la política activa el modo automático');
  ok(active.policy.fingerprint === policyFingerprint(policyConfig(active)), 'la huella guardada coincide con la configuración');
  ok(active.policy.version === undefined && POLICY_VERSION === 1, 'la versión de política es estable');
}

/* 2. Cambiar una regla la desactiva sola. */
{
  const active = approved(baseSettings());
  const changed = { ...active, mission: { ...active.mission, markets: ['México'] } };
  ok(!isPolicyActive(changed), 'cambiar mercados desactiva la política');
  ok(policyStatus(changed, null).matches === false, 'el estado informa que la política cambió');
  ok(policyStatus(changed, null).warnings.some((w) => /cambió/i.test(w)), 'avisa que hay que reaprobar');
}

/* 3. Auto-aprueba avisos de verificación, pero nunca bloqueos duros. */
{
  const settings = approved(baseSettings());
  for (const kind of AUTO_APPROVABLE_KINDS) {
    const d = draft(kind);
    ok(maybeAutoApproveDraft(d, thread(), settings), `auto-aprueba aviso ${kind}`);
    ok(d.status === 'listo' && d.approvedBy === 'política única' && d.autoApproved === true, `${kind} queda trazado como auto-aprobado`);
    ok(typeof d.approvedAt === 'string', `${kind} registra cuándo se aprobó`);
  }
  for (const kind of ['cumplimiento', 'revision-faltante', 'sin-mensaje', 'operacion-supervisada', 'bloqueado']) {
    const d = draft(kind);
    ok(!maybeAutoApproveDraft(d, thread(), settings), `NO auto-aprueba bloqueo ${kind}`);
    ok(d.status === 'revisar', `${kind} sigue en revisión`);
  }
  const locked = draft('nombre', { lockedReview: true });
  ok(!maybeAutoApproveDraft(locked, thread(), settings), 'NO auto-aprueba revisión bloqueada por migración');
  const quote = draft('nombre', { source: 'cotizacion' });
  ok(!maybeAutoApproveDraft(quote, thread(), settings), 'NO auto-aprueba cotizaciones (precio se revisa)');
}

/* 4. El red team solo se auto-aprueba si el dueño lo autorizó explícitamente. */
{
  const settings = approved(baseSettings());
  const d = draft('redteam');
  ok(!maybeAutoApproveDraft(d, thread(), settings), 'red team requiere autorización explícita');
  const opted = baseSettings();
  opted.policy.allowRedteamRisk = true;
  const active = approved(opted);
  ok(policyConfig(active).autoApproveKinds.includes('redteam'), 'la autorización entra en la política firmada');
  const d2 = draft('redteam');
  ok(maybeAutoApproveDraft(d2, thread(), active), 'con autorización expresa se auto-aprueba');
}

/* 5. Supresiones y consentimiento: la política no las salta. */
{
  const settings = approved(baseSettings());
  const suppressed = thread({ email: 'baja@hotel.com', company: 'Hotel Baja' });
  const d = draft('nombre');
  ok(!maybeAutoApproveDraft(d, suppressed, settings, {
    suppressions: [{ email: 'baja@hotel.com' }],
  }), 'NO auto-aprueba contactos en lista de no contactar');

  const noConsent = thread();
  const d2 = draft('nombre');
  noConsent.drafts = [d2];
  maybeAutoApproveDraft(d2, noConsent, settings);
  const fakeStore = { get: (name) => (name === 'threads' ? [noConsent] : []), settings: () => settings };
  const status = policyStatus(settings, fakeStore);
  ok(status.counts.autoApproved === 1, 'cuenta borradores auto-aprobados');
  ok(status.counts.missingConsent === 1, 'advierte borradores sin consentimiento documentado');
}

/* 6. Aplicar la política a hilos existentes persiste el cambio. */
{
  const store = await freshStore();
  const base = store.settings();
  const t = thread();
  t.drafts = [draft('conocimiento'), draft('cumplimiento')];
  await store.set('threads', [t]);
  const saved = await store.saveSettings({ policy: approvePolicyPatch(base) }, { allowPolicyApproval: true });
  ok(saved.policy.enabled === true && isPolicyActive(store.settings()), 'la API de política guarda aprobación y huella');
  const result = await applyPolicyToThreads(store, store.settings());
  ok(result.approved === 1, 'aplica la política solo al borrador permitido');
  const persisted = store.get('threads')[0].drafts;
  ok(persisted[0].status === 'listo' && persisted[1].status === 'revisar', 'los cambios se persisten');

  const revoked = revokePolicyPatch();
  const off = await store.saveSettings({ policy: revoked }, { allowPolicyApproval: true });
  ok(!isPolicyActive(off), 'revocar desactiva el modo automático');
}

/* 7. Un PUT genérico a /api/settings NO puede activar el modo automático. */
{
  const store = await freshStore();
  const settings = store.settings();
  const patch = approvePolicyPatch(settings);
  await store.saveSettings({ policy: patch });
  const after = store.settings();
  ok(after.policy.enabled === false && !after.policy.fingerprint, 'un PUT normal no activa la política');
  ok(after.policy.autoApproveKinds.length === AUTO_APPROVABLE_KINDS.length, 'los tipos auto-aprobables se conservan');
}

for (const dir of dirs) {
  try { await import('node:fs/promises').then((fs) => fs.rm(dir, { recursive: true, force: true })); } catch { /* noop */ }
}
console.log(`\nPolítica única: ${passed} comprobaciones OK`);
