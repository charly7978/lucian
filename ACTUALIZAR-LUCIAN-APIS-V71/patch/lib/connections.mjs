/* Diagnóstico de APIs: tener una clave no implica que el proveedor funcione.
   GET solo muestra configuración; POST de prueba puede consultar proveedores,
   pero nunca envía mensajes, modifica bandejas, crea prospectos ni envía correos. */
import { isAIReady, resolveAIConfig, testAI, testAIConfig } from './ai.mjs';
import { testResend } from './email.mjs';
import { testGmailSmtpAuth } from './smtp.mjs';
import { testGmailImapLogin } from './imap.mjs';
import { searchWebDetailed, searchProviderInfo } from './search.mjs';
import { testTelegram, testWhatsApp } from './notify.mjs';
import { hunterAccount } from './hunter.mjs';

const aiState = { primaryFailures: 0, lastFailureAt: 0, fallbackActive: false, lastError: '' };
const checks = new Map();
const TEST_TTL_MS = 15 * 60 * 1000;

export function getAiFailoverState() { return { ...aiState }; }
export function resetAiFailover() { Object.assign(aiState, {primaryFailures:0,lastFailureAt:0,fallbackActive:false,lastError:''}); }

export function resolveAIWithFallback(settings) {
  const primary = resolveAIConfig(settings);
  const ollama = settings?.fallback?.ollama || {};
  const fallbackEnabled = settings?.fallback?.enabled !== false && ollama.baseUrl && ollama.model;
  const recentFailure = aiState.lastFailureAt && Date.now() - aiState.lastFailureAt < 10 * 60 * 1000;
  if (fallbackEnabled && (!isAIReady(settings) || (recentFailure && aiState.primaryFailures >= 1))) {
    return {
      cfg: {provider:'ollama',baseUrl:ollama.baseUrl,model:ollama.model,apiKey:'',temperature:primary.temperature,maxTokens:primary.maxTokens},
      isFallback:true,
      reason:!isAIReady(settings) ? 'La IA principal no está configurada. Intentando Ollama local.' : 'El proveedor principal falló. Intentando Ollama local.',
    };
  }
  return { cfg:primary, isFallback:false, reason:'' };
}
export function recordAiFailure(error) {
  aiState.primaryFailures++;
  aiState.lastFailureAt = Date.now();
  aiState.lastError = String(error?.message || error || 'fallo').slice(0, 200);
  if (aiState.primaryFailures >= 2) aiState.fallbackActive = true;
}
export function recordAiSuccess() { aiState.primaryFailures = Math.max(0, aiState.primaryFailures - 1); }

function configuredConnections(settings) {
  const email = settings?.email || {};
  const tg = settings?.notify?.telegram || {};
  const wa = settings?.notify?.whatsapp || {};
  const fallback = settings?.fallback || {};
  const search = searchProviderInfo(settings);
  const cfg = resolveAIConfig(settings);
  const from = Boolean(email.from);
  const list = [
    { id:'ai', name:'Inteligencia artificial', configured:isAIReady(settings), detail:`${cfg.provider} · ${cfg.model || 'sin modelo'}` },
    { id:'search', name:'Búsqueda web', configured:search.ready && search.provider !== 'none', detail:search.label },
    { id:'email', name:'Correo saliente', configured:email.provider === 'resend' ? Boolean(email.resendKey && from) : email.provider === 'gmail' ? Boolean(email.smtpUser && email.smtpPassword && from) : false,
      detail:email.provider === 'resend' ? 'Resend: se comprobará remitente y dominio' : email.provider === 'gmail' ? 'Gmail SMTP: autenticación sin envíos' : 'No hay proveedor comprobable seleccionado' },
    { id:'inbox', name:'Correo entrante', configured:email.provider === 'gmail' && Boolean(email.smtpUser && email.smtpPassword), detail:'Gmail IMAP: autenticación sin abrir correos' },
    { id:'telegram', name:'Telegram', configured: Boolean(tg.enabled && tg.token && tg.chatId), detail:'Comprobación del token sin mandar mensajes' },
    { id:'whatsapp', name:'WhatsApp Cloud', configured: Boolean(wa.enabled && wa.token && wa.phoneNumberId), detail:'Valida cuenta y teléfono; la entrega del webhook requiere otra prueba' },
    { id:'hunter', name:'Hunter', configured: Boolean(settings?.hunter?.enabled && settings?.hunter?.apiKey), detail:'Verificación de cuenta y cuota, sin buscar contactos' },
    { id:'fallback', name:'IA de respaldo (Ollama)', configured: Boolean(fallback.enabled !== false && fallback.ollama?.baseUrl && fallback.ollama?.model), detail: fallback.ollama?.model || 'Sin modelo local' },
  ];
  return list;
}

