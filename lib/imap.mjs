/* ============================================================
   IMAP mínimo sobre TLS para Gmail (imap.gmail.com:993).
   Lee correos nuevos de INBOX sin dependencias externas.
   El cursor UID de Lucian evita procesar los mismos mensajes dos veces.
   ============================================================ */
import tls from 'node:tls';
import { htmlToText } from './util.mjs';

const CRLF = '\r\n';

/**
 * Lee correos nuevos de Gmail por IMAP.
 * @param {object} opts { user, appPassword, sinceUid, limit, verifyOnly }
 * @returns {Promise<Array<{uid, from, to, subject, text, html, messageId, inReplyTo, references, date}>>}
 */
export function fetchNewEmails(opts = {}, connect = tls.connect) {
  return gmailInbox(opts, connect, opts.verifyOnly ? 'verify' : 'messages');
}

/** Devuelve el último UID existente sin leer mensajes. */
export function readGmailInboxCursor(opts = {}, connect = tls.connect) {
  return gmailInbox(opts, connect, 'cursor');
}

async function gmailInbox(opts, connect, mode) {
  const user = String(opts.user || '').trim();
  const pass = String(opts.appPassword || '').replace(/\s/g, '');
  if (!user || !pass) throw new Error('Faltan credenciales de Gmail para leer correos.');
  if (/[\x00-\x1f\x7f]/.test(user) || /[\x00-\x1f\x7f]/.test(pass)) throw new Error('Las credenciales de Gmail tienen caracteres inválidos.');
  const quote = value => `"${value.replace(/[\\"]/g, '\\$&')}"`;

  const host = 'imap.gmail.com';
  const port = 993;
  const sinceUid = Number(opts.sinceUid) || 0;
  const limit = Math.max(1, Math.min(50, Number(opts.limit) || 20));

  return await new Promise((resolve, reject) => {
    const socket = connect({ host, port, servername: host });
    let buffer = Buffer.alloc(0);
    let remainingLiteral = 0;
    let tag = 0;
    let greeted = false;
    let finished = false;
    const pending = new Map(); // tag -> {resolve,reject,accum}
    const results = [];

    const nextTag = () => `A${++tag}`;

    const done = (err, value) => {
      if (finished) return;
      finished = true;
      for (const command of pending.values()) command.reject(err || new Error('IMAP Gmail cerró la conexión.'));
      pending.clear();
      try { socket.end(); } catch { /* noop */ }
      if (err) reject(err); else resolve(value ?? []);
    };

    socket.setTimeout(30000, () => done(new Error('IMAP Gmail: timeout.')));
    socket.on('error', err => done(new Error(`IMAP Gmail: ${err.code || err.errors?.[0]?.code || err.message}`)));
    socket.once('close', () => done(new Error('IMAP Gmail cerró la conexión.')));

    function sendCommand(cmd) {
      return new Promise((res, rej) => {
        const t = nextTag();
        pending.set(t, { resolve: res, reject: rej, lines: [], literals: [] });
        socket.write(`${t} ${cmd}${CRLF}`);
      });
    }

    socket.on('data', (chunk) => {
      if (finished) return;
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length) {
        if (remainingLiteral) {
          if (buffer.length < remainingLiteral) return;
          for (const command of pending.values()) command.literals.push(buffer.subarray(0, remainingLiteral));
          buffer = buffer.subarray(remainingLiteral);
          remainingLiteral = 0;
          continue;
        }
        const idx = buffer.indexOf(CRLF);
        if (idx === -1) return;
        const line = buffer.subarray(0, idx).toString('utf8');
        buffer = buffer.subarray(idx + CRLF.length);
        const literal = line.match(/\{(\d+)\}$/);
        if (literal) remainingLiteral = Number(literal[1]);
        handleLine(line);
      }
    });

    function handleLine(line) {
      if (!greeted) {
        greeted = true;
        if (!/^\* OK\b/i.test(line)) {
          done(new Error('IMAP Gmail no aceptó la conexión.'));
          return;
        }
        readInbox();
        return;
      }
      // Respuestas tagged: A1 OK ... / A1 NO ... / A1 BAD ...
      const tm = line.match(/^(A\d+)\s+(OK|NO|BAD)\s+(.*)$/);
      if (tm && pending.has(tm[1])) {
        const p = pending.get(tm[1]);
        pending.delete(tm[1]);
        const status = tm[2];
        const text = tm[3] || '';
        if (status !== 'OK') p.reject(new Error(`IMAP ${tm[1]} ${status}: ${text}`));
        else p.resolve(p);
        return;
      }
      // Líneas untagged (* ...) y continuaciones (+ ...) se ignoran salvo
      // que las estemos acumulando para un comando (FETCH).
      for (const command of pending.values()) command.lines.push(line);
    }

    async function readInbox() {
      try {
        await sendCommand(`LOGIN ${quote(user)} ${quote(pass)}`);
        const inbox = await sendCommand('EXAMINE INBOX');
        if (mode === 'verify') { done(null, []); return; }
        if (mode === 'cursor') {
          const nextUid = Number(inbox.lines.join(' ').match(/\[UIDNEXT\s+(\d+)\]/i)?.[1]);
          if (!Number.isSafeInteger(nextUid) || nextUid < 1) throw new Error('Gmail no indicó el cursor de la bandeja de entrada.');
          done(null, nextUid - 1);
          return;
        }

        // Buscar UIDs mayores al último procesado
        const searchCmd = sinceUid > 0
          ? `UID SEARCH UID ${sinceUid + 1}:*`
          : 'UID SEARCH ALL';
        const searchRes = await sendCommand(searchCmd);
        const uids = searchRes.lines
          .filter(line => /^\* SEARCH(?: |$)/i.test(line))
          .flatMap(line => line.slice(8).trim().split(/\s+/).map(Number))
          .filter(n => Number.isSafeInteger(n) && n > sinceUid)
          .sort((a, b) => a - b)
          .slice(0, limit);

        if (!uids.length) { done(null, []); return; }

        // Traer cabeceras + cuerpo de cada mensaje
        for (const uid of uids) {
          try {
            const fetchRes = await sendCommand(`UID FETCH ${uid} (BODY.PEEK[])`);
            const raw = fetchRes.literals[0]?.toString('utf8');
            if (raw) {
              const parsed = parseRawEmail(raw);
              if (parsed) results.push({ uid, ...parsed });
            }
          } catch {
            // Conservá el orden del cursor para reintentar este UID la próxima vez.
            break;
          }
        }
        done(null, results);
      } catch (err) {
        done(err);
      }
    }
  });
}

