import { money } from './text.js';

export class OutOfStockError extends Error {
  constructor(product) {
    super(`Sin stock suficiente de ${product.name}`);
    this.product = product;
  }
}

export const listProducts = (db) => db.prepare('SELECT * FROM products ORDER BY name').all();

export const getProduct = (db, id) => db.prepare('SELECT * FROM products WHERE id = ?').get(id);

/** Productos ordenados por cantidad de palabras clave que aparecen en `tokens`. */
export function searchProducts(db, tokens) {
  return listProducts(db)
    .map((p) => ({ ...p, score: p.keywords.split(' ').filter((k) => tokens.includes(k)).length }))
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score);
}

/** Suma `qty` unidades al carrito si hay stock. Devuelve `{ cart }` o `{ error }`. */
export function addToCart(cart, product, qty) {
  if (!Number.isInteger(qty) || qty < 1) return { error: 'La cantidad tiene que ser un número entero mayor a cero.' };
  const inCart = cart.find((i) => i.productId === product.id);
  const wanted = (inCart?.qty ?? 0) + qty;
  if (product.stock === 0) return { error: `No nos queda stock de ${product.name}.` };
  if (wanted > product.stock) return { error: `De ${product.name} solo tenemos ${product.stock}.` };
  return {
    cart: inCart ? cart.map((i) => (i === inCart ? { ...i, qty: wanted } : i)) : [...cart, { productId: product.id, qty }],
  };
}

export function cartSummary(db, cart) {
  const lines = cart.map(({ productId, qty }) => {
    const p = getProduct(db, productId);
    return { text: `• ${qty} × ${p.name}: ${money(p.price * qty)}`, subtotal: p.price * qty };
  });
  const total = lines.reduce((sum, l) => sum + l.subtotal, 0);
  return `${lines.map((l) => l.text).join('\n')}\nTotal: ${money(total)}`;
}

/** Crea el pedido y reserva el stock en una sola transacción. */
export function createOrder(db, conversationId, cart) {
  const take = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?');
  db.exec('BEGIN');
  try {
    const items = cart.map(({ productId, qty }) => {
      const product = getProduct(db, productId);
      if (take.run(qty, productId, qty).changes !== 1) throw new OutOfStockError(product);
      return { sku: product.sku, name: product.name, price: product.price, qty };
    });
    const total = items.reduce((sum, i) => sum + i.price * i.qty, 0);
    const order = db
      .prepare('INSERT INTO orders (conversation_id, items, total) VALUES (?, ?, ?) RETURNING *')
      .get(conversationId, JSON.stringify(items), total);
    db.exec('COMMIT');
    return { ...order, items };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** Marca el pedido como pagado. Devuelve undefined si no existe o ya estaba pago (idempotente). */
export const markPaid = (db, orderId) =>
  db
    .prepare("UPDATE orders SET status = 'paid', paid_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ? AND status = 'pending' RETURNING *")
    .get(orderId);

/** Vence pedidos impagos con más de `ttlMinutes` y devuelve su stock, todo en una transacción. */
export function expireOrders(db, ttlMinutes) {
  const restore = db.prepare('UPDATE products SET stock = stock + ? WHERE sku = ?');
  db.exec('BEGIN');
  try {
    const expired = db
      .prepare(
        "UPDATE orders SET status = 'expired' WHERE status = 'pending' AND created_at <= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', ?) RETURNING *",
      )
      .all(`-${ttlMinutes} minutes`);
    for (const order of expired) {
      for (const item of JSON.parse(order.items)) restore.run(item.qty, item.sku);
    }
    db.exec('COMMIT');
    return expired;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// ponytail: "hoy" en hora argentina con offset fijo (-3, sin horario de verano); usar la zona del negocio si hay multi-país.
const TODAY = "date(created_at, '-3 hours') = date('now', '-3 hours')";

/** Métricas del día para la pantalla de Inicio. */
export function getStats(db) {
  const one = (sql) => db.prepare(sql).get();
  const sales = one(`SELECT COUNT(*) AS orders, COALESCE(SUM(total), 0) AS total FROM orders WHERE status = 'paid' AND ${TODAY}`);
  const pending = one(`SELECT COUNT(*) AS orders, COALESCE(SUM(total), 0) AS total FROM orders WHERE status = 'pending'`);
  const replies = one(
    `SELECT COALESCE(SUM(author = 'ai'), 0) AS ai, COALESCE(SUM(author = 'agent'), 0) AS agent FROM messages WHERE direction = 'out' AND ${TODAY}`,
  );
  const chats = one(`SELECT COUNT(DISTINCT conversation_id) AS n FROM messages WHERE direction = 'in' AND ${TODAY}`).n;
  const waiting = one('SELECT COUNT(*) AS n FROM conversations WHERE needs_human = 1').n;
  const topProducts = db
    .prepare(
      `SELECT json_extract(i.value, '$.name') AS name, SUM(json_extract(i.value, '$.qty')) AS qty,
              SUM(json_extract(i.value, '$.qty') * json_extract(i.value, '$.price')) AS total
       FROM orders o, json_each(o.items) i
       WHERE o.status = 'paid'
       GROUP BY name ORDER BY total DESC LIMIT 5`,
    )
    .all();
  const lowStock = db.prepare('SELECT name, stock FROM products WHERE stock <= 3 ORDER BY stock, name').all();
  return { sales, pending, replies, chats, waiting, topProducts, lowStock };
}

export const getOrder = (db, id) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  return order && { ...order, items: JSON.parse(order.items) };
};

export const listOrders = (db) =>
  db
    .prepare('SELECT o.*, c.name AS customer, c.phone FROM orders o JOIN conversations c ON c.id = o.conversation_id ORDER BY o.id DESC')
    .all()
    .map((o) => ({ ...o, items: JSON.parse(o.items) }));