function secretValues(settings) {
  return [
    settings?.ai?.apiKey, settings?.email?.resendKey, settings?.email?.smtpPassword,
    settings?.notify?.telegram?.token,settings?.notify?.whatsapp?.token,
    settings?.hunter?.apiKey,settings?.search?.apiKey,
    process.env.LUCIAN_AI_KEY,process.env.LUCIAN_AI_API_KEY,
    process.env.LUCIAN_RESEND_KEY,process.env.LUCIAN_SEARCH_KEY,
  ].filter(v => typeof v === 'string' && v.length >= 4);
}
export function redactDiagnosticError(error, settings = {}) {
  let message = String(error?.message || error || 'Fallo desconocido').slice(0, 500);
  for (const value of secretValues(settings)) message = message.split(value).join('[OCULTO]');
  message = message.replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [OCULTO]')
    .replace(/(?:re_|sk-)[A-Za-z0-9_-]{12,}/g, '[OCULTO]')
    .replace(/bot\d+:[A-Za-z0-9_-]+/gi, 'bot[OCULTO]');
  return message.slice(0, 250);
}

export async function diagnoseConnections(settings) {
  const connections = configuredConnections(settings).map(item => {
    const last = checks.get(item.id);
    // No extrapolar pruebas antiguas a claves o modelos editados.
    const applicable = last && last.fingerprint === fingerprint(item.id, settings)
      && Date.now() - last.at < TEST_TTL_MS;
    const status = !item.configured ? 'pendiente' : applicable ? (last.ok ? 'verificado' : 'error') : 'configurado';
    return {id:item.id, name:item.name, configured:item.configured, ok:status === 'verificado', status,
      detail: applicable ? last.detail : item.detail, checkedAt:applicable ? new Date(last.at).toISOString() : null};
  });
  return { connections, aiFailover:getAiFailoverState(), note:'Configurado no significa conectado. Verificado dura 15 minutos y requiere un test manual.' };
}

function fingerprint(id, settings) {
  const a = settings?.ai || {};
  const e = settings?.email || {};
  const t = settings?.notify?.telegram || {};
  const w = settings?.notify?.whatsapp || {};
  const search = settings?.search || {};
  const fb = settings?.fallback || {};
  // Firma solo para detección de cambios, nunca se devuelve al cliente.
  const selected = {
    ai:[a.provider,a.model,a.baseUrl,a.apiKey,process.env.LUCIAN_AI_KEY],
    search:[search.provider,search.apiKey,search.searxUrl,process.env.LUCIAN_SEARCH_KEY],
    email:[e.provider,e.from,e.smtpUser,e.smtpPassword,e.resendKey],
    inbox:[e.provider,e.smtpUser,e.smtpPassword],
    telegram:[t.enabled,t.token,t.chatId],
    whatsapp:[w.enabled,w.token,w.phoneNumberId,w.apiVersion],
    hunter:[settings?.hunter?.enabled,settings?.hunter?.apiKey],
    fallback:[fb.enabled,fb.ollama?.baseUrl,fb.ollama?.model],
  };
  return JSON.stringify(selected[id] || []);
}

