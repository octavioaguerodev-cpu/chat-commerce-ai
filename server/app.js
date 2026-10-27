import { createHmac, timingSafeEqual } from 'node:crypto';
import express from 'express';
import { getOrder, getStats, listOrders, listProducts } from './commerce.js';
import { createInbox } from './inbox.js';
import { rateLimiter } from './limit.js';
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

/** Meta firma cada webhook con HMAC-SHA256 del cuerpo crudo usando el App Secret. */
function validSignature(rawBody, header, appSecret) {
  if (!rawBody || typeof header !== 'string') return false;
  const expected = Buffer.from(`sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`);
  const received = Buffer.from(header);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function createApp(db, { publicUrl, agent, whatsapp = {}, webhookPerMinute = 30 }) {
  const clients = new Set();
  const emit = (type) => {
    for (const res of clients) res.write(`data: ${JSON.stringify({ type })}\n\n`);
  };
  const inbox = createInbox(db, { publicUrl, agent, emit });
  const perIp = rateLimiter(webhookPerMinute, 60_000);
  const app = express();
  app.set('trust proxy', 1); // Render pone un proxy adelante: req.ip es la IP real del cliente.
  app.use(express.json({ limit: '100kb', verify: (req, res, buf) => (req.rawBody = buf) }));

  // Verificación que hace Meta al registrar el webhook.
  app.get('/webhook/whatsapp', (req, res) => {
    const ok = whatsapp.verifyToken && req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === whatsapp.verifyToken;
    if (!ok) return res.sendStatus(403);
    res.type('text/plain').send(String(req.query['hub.challenge'] ?? ''));
  });

  // Con WHATSAPP_APP_SECRET solo entra lo firmado por Meta. Sin él (demo con simulador),
  // el webhook es público y se limita por IP para que nadie gaste el cupo de la IA.
  // WhatsApp pide responder 200 rápido; la respuesta al cliente se procesa después.
  app.post('/webhook/whatsapp', (req, res) => {
    if (whatsapp.appSecret) {
      if (!validSignature(req.rawBody, req.get('x-hub-signature-256'), whatsapp.appSecret)) return res.sendStatus(401);
    } else if (!perIp(req.ip)) {
      return res.status(429).json({ error: 'Demasiados mensajes, esperá un minuto' });
    }
    res.sendStatus(200);
    for (const message of parseWhatsApp(req.body)) {
      inbox.receive(message).catch((err) => console.error('No se pudo procesar el mensaje:', err));
    }
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
  app.get('/api/stats', (req, res) => res.json(getStats(db)));

  // Checkout simulado: reemplaza al link de Mercado Pago hasta conectar credenciales reales.
  app.get('/checkout/:id', (req, res) => {
    const order = getOrder(db, Number(req.params.id));
    if (!order) return res.status(404).send('Pedido inexistente');
    const rows = order.items.map((i) => `<li>${i.qty} × ${escapeHtml(i.name)} <b>${money(i.price * i.qty)}</b></li>`).join('');
    const action = {
      paid: '<p class="ok">✓ Pago aprobado. Ya podés volver al chat.</p>',
      expired: '<p class="expired">Este pedido venció. Escribinos por el chat para armarlo de nuevo.</p>',
      pending: `<form method="post" action="/checkout/${order.id}/pay"><button>Pagar ${money(order.total)}</button></form>`,
    }[order.status];
    res.send(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Pedido #${order.id}</title>
<style>body{font-family:system-ui,sans-serif;max-width:420px;margin:48px auto;padding:0 16px;color:#1f2933}
.card{border:1px solid #dde3ea;border-radius:12px;padding:24px}ul{padding-left:18px;line-height:1.8}
button{width:100%;padding:12px;border:0;border-radius:8px;background:#009ee3;color:#fff;font-size:16px;cursor:pointer}
.ok{color:#0a7d3b;font-weight:600}.expired{color:#c0392b;font-weight:600}small{color:#6b7785}</style>
<div class="card"><small>Checkout simulado</small><h2>Pedido #${order.id}</h2><ul>${rows}</ul>
<p>Total: <b>${money(order.total)}</b></p>${action}</div></html>`);
  });

  app.post('/checkout/:id/pay', (req, res) => {
    inbox.paymentApproved(Number(req.params.id));
    res.redirect(303, `/checkout/${req.params.id}`);
  });

  return { app, inbox };
}
