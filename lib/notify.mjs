import crypto from 'node:crypto';
import { fetchJson, sleep, truncate } from './util.mjs';
import {
  DIALOGUE_VERSION, RECENT_TURNS,
  contextTurns, confirmReplyMarkup, detectIntent, dialogueHint, helpText,
  parseCallback, prepareSession, quickReplyMarkup,
  rememberTopic, resolveReference,
} from './telegram-dialogue.mjs';
import { MEMORY_VERSION, forget, learn, memoryBlock, prepareMemory, profileText } from './telegram-memory.mjs';

/* ─────────────────────────────────────────────────────────────
   Avisos al dueño. La regla es simple: interrumpir solo cuando
   hay algo que decidir. El resto va al resumen diario.
   ───────────────────────────────────────────────────────────── */

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

export class Notifier {
  constructor({ store, ask, actions = {} }) {
    this.store = store;
    this.ask = ask;
    this.actions = actions || {};
    this.generation = 0;
    this.polling = false;
    this.timer = null;
    this.lastError = '';
    this.started = false;
  }

  start() {
    this.started = true;
    this.refresh();
    if (!this.timer) {
      this.timer = setInterval(() => this.maybeDigest().catch(() => {}), 10 * 60 * 1000);
      this.timer.unref?.();
    }
    setTimeout(() => this.maybeDigest().catch(() => {}), 45 * 1000).unref?.();
  }

