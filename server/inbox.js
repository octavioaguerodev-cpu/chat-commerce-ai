import { demoAgent } from './agent.js';
import { expireOrders, getOrder, markPaid } from './commerce.js';
import { money } from './text.js';

const MAX_BODY = 2000;

export function createInbox(db, { publicUrl, agent = demoAgent, emit = () => {} }) {
  const upsertConversation = db.prepare(
    'INSERT INTO conversations (phone, name) VALUES (?, ?) ON CONFLICT(phone) DO UPDATE SET name = excluded.name RETURNING *',
  );
  const insertMessage = db.prepare(
    'INSERT OR IGNORE INTO messages (conversation_id, direction, author, body, wa_id, meta) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const getConversation = db.prepare('SELECT * FROM conversations WHERE id = ?');
  const saveState = db.prepare('UPDATE conversations SET cart = ?, needs_human = ? WHERE id = ?');
  const setNeedsHuman = db.prepare('UPDATE conversations SET needs_human = ? WHERE id = ?');

  const listMessages = db.prepare('SELECT id, direction, author, body, meta, created_at FROM messages WHERE conversation_id = ? ORDER BY id');
  const getMessage = db.prepare('SELECT body FROM messages WHERE id = ?');

  // Salida a WhatsApp: en modo simulado el mensaje queda guardado y el simulador lo muestra.
  // `meta` guarda quién respondió (IA o reglas) y qué herramientas usó, para el panel del vendedor.
  const send = (conversationId, author, body, meta = null) =>
    insertMessage.run(conversationId, 'out', author, body, null, meta && JSON.stringify(meta));

  // Un mensaje a la vez por conversación: dos mensajes seguidos no pisan el carrito del otro.
  const queues = new Map();
  const serialize = (id, task) => {
    const run = (queues.get(id) ?? Promise.resolve()).then(task);
    const tail = run.catch(() => {});
    queues.set(id, tail);
    tail.then(() => queues.get(id) === tail && queues.delete(id));
    return run;
  };

  // Conversaciones que el asistente está respondiendo ahora ("escribiendo…").
  const typing = new Set();
  async function answer(conversationId, messageId) {
    const conversation = getConversation.get(conversationId);
    if (!conversation.ai_enabled) {
      setNeedsHuman.run(1, conversationId);
      return;
    }
    // Lo anterior al mensaje actual, más respuestas ya enviadas a mensajes previos que se procesaron después.
    const history = listMessages.all(conversationId).filter((m) => m.id < messageId || m.direction === 'out');
    typing.add(conversationId);
    emit('inbox');
    try {
      const result = await agent(db, conversation, getMessage.get(messageId).body, { publicUrl, history });
      send(conversationId, 'ai', result.reply, { engine: result.engine ?? 'reglas', trace: result.trace ?? [] });
      saveState.run(JSON.stringify(result.cart), result.needsHuman ? 1 : 0, conversationId);
      if (result.order) emit('orders');
    } catch (err) {
      console.error('Falló el agente:', err);
      setNeedsHuman.run(1, conversationId);
    } finally {
      typing.delete(conversationId);
    }
  }

  return {
    /** Mensaje entrante del cliente. Ignora duplicados por `waId` (WhatsApp reintenta webhooks). */
    async receive({ phone, name, text, waId }) {
      const body = String(text).slice(0, MAX_BODY);
      const conversation = upsertConversation.get(phone, name || phone);
      const inserted = insertMessage.run(conversation.id, 'in', 'customer', body, waId ?? null, null);
      if (inserted.changes === 0) {
        return { duplicate: true };
      }
      emit('inbox');
      await serialize(conversation.id, () => answer(conversation.id, Number(inserted.lastInsertRowid)));
      emit('inbox');
      return { conversationId: conversation.id };
    },

    /** Respuesta manual de un vendedor desde el panel. */
    reply(conversationId, text) {
      if (!getConversation.get(conversationId)) return false;
      send(conversationId, 'agent', String(text).slice(0, MAX_BODY));
      setNeedsHuman.run(0, conversationId);
      emit('inbox');
      return true;
    },

    setAiEnabled(conversationId, enabled) {
      const changed = db.prepare('UPDATE conversations SET ai_enabled = ? WHERE id = ?').run(enabled ? 1 : 0, conversationId).changes;
      emit('inbox');
      return changed === 1;
    },

    /** Notificación del proveedor de pagos. */
    paymentApproved(orderId) {
      if (!markPaid(db, orderId)) return false;
      const order = getOrder(db, orderId);
      send(order.conversation_id, 'ai', `¡Recibimos tu pago de ${money(order.total)} para el pedido #${order.id}! En breve lo preparamos.`);
      emit('orders');
      emit('inbox');
      return true;
    },

    /** Vence los pedidos impagos más viejos que `ttlMinutes`, devuelve su stock y avisa al cliente. */
    expireUnpaid(ttlMinutes) {
      const expired = expireOrders(db, ttlMinutes);
      for (const order of expired) {
        send(order.conversation_id, 'ai', `Tu pedido #${order.id} venció porque no se registró el pago. Si todavía lo querés, escribime y lo armamos de nuevo.`);
      }
      if (expired.length) {
        emit('orders');
        emit('inbox');
      }
      return expired.length;
    },

    listConversations: () =>
      db
        .prepare(
          `SELECT c.id, c.phone, c.name, c.ai_enabled, c.needs_human, m.body AS last_body, m.direction AS last_direction, m.created_at AS last_at
           FROM conversations c
           JOIN messages m ON m.id = (SELECT MAX(id) FROM messages WHERE conversation_id = c.id)
           ORDER BY m.id DESC`,
        )
        .all()
        .map((c) => ({ ...c, typing: typing.has(c.id) })),

    messages: (conversationId) => listMessages.all(conversationId).map((m) => ({ ...m, meta: m.meta && JSON.parse(m.meta) })),
  };
}
