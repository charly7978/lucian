import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { fetchNewEmails, parseRawEmail, readGmailInboxCursor } from '../lib/imap.mjs';
import { sendWithGmailSmtp, testGmailSmtp } from '../lib/smtp.mjs';
import { maskSettings } from '../lib/store.mjs';

function fixture(greeting, respond, { binary = false } = {}) {
  const commands = [];
  function connect() {
    const socket = new EventEmitter();
    socket.setTimeout = () => {};
    socket.setEncoding = () => {};
    socket.end = () => {};
    const emit = chunk => socket.emit('data', binary ? Buffer.from(chunk) : chunk);
    socket.write = chunk => {
      const command = String(chunk).replace(/\r\n$/, '');
      commands.push(command);
      const reply = respond(command, commands.length);
      if (reply) queueMicrotask(() => {
        for (const part of Array.isArray(reply) ? reply : [reply]) emit(part);
      });
    };
    queueMicrotask(() => emit(greeting));
    return socket;
  }
  return { connect, commands };
}

const user = 'integration@example.test';
const appPassword = 'aaaa bbbb cccc dddd';
const smtpCodes = ['250-Gmail\r\n250 AUTH LOGIN\r\n', '334 User\r\n', '334 Pass\r\n', '235 Authenticated\r\n'];
const smtp = fixture('220 Gmail\r\n', (_command, index) => smtpCodes[index - 1]);
await testGmailSmtp({ user, appPassword }, smtp.connect);
assert.deepEqual(smtp.commands, ['EHLO localhost', 'AUTH LOGIN', Buffer.from(user).toString('base64'), Buffer.from('aaaabbbbccccdddd').toString('base64'), 'QUIT']);
const bad = fixture('220 Gmail\r\n', (_command, index) => index === 4 ? '535 Invalid credentials\r\n' : smtpCodes[index - 1]);
await assert.rejects(testGmailSmtp({ user, appPassword }, bad.connect), /535/);

const send = fixture('220 Gmail\r\n', (command, index) => smtpCodes[index - 1]
  || ({ 'MAIL FROM:<integration@example.test>': '250 OK\r\n', 'RCPT TO:<buyer@example.test>': '250 OK\r\n', DATA: '354 Enviá el mensaje\r\n', '\r\n.': '250 message-1\r\n' })[command]);
const message = await sendWithGmailSmtp({ user, appPassword, to: 'buyer@example.test', text: 'Prueba SMTP' }, send.connect);
assert.equal(message.id, 'message-1');

const literal = Buffer.from('From: Cliente <buyer@example.test>\r\nSubject: Consulta\r\nMessage-ID: <cliente-1@example.test>\r\n\r\n¿Tienen lámparas?');
const split = literal.indexOf(Buffer.from('¿')) + 1;
const imap = fixture('* OK Gmail listo\r\n', command => {
  const separator = command.indexOf(' ');
  const tag = command.slice(0, separator);
  const request = command.slice(separator + 1);
  if (request === 'UID SEARCH UID 47:*') return `* SEARCH 47\r\n${tag} OK SEARCH completed\r\n`;
  if (request === 'UID FETCH 47 (BODY.PEEK[])') {
    return [ `* 1 FETCH (UID 47 BODY[] {${literal.length}}\r\n`, literal.subarray(0, split), literal.subarray(split), `)\r\n${tag} OK FETCH completed\r\n` ];
  }
  return `${tag} OK Ready\r\n`;
}, { binary: true });
const mail = await fetchNewEmails({ user, appPassword, sinceUid: 46 }, imap.connect);
assert.equal(mail[0].uid, 47);
assert.equal(mail[0].text, '¿Tienen lámparas?');
assert.equal(mail[0].messageId, 'cliente-1@example.test');
assert.deepEqual(imap.commands, [`A1 LOGIN "${user}" "aaaabbbbccccdddd"`, 'A2 EXAMINE INBOX', 'A3 UID SEARCH UID 47:*', 'A4 UID FETCH 47 (BODY.PEEK[])']);