  stop() {
    this.generation += 1;
    this.started = false;
    this.polling = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // Arranca el loop de Telegram con la generación y la configuración vigentes.
  //Si ya hay un loop activo, no hace nada: ese loop se detendrá solo al
  //detectar el cambio de generación y volverá a llamar a este método.
  startPolling() {
    if (!this.started || this.polling) return;
    const settings = this.store.settings();
    if (!settings.notify?.telegram?.enabled) return;
    if (!settings.notify.telegram.token || !settings.notify.telegram.chatId) return;
    this.pollTelegram(this.generation).catch(() => {});
  }

  refresh() {
    this.generation += 1;
    this.startPolling();
  }

  channels(settings = this.store.settings()) {
    return {
      telegram: Boolean(settings.notify?.telegram?.enabled && settings.notify?.telegram?.token && settings.notify?.telegram?.chatId),
      whatsapp: Boolean(settings.notify?.whatsapp?.enabled && settings.notify?.whatsapp?.token && settings.notify?.whatsapp?.phoneNumberId && settings.notify?.whatsapp?.to),
    };
  }

  async notify(text, { kind = 'info', force = false } = {}) {
    const settings = this.store.settings();
    if (settings.notify?.paused && !force) return { sent: false, reason: 'pausado' };
    const eventMap = {
      mission_done: 'missionDone',
      mission_error: 'missionError',
      mission_warning: 'missionWarning',
      hot_reply: 'hotReply',
      opt_out: 'optOut',
      digest: 'digest',
      info: null,
    };
    const eventKey = eventMap[kind];
    if (eventKey && settings.notify?.events?.[eventKey] === false && !force) {
      return { sent: false, reason: 'evento desactivado' };
    }

    const channels = this.channels(settings);
    const results = [];
    if (channels.telegram) {
      try {
        await sendTelegram(settings, text);
        results.push({ channel: 'telegram', ok: true });
      } catch (error) {
        results.push({ channel: 'telegram', ok: false, error: error.message });
        this.lastError = error.message;
        await this.store.activity('system', `No se pudo enviar el aviso por Telegram: ${error.message}`).catch(() => {});
      }
    }
    if (channels.whatsapp) {
      try {
        await sendWhatsApp(settings, text);
        results.push({ channel: 'whatsapp', ok: true });
      } catch (error) {
        results.push({ channel: 'whatsapp', ok: false, error: error.message });
        this.lastError = error.message;
        await this.store.activity('system', `No se pudo enviar el aviso por WhatsApp: ${error.message}`).catch(() => {});
      }
    }
    return { sent: results.some((r) => r.ok), results };
  }

  async handleOwnerText(text, channel = 'telegram', chatId = null, attachments = []) {
    const settings = this.store.settings();
    const ownerChatId = String(settings.notify?.telegram?.chatId || chatId || '');
    const effectiveChatId = String(chatId || ownerChatId);
    if (ownerChatId && effectiveChatId && String(effectiveChatId) !== String(ownerChatId)) {
      return '';
    }
    const clean = String(text || '').trim();
    const files = Array.isArray(attachments) ? attachments : [];

    // Transcripción de audios e imágenes adjuntas: el agente "ve" y "oye"
    // antes de responder, igual que un asistente humano.
    const images = [];
    const transcripts = [];
    for (const file of files) {
      if (file?.type === 'image' && file.dataUrl) {
        images.push({ dataUrl: file.dataUrl, mime: file.mime });
      } else if (file?.type === 'audio' && file.buffer) {
        try {
          const { resolveAIConfig, transcribeAudio } = await import('./ai.mjs');
          const cfg = resolveAIConfig(this.store.settings());
          const transcript = await transcribeAudio(cfg, file.buffer, file.mime || 'audio/ogg');
          if (transcript) transcripts.push(transcript);
        } catch (error) {
          transcripts.push(`[No pude transcribir el audio: ${truncate(error.message, 120)}]`);
        }
      }
    }

    const composite = [clean, ...transcripts.map((t) => `Audio transcrito: "${t}"`)]
      .filter(Boolean)
      .join('\n\n')
      .trim();
    const question = composite || (images.length ? 'El usuario envió una imagen. Describila y respondé.' : '');

    if (!question && !images.length) return '';

    // memoria de conversación: comprimida, acotada y persistida
    const sessions = this.store.get('telegramSessions') || {};
    if (!sessions[effectiveChatId]) {
      sessions[effectiveChatId] = {
        history: [], summary: '', turns: 0, topics: [], pending: null,
        memory: [], reflection: '', updatedAt: new Date().toISOString(),
        version: DIALOGUE_VERSION,
      };
    }
    const session = prepareMemory(prepareSession(sessions[effectiveChatId]));
    session.version = DIALOGUE_VERSION;
    session.memoryVersion = MEMORY_VERSION;
    session.updatedAt = new Date().toISOString();

    const intent = detectIntent(clean);
    this._lastReplyMarkup = null;
    const withKeyboard = (markup) => { this._lastReplyMarkup = markup; return markup; };
    // Los comandos son atajos deterministas sobre datos reales; no deben
    // "aprender" ni generar respuestas de agente. El aprendizaje (LLM) ocurre
    // solo en el texto libre, más abajo.
    const finish = async (msg, { keyboard = true, topic = null, markup = null } = {}) => {
      if (markup) withKeyboard(markup);
      else if (keyboard) withKeyboard(quickReplyMarkup());
      if (topic) rememberTopic(session, topic);
      session.turns = Number(session.turns || 0) + 1;
      this._appendHistory(session, 'user', clean);
      this._appendHistory(session, 'assistant', msg);
      await this._persistSessions(sessions);
      return msg;
    };

    // comandos deterministas (no consumen IA)
    if (intent === 'start') {
      return finish('Agente de Lucian listo. Trabajo con tus datos reales: productos, misiones, conversaciones y límites de envío. Nunca envío nada sin tu confirmación. Usá los botones o escribime una pedido concreto.');
    }
    if (intent === 'help') return finish(helpText());
    if (intent === 'pause') {
      await this.store.saveSettings({ notify: { paused: true } });
      return finish('Avisos pausados. Escribí /activar para retomarlos.', { keyboard: false });
    }
    if (intent === 'resume') {
      await this.store.saveSettings({ notify: { paused: false } });
      return finish('Avisos reactivados.', { keyboard: false });
    }
    if (intent === 'status') return finish(this.statusText(), { topic: 'estado' });
    if (intent === 'missions') return finish(this.missionsText(), { topic: 'misiones' });
    if (intent === 'summary') return finish(this.latestSummary(), { topic: 'resumen' });
    if (intent === 'profile') return finish(profileText(session), { topic: 'memoria' });
    if (intent === 'forget') {
      const match = clean.replace(/^\/olvidar\s*/i, '');
      const result = forget(session, match);
      return finish(result.removed === 'todo'
        ? 'Memoria aprendida borrada. Los datos de Lucian y el historial de la charla no se tocaron.'
        : `Borré ${result.removed} entrada(s) de memoria.`, { keyboard: false });
    }
    if (intent === 'reset') {
      session.history = [];
      session.summary = '';
      session.turns = 0;
      session.topics = [];
      session.pending = null;
      session.updatedAt = new Date().toISOString();
      await this._persistSessions(sessions);
      return 'Historial reiniciado. La memoria aprendida se conserva: escribí /olvidar todo si querés borrarla.';
    }

    // confirmación / cancelación de una acción pendiente
    if (session.pending) {
      if (intent === 'confirm') {
        const pending = session.pending;
        session.pending = null;
        session.pendingToken = null;
        const res = await this._executePending(pending, settings);
        return finish(res.message || (res.ok ? 'Listo.' : 'Falló.'), { keyboard: false });
      }
      if (intent === 'cancel') {
        session.pending = null;
        session.pendingToken = null;
        return finish('Cancelado. No se hizo nada.', { keyboard: false });
      }
      // un pedido nuevo reemplaza la acción pendiente
      session.pending = null;
      session.pendingToken = null;
    }

    /* Saludos, pedidos incompletos y cualquier texto libre van al modelo.
       Antes existía una respuesta prefabricada para esos casos; eso convertía
       al bot en un árbol de decisiones y no en un agente. La instrucción de
       diálogo (dialogueHint) le pide al LLM que haga UNA pregunta concreta
       cuando falta el objeto de la acción. */
    if (question.length > 3000) {
      return finish('La pregunta es demasiado larga. Resumila en menos de 3000 caracteres.', { keyboard: false });
    }
    if (!this.ask) {
      const msg = 'Todavía no puedo responder preguntas. Configurá una IA en Lucian.';
      this._appendHistory(session, 'user', clean);
      this._appendHistory(session, 'assistant', msg);
      await this._persistSessions(sessions);
      return msg;
    }

    const resolvedQuestion = resolveReference(question, session);
    // Aprendizaje con el modelo real. El respaldo por patrones solo se usa
    // cuando no hay IA; nunca sustituye al agente ni a su respuesta.
    await learn(session, resolvedQuestion, { settings });
    this._appendHistory(session, 'user', resolvedQuestion);
    session.turns = Number(session.turns || 0) + 1;

    // typing indicator via sendChatAction (best effort)
    try {
      const token = settings.notify?.telegram?.token;
      if (token && effectiveChatId) {
        await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: effectiveChatId, action: 'typing' }),
        }).catch(() => {});
      }
    } catch { /* noop */ }

    let answer = '';
    try {
      const historyForAsk = contextTurns(session);
      const memory = memoryBlock(session, resolvedQuestion);
      const style = settings.notify?.telegram?.style || 'serio';
      const prompt = [dialogueHint(style), memory, `PREGUNTA DEL DUEÑO:\n${resolvedQuestion}`]
        .filter(Boolean).join('\n\n');
      answer = await this.ask(prompt, channel, historyForAsk, images);
    } catch (error) {
      // Mensaje de sistema, no una respuesta del agente: si el modelo no está
      // disponible no inventamos qué diría el equipo.
      answer = error.code === 'AI_REQUIRED'
        ? `El equipo necesita un modelo de IA para responder. ${error.message}`
        : `No pude consultar al equipo: ${truncate(error.message, 300)}. Revisá la configuración de IA en Lucian.`;
    }

    // parse action
    const { parseAction } = await import('./telegram-actions.mjs');
    const { action, cleanText } = parseAction(answer);
    const visible = cleanText || answer.replace(/```json[\s\S]*?```/g, '').trim() || answer;

    if (action) {
      if (action.requiere_accion) {
        const { describeAction } = await import('./telegram-actions.mjs');
        const spec = (await import('./telegram-actions.mjs')).ACTION_SPECS[action.tipo];
        const isAuto = spec?.auto === true;
        if (isAuto) {
          const { executeAction } = await import('./telegram-actions.mjs');
          const res = await executeAction({ action, store: this.store, actions: this.actions, chatId: effectiveChatId, search: async (s, q, o) => {
            const { searchWebDetailed } = await import('./search.mjs');
            return searchWebDetailed(s, q, o);
          } });
          const msg = res.ok ? `Listo: ${res.message}` : `No pude: ${res.message}`;
          withKeyboard(quickReplyMarkup());
          this._appendHistory(session, 'assistant', msg);
          await this._persistSessions(sessions);
          return msg;
        }
        // confirmable: botón inline o respuesta escrita
        const token = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
        session.pending = action;
        session.pendingToken = token;
        const msg = `${visible}\n\nConfirmá con el botón o escribí "confirmar". Nada se ejecuta sin tu confirmación.`;
        withKeyboard(confirmReplyMarkup(token));
        this._appendHistory(session, 'assistant', msg);
        await this._persistSessions(sessions);
        return msg;
      }
    }

    // error fallback: if answer only error, include estado
    if (/no pude consultar/i.test(answer)) {
      const extra = `\n\n${this.statusText()}`;
      const msg = truncate(visible + extra, 3800);
      this._appendHistory(session, 'assistant', msg);
      await this._persistSessions(sessions);
      return msg;
    }

    this._appendHistory(session, 'assistant', visible);
    await this._persistSessions(sessions);
    return visible;
  }

  _appendHistory(session, role, text) {
    const redacted = this._redact(String(text || '').slice(0, 2000));
    session.history = session.history || [];
    session.history.push({ role, text: redacted, at: new Date().toISOString() });
    if (session.history.length > RECENT_TURNS) session.history = session.history.slice(-RECENT_TURNS);
    session.updatedAt = new Date().toISOString();
  }

  _redact(text) {
    return text.replace(/gsk_[A-Za-z0-9_-]+/g, '[redacted]').replace(/tvly-[A-Za-z0-9_-]+/g, '[redacted]').replace(/bot\d+:[A-Za-z0-9_-]+/g, '[redacted]');
  }

  async _persistSessions(sessions) {
    try {
      await this.store.setDebounced('telegramSessions', sessions, 300);
    } catch { /* noop */ }
  }

  async _executePending(action, settings) {
    const { executeAction } = await import('./telegram-actions.mjs');
    const res = await executeAction({ action, store: this.store, actions: this.actions, chatId: null, search: async (s, q, o) => {
      const { searchWebDetailed } = await import('./search.mjs');
      return searchWebDetailed(s, q, o);
    } });
    return res;
  }

  statusText() {
    const settings = this.store.settings();
    const missions = this.store.get('missions');
    const threads = this.store.get('threads');
    const active = missions.filter((m) => ['running', 'queued'].includes(m.status));
    const hot = threads.filter((t) => ['interesado', 'negociando'].includes(t.stage));
    const drafts = threads.reduce((acc, t) => acc + (t.drafts || []).filter((d) => d.status === 'listo').length, 0);
    const lines = [
      `${settings.brand?.name || 'Lucian'} ”” estado de hoy`,
      `Misiones activas: ${active.length}`,
      `Leads calientes: ${hot.length}`,
      `Borradores listos: ${drafts}`,
    ];
    if (active.length) {
      const m = active[0];
      lines.push(`En curso: ${m.name} (${m.progress || 0}%).`);
    }
    if (settings.notify?.paused) lines.push('Los avisos están pausados. Escribí /activar para retomarlos.');
    return lines.join('\n');
  }

  missionsText() {
    const missions = this.store.get('missions').slice(0, 6);
    if (!missions.length) return 'Todavía no hay misiones. Creá una desde Lucian con un producto y un objetivo.';
    return missions.map((m) => {
      const status = { running: 'en curso', queued: 'en cola', done: 'terminada', done_with_warnings: 'terminada con avisos', error: 'con error', cancelled: 'cancelada' }[m.status] || m.status;
      return `· ${m.name} ”” ${status}${m.demo ? ' (demo)' : ''}${m.status === 'running' ? ` ${m.progress || 0}%` : ''}`;
    }).join('\n');
  }

  latestSummary() {
    const done = this.store.get('missions').find((m) => ['done', 'done_with_warnings'].includes(m.status) && m.summary);
    if (!done) return 'Todavía no hay una misión terminada con resumen.';
    return `${done.name}${done.status === 'done_with_warnings' ? ' (con avisos)' : ''}\n\n${truncate(done.summary, 1800)}`;
  }

  digestText() {
    const settings = this.store.settings();
    const missions = this.store.get('missions');
    const threads = this.store.get('threads');
    const since = Date.now() - 86400000;
    const active = missions.filter((m) => ['running', 'queued'].includes(m.status));
    const finished = missions.filter((m) => ['done', 'done_with_warnings'].includes(m.status) && new Date(m.finishedAt || m.updatedAt).getTime() > since);
    const replies = threads.reduce((acc, t) => acc + (t.messages || []).filter((m) => m.direction === 'in' && new Date(m.at).getTime() > since).length, 0);
    const hot = threads.filter((t) => ['interesado', 'negociando'].includes(t.stage));
    const drafts = threads.reduce((acc, t) => acc + (t.drafts || []).filter((d) => d.status === 'listo').length, 0);
    const review = threads.reduce((acc, t) => acc + (t.drafts || []).filter((d) => d.status === 'revisar').length, 0);
    const blocked = threads.reduce((acc, t) => acc + (t.drafts || []).filter((d) => d.status === 'bloqueado').length, 0);
    const followUps = threads.filter((t) => t.nextFollowUp && new Date(t.nextFollowUp).getTime() < Date.now() && !['ganado', 'perdido'].includes(t.stage));

    const lines = [`${settings.brand?.name || 'Lucian'} ”” resumen del día`, ''];
    lines.push(`Misiones activas: ${active.length}`);
    lines.push(`Terminadas en 24 h: ${finished.length}`);
    lines.push(`Respuestas nuevas: ${replies}`);
    lines.push(`Leads calientes: ${hot.length}`);
    lines.push(`Borradores listos: ${drafts}`);
    if (review) lines.push(`Para revisar antes de enviar: ${review}`);
    if (blocked) lines.push(`Bloqueados por cumplimiento: ${blocked}`);
    if (followUps.length) lines.push(`Seguimientos vencidos: ${followUps.length}`);

    if (hot.length) {
      const top = hot[0];
      lines.push('', `Prioridad: ${top.contact?.company || 'un contacto'} (${top.contact?.country || ''}) ”” ${top.nextStep || 'revisar la conversación'}.`);
    } else if (active.length) {
      lines.push('', `En curso: ${active[0].name} (${active[0].progress || 0}%).`);
    } else if (drafts || review) {
      lines.push('', drafts
        ? 'Hay borradores esperando tu revisión en la bandeja.'
        : `Hay ${review} borrador${review === 1 ? '' : 'es'} por aprobar en la bandeja.`);
    } else {
      lines.push('', 'Día tranquilo. Si querés mover algo, lanzá una misión o revisá la bandeja.');
    }
    return lines.join('\n');
  }

  async maybeDigest() {
    const settings = this.store.settings();
    if (!settings.notify?.events?.digest) return;
    if (settings.notify?.paused) return;
    const hour = Number(settings.notify?.telegram?.digestHour ?? 9);
    const now = new Date();
    if (now.getHours() < hour) return;
    const meta = this.store.get('meta');
    if (meta.lastDigest === todayKey()) return;
    const channels = this.channels(settings);
    if (!channels.telegram && !channels.whatsapp) return;
    const result = await this.notify(this.digestText(), { kind: 'digest' });
    if (result.sent) await this.store.setMeta({ lastDigest: todayKey() });
  }

  async pollTelegram(generation) {
    if (this.polling) return;
    this.polling = true;
    const settings = this.store.settings();
    const token = settings.notify?.telegram?.token;
    const chatId = String(settings.notify?.telegram?.chatId || '');
    if (!token || !chatId) { this.polling = false; return; }

    while (this.generation === generation) {
      try {
        const offset = Number(this.store.get('meta').telegramOffset || 0);
        const url = `https://api.telegram.org/bot${token}/getUpdates?timeout=25&allowed_updates=${encodeURIComponent('["message","callback_query"]')}${offset ? `&offset=${offset}` : ''}`;
        const { ok, data } = await fetchJson(url, { timeoutMs: 35000 });
        if (this.generation !== generation) break;
        if (!ok || !data?.ok) {
          this.lastError = data?.description || 'Telegram rechazó la conexión';
          if (/unauthorized|not found/i.test(this.lastError)) break;
          await sleep(15000);
          continue;
        }
        for (const update of data.result || []) {
          const nextOffset = Number(update.update_id) + 1;
          await this.store.setMeta({ telegramOffset: nextOffset });

          // Botones inline: respuesta rápida o confirmación con token.
          if (update.callback_query) {
            const cb = update.callback_query;
            const cbChat = String(cb.message?.chat?.id || '');
            if (cbChat !== String(chatId)) continue;
            const parsed = parseCallback(cb.data);
            try {
              await fetchJson(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
                method: 'POST',
                body: { callback_query_id: cb.id, text: parsed ? 'Procesando…' : 'Acción no reconocida' },
                timeoutMs: 10000,
              });
            } catch { /* el aviso al botón es best effort */ }
            if (!parsed) continue;
            if (parsed.kind === 'quick') {
              const quickReply = await this.handleOwnerText(parsed.text, 'telegram', cbChat, []);
              if (quickReply) {
                await sendTelegramText(this.store.settings(), quickReply, {
                  chatId: cbChat, replyMarkup: this._lastReplyMarkup,
                }).catch(() => {});
              }
              continue;
            }
            const sessions = this.store.get('telegramSessions') || {};
            const session = sessions[cbChat];
            if (!session || !session.pendingToken || session.pendingToken !== parsed.token) {
              await sendTelegramText(this.store.settings(), 'Esa confirmación ya no está vigente. Pedime la acción de nuevo.', { chatId: cbChat }).catch(() => {});
              continue;
            }
            session.pendingToken = null;
            let msg;
            if (parsed.kind === 'confirm') {
              const pending = session.pending;
              session.pending = null;
              const res = await this._executePending(pending, settings);
              msg = res.message || (res.ok ? 'Listo.' : 'Falló.');
              this._appendHistory(session, 'user', 'confirmar (botón)');
            } else {
              session.pending = null;
              msg = 'Cancelado. No se hizo nada.';
              this._appendHistory(session, 'user', 'cancelar (botón)');
            }
            this._appendHistory(session, 'assistant', msg);
            await this._persistSessions(sessions);
            await sendTelegramText(this.store.settings(), msg, { chatId: cbChat, replyMarkup: quickReplyMarkup() }).catch(() => {});
            continue;
          }

          const message = update.message;
          if (String(message?.chat?.id) !== String(chatId)) continue;
          if (!message?.text && !message?.voice && !message?.audio && !(Array.isArray(message?.photo) && message.photo.length)) {
            try { await sendTelegramText(this.store.settings(), 'Puedo trabajar con texto, audio e imágenes; enviame el pedido y lo resuelvo.', { chatId: message.chat.id }); } catch { /* noop */ }
            continue;
          }
          const attachments = [];
          const token = settings.notify?.telegram?.token;
          if (message?.voice?.file_id || message?.audio?.file_id) {
            const fileId = message.voice?.file_id || message.audio?.file_id;
            const mime = message.voice?.mime_type || message.audio?.mime_type || 'audio/ogg';
            try {
              const file = await telegramGetFile(token, fileId);
              if (file?.file_path) {
                const buffer = await fetchTelegramFile(token, file.file_path);
                if (buffer) attachments.push({ type: 'audio', buffer, mime });
              }
            } catch { /* noop */ }
          }
          if (Array.isArray(message?.photo) && message.photo.length) {
            const photo = message.photo[message.photo.length - 1];
            try {
              const file = await telegramGetFile(token, photo.file_id);
              if (file?.file_path) {
                const buffer = await fetchTelegramFile(token, file.file_path);
                if (buffer) {
                  const mime = 'image/jpeg';
                  const base64 = Buffer.from(buffer).toString('base64');
                  attachments.push({ type: 'image', dataUrl: `data:${mime};base64,${base64}`, mime });
                }
              }
            } catch { /* noop */ }
          }
          const text = message?.text || message?.caption || '';
          const reply = await this.handleOwnerText(text, 'telegram', message.chat.id, attachments);
          if (reply) {
            await sendTelegramText(this.store.settings(), reply, {
              chatId: message.chat.id,
              replyMarkup: this._lastReplyMarkup,
            }).catch(() => {});
          }
        }
      } catch (error) {
        if (this.generation !== generation) break;
        this.lastError = error.message;
        await sleep(15000);
      }
    }
    this.polling = false;
    // Si guardaron ajustes mientras esperábamos una respuesta, el loop viejo
    // ya terminó: levantamos el nuevo con la configuración más reciente.
    this.startPolling();
  }
}

