import assert from 'node:assert/strict';
import { test } from 'node:test';
import { demoAgent } from '../server/agent.js';
import { listOrders, listProducts } from '../server/commerce.js';
import { openDb } from '../server/db.js';
import { createInbox } from '../server/inbox.js';
import { createLlmAgent, withFallback } from '../server/llm-agent.js';

function setup(agent) {
  const db = openDb(':memory:');
  const inbox = createInbox(db, { publicUrl: 'http://test', agent });
  let n = 0;
  const say = async (text, phone = '5491100000001') => {
    const { conversationId } = await inbox.receive({ phone, name: 'Ana', text, waId: `wamid.${++n}` });
    return inbox.messages(conversationId).at(-1).body;
  };
  const stock = (sku) => listProducts(db).find((p) => p.sku === sku).stock;
  return { db, inbox, say, stock };
}

/** Modelo falso: devuelve las respuestas en orden y guarda lo que recibió. */
function scriptedModel(...replies) {
  const calls = [];
  const complete = async (body) => {
    calls.push(structuredClone(body.messages));
    const next = replies.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  return { complete, calls };
}
const toolCall = (name, args = {}) => ({
  role: 'assistant',
  content: null,
  tool_calls: [{ id: `call_${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
});
const text = (content) => ({ role: 'assistant', content });
const toolResults = (messages) => messages.filter((m) => m.role === 'tool').map((m) => m.content);

test('consulta, carrito, pedido con reserva de stock y pago', async () => {
  const { db, inbox, say, stock } = setup();

  assert.match(await say('hola, ¿tenés termos?'), /Termo Stanley 1 L: \$\s?89\.000 \(6 en stock\)/);
  assert.match(await say('quiero 2 termos stanley'), /Sumé 2 × Termo Stanley 1 L/);
  assert.match(await say('sumame tres bombillas'), /Total: \$\s?197\.500/);

  assert.match(await say('confirmar'), /http:\/\/test\/checkout\/1/);
  assert.equal(stock('TER-STA-1L'), 4);
  assert.equal(stock('BOM-ACE'), 27);

  const [order] = listOrders(db);
  assert.equal(order.total, 197500);
  assert.equal(order.status, 'pending');

  assert.equal(inbox.paymentApproved(order.id), true);
  assert.equal(inbox.paymentApproved(order.id), false, 'un pago repetido no se procesa dos veces');
  assert.equal(listOrders(db)[0].status, 'paid');
  assert.match(inbox.messages(order.conversation_id).at(-1).body, /Recibimos tu pago/);
});

test('no vende sin stock ni más de lo disponible', async () => {
  const { say } = setup();
  assert.match(await say('quiero el mate imperial'), /No nos queda stock/);
  assert.match(await say('quiero 5 kit matero completo'), /solo tenemos 3/);
  assert.match(await say('confirmar'), /carrito está vacío/);
});

test('el stock se valida otra vez al confirmar', async () => {
  const { say } = setup();
  await say('quiero 3 kit matero completo', '5491100000001');
  await say('quiero 2 kit matero completo', '5491100000002');
  assert.match(await say('confirmar', '5491100000001'), /Pedido #1 confirmado/);
  assert.match(await say('confirmar', '5491100000002'), /se acaba de agotar Kit matero completo/);
});

test('ignora webhooks duplicados y deriva a un humano', async () => {
  const { inbox, say } = setup();
  await inbox.receive({ phone: '5491100000009', name: 'Leo', text: 'hola', waId: 'wamid.dup' });
  assert.deepEqual(await inbox.receive({ phone: '5491100000009', name: 'Leo', text: 'hola', waId: 'wamid.dup' }), { duplicate: true });

  await say('quiero hablar con una persona');
  assert.equal(inbox.listConversations().find((c) => c.name === 'Ana').needs_human, 1);
});

test('mensajes seguidos del mismo cliente se responden en orden, sin pisar el carrito', async () => {
  const seen = [];
  const slowAgent = async (db, conversation, text, ctx) => {
    seen.push({ text, history: ctx.history.length, cart: conversation.cart });
    await new Promise((r) => setTimeout(r, 20));
    return demoAgent(db, conversation, text, ctx);
  };
  const { say, db } = setup(slowAgent);
  await Promise.all([say('quiero 1 bombilla'), say('quiero 1 yerba')]);
  assert.deepEqual(seen.map((s) => [s.text, s.history]), [['quiero 1 bombilla', 0], ['quiero 1 yerba', 2]]);
  assert.equal(JSON.parse(db.prepare('SELECT cart FROM conversations').get().cart).length, 2);
});

test('agente LLM: opera el carrito y el pedido solo con las herramientas', async () => {
  const model = scriptedModel(
    toolCall('agregar_al_carrito', { sku: 'TER-STA-1L', cantidad: 10 }),
    toolCall('agregar_al_carrito', { sku: 'TER-STA-1L', cantidad: 2 }),
    toolCall('confirmar_pedido'),
    text('Listo, tu pedido está confirmado.'),
  );
  const { db, say, stock } = setup(createLlmAgent(model));

  assert.equal(await say('quiero 2 termos stanley y pagar'), 'Listo, tu pedido está confirmado.');
  const results = toolResults(model.calls.at(-1));
  assert.match(results[0], /solo tenemos 6/, 'el stock lo valida el backend, no el modelo');
  assert.match(results[2], /"link_de_pago":"http:\/\/test\/checkout\/1"/);
  assert.equal(stock('TER-STA-1L'), 4);
  assert.equal(listOrders(db)[0].total, 178000);
});

test('agente LLM: si falla después de crear el pedido, el cliente igual recibe el link', async () => {
  const model = scriptedModel(toolCall('agregar_al_carrito', { sku: 'BOM-ACE', cantidad: 1 }), toolCall('confirmar_pedido'), new Error('HTTP 503'));
  const { say, db } = setup(createLlmAgent(model));
  assert.match(await say('una bombilla y confirmo'), /Pedido #1 confirmado! Pagalo acá: http:\/\/test\/checkout\/1/);
  assert.equal(listOrders(db).length, 1);
});

test('si el LLM no responde o se agota el cupo diario, responde el agente de reglas', async () => {
  const failing = scriptedModel(new Error('HTTP 503'));
  const { say } = setup(withFallback(createLlmAgent(failing), demoAgent, { dailyLimit: 1 }));
  assert.match(await say('¿tenés bombillas?'), /Bombilla de acero/);

  const working = scriptedModel(text('respuesta del LLM'));
  const limited = setup(withFallback(createLlmAgent(working), demoAgent, { dailyLimit: 0 }));
  assert.match(await limited.say('¿tenés bombillas?'), /Bombilla de acero/);
  assert.equal(working.calls.length, 0);
});
