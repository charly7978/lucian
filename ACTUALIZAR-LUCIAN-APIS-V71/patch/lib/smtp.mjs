/* ============================================================
   SMTP mínimo sobre TLS para Gmail (smtp.gmail.com:465, TLS implícito).
   Sin dependencias externas: usa node:tls + node:net de Node.js.
   Suficiente para AUTH LOGIN y enviar un mensaje MIME.
   ============================================================ */
import tls from 'node:tls';

const CRLF = '\r\n';

function encodeMimeWord(value) {
  // Codifica asunto/nombre no ASCII como =?UTF-8?B?...?=
  const str = String(value ?? '');
  if (/^[\x20-\x7E]*$/.test(str)) return str;
  return `=?UTF-8?B?${Buffer.from(str, 'utf8').toString('base64')}?=`;
}

function parseFrom(from) {
  const raw = String(from || '').trim();
  const m = raw.match(/^"?([^"<]*)"?\s*<([^>]+)>$/);
  if (m) return { name: m[1].trim(), email: m[2].trim() };
  return { name: '', email: raw };
}

/**
 * Envía un correo por Gmail SMTP usando una contraseña de aplicación.
 * @param {object} opts { user, appPassword, from, to, subject, text, html, replyTo, messageId, inReplyTo, references }
 */
export async function sendWithGmailSmtp(opts = {}) {
  const user = String(opts.user || '').trim();
  const pass = String(opts.appPassword || '').trim();
  if (!user || !pass) throw new Error('Falta el usuario o la contraseña de aplicación de Gmail.');

  const fromRaw = String(opts.from || user).trim();
  const from = parseFrom(fromRaw);
  const to = String(opts.to || '').trim();
  if (!to) throw new Error('Falta el destinatario.');

  const host = 'smtp.gmail.com';
  const port = 465; // TLS implícito (SMTPS) — Gmail lo soporta.

  const rawMessage = buildRawMessage({
    from,
    to,
    subject: opts.subject || '',
    text: opts.text || '',
    html: opts.html || '',
    replyTo: opts.replyTo || '',
    messageId: opts.messageId || '',
    inReplyTo: opts.inReplyTo || '',
    references: opts.references || '',
  });

  return await new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, servername: host }, () => {
      // TLS listo; el servidor SMTP envía el saludo 220.
    });
    socket.setEncoding('utf8');
    let buffer = '';
    let phase = 'greeting';
    let finished = false;

    const done = (err, id) => {
      if (finished) return;
      finished = true;
      try { socket.end(); } catch { /* noop */ }
      if (err) reject(err); else resolve({ id: id || '', provider: 'gmail' });
    };

    socket.on('error', (err) => done(new Error(`SMTP Gmail: ${err.message}`)));

    socket.setTimeout(20000, () => done(new Error('SMTP Gmail: timeout de conexión.')));

    const send = (line) => socket.write(line + CRLF);

    socket.on('data', (chunk) => {
      buffer += chunk;
      let idx;
      while ((idx = buffer.indexOf(CRLF)) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + CRLF.length);
        handleLine(line);
      }
    });

    function expect(line, codes) {
      const code = String(line).slice(0, 3);
      if (!codes.includes(code)) {
        done(new Error(`SMTP Gmail (${phase}): ${line}`));
        return false;
      }
      return true;
    }

    function handleLine(line) {
      if (phase === 'greeting') {
        if (!expect(line, ['220'])) return;
        phase = 'ehlo1';
        send('EHLO localhost');
        return;
      }
      if (phase === 'ehlo1') {
        if (!expect(line, ['250'])) return;
        // Gmail responde EHLO con varias líneas (250-SIZE..., 250-AUTH...).
        // Solo la última línea "250 " (con espacio, sin guion) marca el final.
        if (/^250-/.test(line)) return; // sigue la lista de capacidades
        phase = 'auth';
        send('AUTH LOGIN');
        return;
      }
      if (phase === 'auth') {
        if (!expect(line, ['334'])) return;
        phase = 'user';
        send(Buffer.from(user, 'utf8').toString('base64'));
        return;
      }
      if (phase === 'user') {
        if (!expect(line, ['334'])) return;
        phase = 'pass';
        send(Buffer.from(pass, 'utf8').toString('base64'));
        return;
      }
      if (phase === 'pass') {
        if (!expect(line, ['235'])) return;
        phase = 'mailfrom';
        send(`MAIL FROM:<${from.email}>`);
        return;
      }
      if (phase === 'mailfrom') {
        if (!expect(line, ['250'])) return;
        phase = 'rcptto';
        send(`RCPT TO:<${to}>`);
        return;
      }
      if (phase === 'rcptto') {
        if (!expect(line, ['250', '251'])) return;
        phase = 'data';
        send('DATA');
        return;
      }
      if (phase === 'data') {
        if (!expect(line, ['354'])) return;
        phase = 'body';
        socket.write(rawMessage.replace(/\r?\n/g, CRLF));
        socket.write(CRLF + '.' + CRLF);
        return;
      }
      if (phase === 'body') {
        if (!expect(line, ['250'])) return;
        phase = 'quit';
        send('QUIT');
        done(null, String(line).slice(4).trim());
        return;
      }
    }
  });
}