/* ─────────────────────────────────────────────────────────────
   Transportes
   ───────────────────────────────────────────────────────────── */

async function telegramGetFile(token, fileId) {
  if (!token || !fileId) return null;
  const url = `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`;
  const { ok, data } = await fetchJson(url, { timeoutMs: 15000 });
  if (!ok || !data?.ok) return null;
  return data.result || null;
}

async function fetchTelegramFile(token, filePath) {
  if (!token || !filePath) return null;
  const url = `https://api.telegram.org/file/bot${token}/${filePath}`;
  const response = await fetch(url);
  if (!response.ok) return null;
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function sendTelegram(settings, text) {
  const token = settings.notify?.telegram?.token;
  const chatId = settings.notify?.telegram?.chatId;
  if (!token || !chatId) throw new Error('Falta token o chat ID de Telegram');
  const { ok, data, text: raw } = await fetchJson(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    body: { chat_id: chatId, text: truncate(text, 4000), disable_web_page_preview: true },
    timeoutMs: 20000,
  });
  if (!ok || !data?.ok) throw new Error(`Telegram: ${data?.description || raw.slice(0, 200)}`);
  return data.result;
}

export async function sendTelegramText(settings, text, { chatId, replyMarkup } = {}) {
  const token = settings.notify?.telegram?.token;
  const target = chatId || settings.notify?.telegram?.chatId;
  if (!token || !target) throw new Error('Falta token o chat ID de Telegram');
  const chunks = [];
  const raw = String(text || '');
  if (raw.length <= 3500) chunks.push(raw);
  else {
    let buf = '';
    for (const para of raw.split(/\n\n+/)) {
      if ((buf + '\n\n' + para).length > 3500 && buf) { chunks.push(buf); buf = para; }
      else buf = buf ? buf + '\n\n' + para : para;
    }
    if (buf) chunks.push(buf);
    if (!chunks.length) chunks.push(raw.slice(0, 3500));
  }
  for (let i = 0; i < chunks.length; i++) {
    const { ok, data, text: rawText } = await fetchJson(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      body: {
        chat_id: target,
        text: truncate(chunks[i], 4000),
        disable_web_page_preview: true,
        ...(replyMarkup && i === chunks.length - 1 ? { reply_markup: JSON.stringify(replyMarkup) } : {}),
      },
      timeoutMs: 20000,
    });
    if (!ok || !data?.ok) throw new Error(`Telegram: ${data?.description || rawText.slice(0, 200)}`);
    if (i < chunks.length - 1) await new Promise((r) => setTimeout(r, 1100));
  }
  return true;
}

