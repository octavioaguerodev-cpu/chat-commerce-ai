import express from 'express';
import { getOrder, listOrders, listProducts } from './commerce.js';
import { createInbox } from './inbox.js';
import { money } from './text.js';

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Extrae los mensajes de texto de un webhook con el formato de WhatsApp Cloud API. */
function parseWhatsApp(payload) {
  const out = [];
  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value ?? {};
      const names = new Map((value.contacts ?? []).map((c) => [c.wa_id, c.profile?.name]));
      for (const m of value.messages ?? []) {
        if (m?.type !== 'text' || typeof m.from !== 'string' || typeof m.text?.body !== 'string') continue;
        out.push({ phone: m.from, name: names.get(m.from), text: m.text.body, waId: m.id });
      }
    }
  }
  return out;
}

export function createApp(db, { publicUrl }) {
  const clients = new Set();
  const emit = (type) => {
    for (const res of clients) res.write(`data: ${JSON.stringify({ type })}\n\n`);
  };
  const inbox = createInbox(db, { publicUrl, emit });
  const app = express();
  app.use(express.json({ limit: '100kb' }));

  app.post('/webhook/whatsapp', (req, res) => {
    for (const message of parseWhatsApp(req.body)) inbox.receive(message);
    res.sendStatus(200);
  });

  app.get('/api/events', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();
    clients.add(res);
    req.on('close', () => clients.delete(res));
  });

  app.get('/api/conversations', (req, res) => res.json(inbox.listConversations()));
  app.get('/api/conversations/:id/messages', (req, res) => res.json(inbox.messages(Number(req.params.id))));

  app.post('/api/conversations/:id/messages', (req, res) => {
    const text = req.body?.text;
    if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'El mensaje está vacío' });
    if (!inbox.reply(Number(req.params.id), text.trim())) return res.status(404).json({ error: 'No existe la conversación' });
    res.sendStatus(204);
  });

  app.patch('/api/conversations/:id', (req, res) => {
    if (typeof req.body?.ai_enabled !== 'boolean') return res.status(400).json({ error: 'ai_enabled debe ser booleano' });
    if (!inbox.setAiEnabled(Number(req.params.id), req.body.ai_enabled)) return res.status(404).json({ error: 'No existe la conversación' });
    res.sendStatus(204);
  });

  app.get('/api/orders', (req, res) => res.json(listOrders(db)));
  app.get('/api/products', (req, res) => res.json(listProducts(db)));

  // Checkout simulado: reemplaza al link de Mercado Pago hasta conectar credenciales reales.
  app.get('/checkout/:id', (req, res) => {
    const order = getOrder(db, Number(req.params.id));
    if (!order) return res.status(404).send('Pedido inexistente');
    const rows = order.items.map((i) => `<li>${i.qty} × ${escapeHtml(i.name)} <b>${money(i.price * i.qty)}</b></li>`).join('');
    const action =
      order.status === 'paid'
        ? '<p class="ok">✓ Pago aprobado. Ya podés volver al chat.</p>'
        : `<form method="post" action="/checkout/${order.id}/pay"><button>Pagar ${money(order.total)}</button></form>`;
    res.send(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Pedido #${order.id}</title>
<style>body{font-family:system-ui,sans-serif;max-width:420px;margin:48px auto;padding:0 16px;color:#1f2933}
.card{border:1px solid #dde3ea;border-radius:12px;padding:24px}ul{padding-left:18px;line-height:1.8}
button{width:100%;padding:12px;border:0;border-radius:8px;background:#009ee3;color:#fff;font-size:16px;cursor:pointer}
.ok{color:#0a7d3b;font-weight:600}small{color:#6b7785}</style>
<div class="card"><small>Checkout simulado</small><h2>Pedido #${order.id}</h2><ul>${rows}</ul>
<p>Total: <b>${money(order.total)}</b></p>${action}</div></html>`);
  });

  app.post('/checkout/:id/pay', (req, res) => {
    inbox.paymentApproved(Number(req.params.id));
    res.redirect(303, `/checkout/${req.params.id}`);
  });

  return { app, inbox };
}