function buildRawMessage({ from, to, subject, text, html, replyTo, messageId, inReplyTo, references }) {
  const boundary = `lumbre_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const domain = (from.email || '').split('@')[1] || 'gmail.com';
  const id = messageId || `<${Date.now()}.${Math.random().toString(36).slice(2)}@${domain}>`;
  const date = new Date().toUTCString();
  const encSubject = encodeMimeWord(subject);
  const fromHeader = from.name ? `${encodeMimeWord(from.name)} <${from.email}>` : `<${from.email}>`;
  const headers = [
    `From: ${fromHeader}`,
    `To: ${to}`,
    `Subject: ${encSubject}`,
    `Date: ${date}`,
    `Message-ID: ${id}`,
    'MIME-Version: 1.0',
  ];
  if (replyTo) headers.push(`Reply-To: ${replyTo}`);
  if (inReplyTo) headers.push(`In-Reply-To: ${inReplyTo}`);
  if (references) headers.push(`References: ${references}`);
  headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);

  const textPart = Buffer.from(String(text || ''), 'utf8').toString('base64');
  const htmlPart = Buffer.from(String(html || text || ''), 'utf8').toString('base64');
  return headers.join(CRLF) + CRLF + CRLF
    + `--${boundary}${CRLF}Content-Type: text/plain; charset="UTF-8"${CRLF}Content-Transfer-Encoding: base64${CRLF}${CRLF}${textPart}${CRLF}`
    + `--${boundary}${CRLF}Content-Type: text/html; charset="UTF-8"${CRLF}Content-Transfer-Encoding: base64${CRLF}${CRLF}${htmlPart}${CRLF}`
    + `--${boundary}--${CRLF}`;
}

/**
 * Valida TLS y AUTH LOGIN con Gmail SIN enviar un mensaje.
 * No ejecuta MAIL FROM, RCPT TO ni DATA.
 */
export async function testGmailSmtpAuth({ user, appPassword, timeoutMs = 15000 } = {}) {
  if (!user || !appPassword) throw new Error('Falta la cuenta o contraseña de aplicación de Gmail.');
  const host = 'smtp.gmail.com';
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port: 465, servername: host });
    socket.setEncoding('utf8');
    socket.setTimeout(timeoutMs);
    let buffer = '';
    let state = 'greeting';
    let finished = false;
    const done = (error) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      if (error) reject(error);
      else resolve({ authenticated: true, detail: 'Gmail SMTP autenticado, sin enviar mensajes' });
    };
    socket.once('error', () => done(new Error('Gmail SMTP: no se pudo establecer la conexión TLS.')));
    socket.once('timeout', () => done(new Error('Gmail SMTP: tiempo de espera agotado.')));
    const send = (value) => socket.write(value + CRLF);
    socket.on('data', chunk => {
      if (finished) return;
      buffer += chunk;
      let at;
      while ((at = buffer.indexOf(CRLF)) !== -1 && !finished) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + CRLF.length);
        const code = line.slice(0, 3);
        if (state === 'greeting') {
          if (code !== '220') { done(new Error('Gmail SMTP rechazó la conexión inicial.')); break; }
          state = 'ehlo';
          send('EHLO localhost');
        } else if (state === 'ehlo') {
          if (code !== '250') { done(new Error('Gmail SMTP rechazó EHLO.')); break; }
          if (line[3] === '-') continue;
          state = 'auth';
          send('AUTH LOGIN');
        } else if (state === 'auth') {
          if (code !== '334') { done(new Error('Gmail SMTP no admite AUTH LOGIN con esta cuenta.')); break; }
          state = 'user';
          send(Buffer.from(user, 'utf8').toString('base64'));
        } else if (state === 'user') {
          if (code !== '334') { done(new Error('Gmail SMTP rechazó el usuario.')); break; }
          state = 'password';
          send(Buffer.from(appPassword, 'utf8').toString('base64'));
        } else if (state === 'password') {
          if (code !== '235') done(new Error('Gmail SMTP rechazó las credenciales. Comprobá la contraseña de aplicación.'));
          else done();
        }
      }
    });
  });
}