export async function sendWhatsApp(settings, text) {
  const cfg = settings.notify?.whatsapp || {};
  if (!cfg.token || !cfg.phoneNumberId || !cfg.to) throw new Error('Falta token, phone number ID o número de WhatsApp');
  const version = cfg.apiVersion || 'v23.0';
  const { ok, data, text: raw } = await fetchJson(`https://graph.facebook.com/${version}/${cfg.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${cfg.token}` },
    body: {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: digits(cfg.to),
      type: 'text',
      text: { preview_url: false, body: truncate(text, 3800) },
    },
    timeoutMs: 25000,
  });
  if (!ok) throw new Error(`WhatsApp: ${data?.error?.message || raw.slice(0, 250)}`);
  return data;
}

export async function telegramChats(token) {
  if (!token) throw new Error('Falta el token de Telegram');
  const { ok, data, text } = await fetchJson(`https://api.telegram.org/bot${token}/getUpdates?timeout=1&allowed_updates=${encodeURIComponent('["message"]')}`, { timeoutMs: 15000 });
  if (!ok || !data?.ok) throw new Error(`Telegram: ${data?.description || text.slice(0, 200)}`);
  const chats = [];
  for (const update of data.result || []) {
    const chat = update.message?.chat;
    if (!chat) continue;
    chats.push({
      id: String(chat.id),
      name: [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.title || chat.username || 'Chat',
      username: chat.username || '',
    });
  }
  return [...new Map(chats.map((c) => [c.id, c])).values()];
}

export async function testTelegram(settings, { sendTest = true } = {}) {
  const token = settings.notify?.telegram?.token;
  if (!token) throw new Error('Falta el token del bot de Telegram');
  const me = await fetchJson(`https://api.telegram.org/bot${token}/getMe`, { timeoutMs: 15000 });
  if (!me.ok || !me.data?.ok) throw new Error(`Telegram: ${me.data?.description || 'token inválido'}`);
  const chatId = settings.notify?.telegram?.chatId;
  let chatVerified = false;
  let sent = false;
  if (chatId) {
    const chat = await fetchJson(`https://api.telegram.org/bot${token}/getChat`, {
      method: 'POST', body: { chat_id: chatId }, timeoutMs: 15000,
    });
    if (!chat.ok || !chat.data?.ok) throw new Error(`Telegram: ${chat.data?.description || 'No se pudo acceder al chat.'}`);
    chatVerified = true;
    if (sendTest) {
      await sendTelegram(settings, `Lucian conectado. Este es un mensaje de prueba para ${settings.brand?.name || 'tu marca'}.`);
      sent = true;
    }
  }
  return { bot: me.data.result?.username || '', name: me.data.result?.first_name || '', chatVerified, sent };
}

export async function testWhatsApp(settings) {
  const cfg = settings.notify?.whatsapp || {};
  if (!cfg.token || !cfg.phoneNumberId) throw new Error('Faltan token y phone number ID de WhatsApp');
  const version = cfg.apiVersion || 'v23.0';
  const { ok, data, text } = await fetchJson(`https://graph.facebook.com/${version}/${cfg.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`, {
    headers: { authorization: `Bearer ${cfg.token}` },
    timeoutMs: 20000,
  });
  if (!ok) throw new Error(`WhatsApp: ${data?.error?.message || text.slice(0, 250)}`);
  return data;
}

export function parseWhatsAppWebhook(payload) {
  const messages = [];
  for (const entry of payload?.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      for (const message of value.messages || []) {
        if (message.type !== 'text') continue;
        messages.push({
          from: String(message.from || ''),
          text: message.text?.body || '',
          name: value.contacts?.[0]?.profile?.name || '',
          at: new Date(Number(message.timestamp || 0) * 1000).toISOString(),
        });
      }
    }
  }
  return messages;
}
