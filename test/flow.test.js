import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listOrders, listProducts } from '../server/commerce.js';
import { openDb } from '../server/db.js';
import { createInbox } from '../server/inbox.js';

function setup() {
  const db = openDb(':memory:');
  const inbox = createInbox(db, { publicUrl: 'http://test' });
  let n = 0;
  const say = (text, phone = '5491100000001') => {
    const { conversationId } = inbox.receive({ phone, name: 'Ana', text, waId: `wamid.${++n}` });
    return inbox.messages(conversationId).at(-1).body;
  };
  const stock = (sku) => listProducts(db).find((p) => p.sku === sku).stock;
  return { db, inbox, say, stock };
}

test('consulta, carrito, pedido con reserva de stock y pago', () => {
  const { db, inbox, say, stock } = setup();

  assert.match(say('hola, ¿tenés termos?'), /Termo Stanley 1 L: \$\s?89\.000 \(6 en stock\)/);
  assert.match(say('quiero 2 termos stanley'), /Sumé 2 × Termo Stanley 1 L/);
  assert.match(say('sumame tres bombillas'), /Total: \$\s?197\.500/);

  const confirmation = say('confirmar');
  assert.match(confirmation, /http:\/\/test\/checkout\/1/);
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

test('no vende sin stock ni más de lo disponible', () => {
  const { say } = setup();
  assert.match(say('quiero el mate imperial'), /No nos queda stock/);
  assert.match(say('quiero 5 kit matero completo'), /solo tenemos 3/);
  assert.match(say('confirmar'), /carrito está vacío/);
});

test('el stock se valida otra vez al confirmar', () => {
  const { say } = setup();
  say('quiero 3 kit matero completo', '5491100000001');
  say('quiero 2 kit matero completo', '5491100000002');
  assert.match(say('confirmar', '5491100000001'), /Pedido #1 confirmado/);
  assert.match(say('confirmar', '5491100000002'), /se acaba de agotar Kit matero completo/);
});

test('ignora webhooks duplicados y deriva a un humano', () => {
  const { inbox, say } = setup();
  inbox.receive({ phone: '5491100000009', name: 'Leo', text: 'hola', waId: 'wamid.dup' });
  assert.deepEqual(inbox.receive({ phone: '5491100000009', name: 'Leo', text: 'hola', waId: 'wamid.dup' }), { duplicate: true });

  say('quiero hablar con una persona');
  assert.equal(inbox.listConversations().find((c) => c.name === 'Ana').needs_human, 1);
});