const probe = fixture('* OK Gmail listo\r\n', command => `${command.split(' ')[0]} OK Ready\r\n`, { binary: true });
await fetchNewEmails({ user, appPassword, verifyOnly: true }, probe.connect);
assert.equal(probe.commands.length, 2);
assert.match(probe.commands[1], /EXAMINE INBOX/);
const cursor = fixture('* OK Gmail listo\r\n', command => {
  const tag = command.split(' ')[0];
  return command.includes('EXAMINE') ? `* OK [UIDNEXT 1] Siguiente UID\r\n${tag} OK Ready\r\n` : `${tag} OK Ready\r\n`;
}, { binary: true });
assert.equal(await readGmailInboxCursor({ user, appPassword }, cursor.connect), 0);
assert.equal(cursor.commands.length, 2, 'Leer el cursor no abre correos existentes');

const deliveryReport = (recipientFields, { replyId = 'lucian-original@example.test', originalId = replyId } = {}) => [
  'From: Mail Delivery Subsystem <mailer-daemon@googlemail.com>',
  'To: integration@example.test',
  'Subject: Delivery Status Notification (Failure)',
  'Message-ID: <delivery-report@googlemail.com>',
  ...(replyId ? [`In-Reply-To: <${replyId}>`] : []),
  'Auto-Submitted: auto-replied',
  'Content-Type: multipart/report; boundary="delivery"; report-type=delivery-status',
  '', '--delivery', 'Content-Type: text/plain', '',
  'Address not found. This report is not a buyer asking about lamps.',
  '--delivery', 'Content-Type: message/delivery-status', '',
  'Reporting-MTA: dns; googlemail.com', '',
  ...recipientFields,
  '--delivery', 'Content-Type: text/rfc822-headers', '',
  ...(originalId ? [`Message-ID: <${originalId}>`] : []),
  'To: buyer@example.test', '', '--delivery--', '',
].join('\r\n');
const failedFields = [
  'Final-Recipient: rfc822; buyer@example.test',
  'Action: failed', 'Status: 5.1.1',
  'Diagnostic-Code: smtp; 550 5.1.1 The email account does not exist.', '',
];
const failed = parseRawEmail(deliveryReport(failedFields));
assert.deepEqual(failed.deliveryEvents, [{
  kind: 'bounce', hard: true, emails: ['buyer@example.test'],
  messageId: 'lucian-original@example.test', strictMessageMatch: true,
  reason: 'smtp; 550 5.1.1 The email account does not exist.',
}]);
assert.equal(failed.replyAllowed, false, 'Un informe de entrega no permite respuesta automática');
const delayed = parseRawEmail(deliveryReport([
  'Final-Recipient: rfc822; buyer@example.test', 'Action: delayed', 'Status: 4.2.2', '',
]));
assert.equal(delayed.deliveryEvents[0].kind, 'delayed');
assert.equal(delayed.deliveryEvents[0].hard, false, 'Un retraso no suprime una dirección');
assert.deepEqual(parseRawEmail(deliveryReport(failedFields, {replyId:'unrelated@example.test', originalId:'original@example.test'})).deliveryEvents, []);
assert.deepEqual(parseRawEmail(deliveryReport(failedFields, {replyId:'', originalId:''})).deliveryEvents, []);
assert.deepEqual(parseRawEmail(deliveryReport(['Final-Recipient: rfc822; victim@example.test', 'Action: delayed', 'Status: 5.1.1', ''])).deliveryEvents, []);
const ordinary = parseRawEmail([
  'From: Buyer <buyer@example.test>', 'Subject: Consulta',
  'Content-Type: text/plain', '', ...failedFields,
].join('\r\n'));
assert.equal(ordinary.deliveryEvents, undefined, 'Un texto común que menciona un rebote no se interpreta como informe de entrega');
assert.notEqual(maskSettings({ email: { smtpPassword: appPassword } }).email.smtpPassword, appPassword);
console.log('OK Gmail: SMTP, IMAP por UID, UTF-8, credencial enmascarada e informes de entrega correlacionados.');