/** Test explícito. No envía mensajes, no cambia estado de correos ni de productos. */
export async function testConnection(id, settings) {
  const item = configuredConnections(settings).find(row => row.id === id);
  if (!item) return {ok:false,detail:'Integración desconocida',status:'error'};
  let result;
  try {
    if (!item.configured) throw new Error(`Configuración incompleta: ${item.name}. Revisá Ajustes.`);
    if (id === 'ai') {
      const data = await testAI(settings);
      result = {ok:true,detail:`IA respondió correctamente: ${data.provider} · ${data.model}`};
    } else if (id === 'search') {
      const data = await searchWebDetailed(settings, 'tiendas de iluminación de diseño Madrid', {count:2, skipCache:true});
      if (!data.results?.length) throw new Error(data.errors?.[0] || 'El buscador no devolvió resultados reales.');
      const selected = settings.search?.provider || 'duckduckgo';
      if (['tavily', 'brave', 'serper'].includes(selected) && data.engine !== selected) {
        throw new Error(`La API ${selected} NO funcionó. Respondió el buscador alternativo ${data.engine}. ${data.errors?.[0] || ''}`);
      }
      result = {ok:true,detail:`Búsqueda real: ${data.results.length} resultado(s) vía ${data.engine}`};
    } else if (id === 'email') {
      const email = settings.email;
      if (email.provider === 'resend') {
        const data = await testResend(settings);
        if (!data.senderReady) throw new Error(data.fromDomainStatus === 'missing_from'
          ? 'Resend: falta configurar la dirección remitente en Ajustes.'
          : `Resend: el dominio remitente ${data.fromDomain || '(sin dominio)'} figura ${data.fromDomainStatus}. Debe estar verified.`);
        result = {ok:true,detail:`Resend: remitente ${data.fromDomain} con dominio verificado (sin enviar correo).`};
      } else if (email.provider === 'gmail') {
        const data = await testGmailSmtpAuth({user:email.smtpUser,appPassword:email.smtpPassword});
        result = {ok:true,detail:data.detail};
      } else throw new Error('Seleccioná Gmail o Resend en Ajustes.');
    } else if (id === 'inbox') {
      const data = await testGmailImapLogin({user:settings.email.smtpUser,appPassword:settings.email.smtpPassword});
      result = {ok:true,detail:data.detail};
    } else if (id === 'telegram') {
      const data = await testTelegram(settings, {sendMessage:false});
      result = {ok:true,detail:`Bot @${data.bot || 'sin alias'} autenticado. NO se envió mensaje.`};
    } else if (id === 'whatsapp') {
      const data = await testWhatsApp(settings);
      result = {ok:true,detail:'Meta: ID de teléfono autenticado. Webhook entrante todavía no verificado.'};
    } else if (id === 'hunter') {
      const data = await hunterAccount(settings.hunter.apiKey);
      result = {ok:true,detail:`Hunter: cuenta autenticada; créditos: ${data.credits ?? 'sin dato'}.`};
    } else if (id === 'fallback') {
      const ol = settings.fallback.ollama;
      const response = await testAIConfig({provider:'ollama',baseUrl:ol.baseUrl,model:ol.model,apiKey:'',temperature:0,maxTokens:32});
      if (!String(response.reply || '').trim()) throw new Error('Ollama devolvió una respuesta vacía.');
      result = {ok:true,detail:`Ollama local respondió con ${ol.model}.`};
    } else throw new Error('Prueba no implementada.');
  } catch (error) {
    result = {ok:false,detail:redactDiagnosticError(error,settings)};
  }
  checks.set(id,{...result,at:Date.now(),fingerprint:fingerprint(id,settings)});
  return {...result,status:result.ok ? 'verificado' : 'error', checkedAt:new Date().toISOString()};
}
