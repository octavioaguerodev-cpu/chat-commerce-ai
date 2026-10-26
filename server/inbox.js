import { demoAgent } from './agent.js';
import { getOrder, markPaid } from './commerce.js';
import { money } from './text.js';

const MAX_BODY = 2000;

export function createInbox(db, { publicUrl, agent = demoAgent, emit = () => {} }) {
  const upsertConversation = db.prepare(
    'INSERT INTO conversations (phone, name) VALUES (?, ?) ON CONFLICT(phone) DO UPDATE SET name = excluded.name RETURNING *',
  );
  const insertMessage = db.prepare(
    'INSERT OR IGNORE INTO messages (conversation_id, direction, author, body, wa_id) VALUES (?, ?, ?, ?, ?)',
  );
  const getConversation = db.prepare('SELECT * FROM conversations WHERE id = ?');
  const saveState = db.prepare('UPDATE conversations SET cart = ?, needs_human = ? WHERE id = ?');
  const setNeedsHuman = db.prepare('UPDATE conversations SET needs_human = ? WHERE id = ?');

  // Salida a WhatsApp: en modo simulado el mensaje queda guardado y el simulador lo muestra.
  const send = (conversationId, author, body) => insertMessage.run(conversationId, 'out', author, body, null);

  return {
    /** Mensaje entrante del cliente. Ignora duplicados por `waId` (WhatsApp reintenta webhooks). */
    receive({ phone, name, text, waId }) {
      const body = String(text).slice(0, MAX_BODY);
      const conversation = upsertConversation.get(phone, name || phone);
      if (insertMessage.run(conversation.id, 'in', 'customer', body, waId ?? null).changes === 0) {
        return { duplicate: true };
      }
      if (!conversation.ai_enabled) {
        setNeedsHuman.run(1, conversation.id);
      } else {
        try {
          const result = agent(db, conversation, body, { publicUrl });
          send(conversation.id, 'ai', result.reply);
          saveState.run(JSON.stringify(result.cart), result.needsHuman ? 1 : 0, conversation.id);
          if (result.order) emit('orders');
        } catch (err) {
          console.error('Falló el agente:', err);
          setNeedsHuman.run(1, conversation.id);
        }
      }
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

    listConversations: () =>
      db
        .prepare(
          `SELECT c.id, c.phone, c.name, c.ai_enabled, c.needs_human, m.body AS last_body, m.direction AS last_direction, m.created_at AS last_at
           FROM conversations c
           JOIN messages m ON m.id = (SELECT MAX(id) FROM messages WHERE conversation_id = c.id)
           ORDER BY m.id DESC`,
        )
        .all(),

    messages: (conversationId) =>
      db.prepare('SELECT id, direction, author, body, created_at FROM messages WHERE conversation_id = ? ORDER BY id').all(conversationId),
  };
}