function decodeHeader(value) {
  const s = String(value || '');
  const encoded = s.match(/=\?UTF-8\?B\?([^?]+)\?=/i);
  if (encoded) {
    try { return Buffer.from(encoded[1], 'base64').toString('utf8'); } catch { return s; }
  }
  return s.replace(/=\?UTF-8\?Q\?([^?]+)\?=/gi, (_, q) => {
    try { return decodeURIComponent(q.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, '%$1')); } catch { return q; }
  });
}

function headerValue(headers, name) {
  const line = headers.find((h) => h.toLowerCase().startsWith(name.toLowerCase() + ':'));
  return line ? line.slice(line.indexOf(':') + 1).trim() : '';
}

function parseRawEmail(raw) {
  const sepIdx = raw.indexOf(CRLF + CRLF);
  if (sepIdx === -1) return null;
  const headers = raw.slice(0, sepIdx).replace(/\r\n[\t ]+/g, ' ').split(CRLF);
  const from = decodeHeader(headerValue(headers, 'From'));
  const to = decodeHeader(headerValue(headers, 'To'));
  const subject = decodeHeader(headerValue(headers, 'Subject'));
  const messageId = headerValue(headers, 'Message-ID').replace(/^<|>$/g, '');
  const inReplyTo = headerValue(headers, 'In-Reply-To').replace(/^<|>$/g, '');
  const references = headerValue(headers, 'References').match(/<[^>]+>/g) || [];

  const { text, html } = mimeText(headers, raw.slice(sepIdx + 4));

  if (!from || (!text && !html && !subject)) return null;
  return {
    from, to, subject,
    text: text || htmlToText(html),
    html,
    messageId,
    inReplyTo,
    references,
    date: headerValue(headers, 'Date'),
  };
}

function mimeText(headers, body, depth = 0) {
  const output = { text: '', html: '' };
  const contentType = headerValue(headers, 'Content-Type');
  const type = contentType.split(';')[0].trim().toLowerCase() || 'text/plain';
  if (depth > 10 || /^attachment\b/i.test(headerValue(headers, 'Content-Disposition'))) return output;
  if (type.startsWith('multipart/')) {
    const match = contentType.match(/\bboundary\s*=\s*(?:"([^"]+)"|([^\s;]+))/i);
    const boundary = match?.[1] || match?.[2];
    if (!boundary) return output;
    for (const part of body.split(`--${boundary}`).slice(1)) {
      if (part.startsWith('--')) break;
      const block = part.replace(/^\r\n/, '');
      const split = block.indexOf(CRLF + CRLF);
      if (split === -1) continue;
      const fields = block.slice(0, split).replace(/\r\n[\t ]+/g, ' ').split(CRLF);
      const inner = mimeText(fields, block.slice(split + 4), depth + 1);
      output.text ||= inner.text;
      output.html ||= inner.html;
    }
    return output;
  }
  if (type !== 'text/plain' && type !== 'text/html') return output;

  const encoding = headerValue(headers, 'Content-Transfer-Encoding').toLowerCase();
  let bytes;
  if (encoding === 'base64') bytes = Buffer.from(body, 'base64');
  if (encoding === 'quoted-printable') {
    const binary = Buffer.from(body.replace(/=\r?\n/g, ''), 'utf8').toString('latin1');
    bytes = Buffer.from(binary.replace(/=([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16))), 'latin1');
  }
  if (bytes) {
    const charset = contentType.match(/\bcharset\s*=\s*"?([^";\s]+)/i)?.[1] || 'utf-8';
    try { body = new TextDecoder(charset).decode(bytes); }
    catch { body = bytes.toString('utf8'); }
  }
  output[type === 'text/plain' ? 'text' : 'html'] = body.trim();
  return output;
}
