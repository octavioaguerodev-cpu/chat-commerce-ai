import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { createApp } from '../server/app.js';
import { getStats, listProducts } from '../server/commerce.js';
import { openDb } from '../server/db.js';
import { seedDemoData } from '../server/demo-data.js';

const payload = (text, id) => ({
  entry: [{ changes: [{ value: { contacts: [{ wa_id: '549111', profile: { name: 'Ana' } }], messages: [{ from: '549111', id, type: 'text', text: { body: text } }] } }] }],
});

async function serve(options) {
  const db = openDb(':memory:');
  const { app } = createApp(db, { publicUrl: 'http://test', ...options });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body, headers = {}) =>
    fetch(`${base}/webhook/whatsapp`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });
  const messageCount = () => db.prepare('SELECT COUNT(*) AS n FROM messages').get().n;
  return { base, post, messageCount, close: () => server.close() };
}

const until = async (check) => {
  for (let i = 0; i < 50 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
};

test('con App Secret solo entra lo firmado por Meta', async (t) => {
  const s = await serve({ whatsapp: { appSecret: 'secreto' } });
  t.after(s.close);
  const body = JSON.stringify(payload('hola', 'wamid.1'));
  const sign = (secret) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

  assert.equal((await s.post(body)).status, 401, 'sin firma');
  assert.equal((await s.post(body, { 'X-Hub-Signature-256': sign('otro') })).status, 401, 'firma con otro secreto');
  assert.equal(s.messageCount(), 0);

  assert.equal((await s.post(body, { 'X-Hub-Signature-256': sign('secreto') })).status, 200);
  await until(() => s.messageCount() === 2);
  assert.equal(s.messageCount(), 2, 'entra el mensaje y el asistente responde');
});

test('sin App Secret el webhook público se limita por IP', async (t) => {
  const s = await serve({ webhookPerMinute: 2 });
  t.after(s.close);
  const statuses = [];
  for (let i = 0; i < 3; i++) statuses.push((await s.post(JSON.stringify(payload('hola', `wamid.${i}`)))).status);
  assert.deepEqual(statuses, [200, 200, 429]);
});

test('verificación del webhook de Meta', async (t) => {
  const s = await serve({ whatsapp: { verifyToken: 'token' } });
  t.after(s.close);
  const verify = (token) => fetch(`${s.base}/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=123`);
  const ok = await verify('token');
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), '123');
  assert.equal((await verify('mal')).status, 403);
});

test('los datos de demo dejan stock y métricas consistentes, y se cargan una sola vez', () => {
  const db = openDb(':memory:');
  assert.equal(seedDemoData(db, 'http://test'), true);
  assert.equal(seedDemoData(db, 'http://test'), false);
  const stock = Object.fromEntries(listProducts(db).map((p) => [p.sku, p.stock]));
  assert.equal(stock['TER-STA-1L'], 5);
  assert.equal(stock['YER-1KG'], 38);
  const s = getStats(db);
  assert.equal(s.sales.total, 95500);
  assert.equal(s.pending.total, 27600);
  assert.equal(s.waiting, 1);
});
