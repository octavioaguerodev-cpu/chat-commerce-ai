import { createOrder, getProduct, listProducts, OutOfStockError, searchProducts } from './commerce.js';
import { money, tokenize } from './text.js';

// Agente de reglas: entiende intenciones simples y opera con las mismas funciones
// (buscar, stock, pedido, link de pago) que va a usar el agente con LLM.

const NUMBER_WORDS = { un: 1, uno: 1, una: 1, do: 2, tre: 3, cuatro: 4, cinco: 5, sei: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };
const HUMAN = ['humano', 'persona', 'asesor', 'vendedor', 'operador'];
const CANCEL = ['cancelar', 'cancela', 'vaciar', 'vacia', 'borrar', 'borra'];
const CONFIRM = ['confirmar', 'confirmo', 'pagar', 'pago', 'listo', 'finalizar', 'cerrar'];
const BUY = ['quiero', 'dame', 'comprar', 'compro', 'llevo', 'agrega', 'agregar', 'agregame', 'suma', 'sumar', 'sumame', 'mandame'];
const CART = ['carrito', 'pedido', 'resumen'];
const CATALOG = ['catalogo', 'producto', 'lista', 'venden', 'vende'];
const GREETING = ['hola', 'buena', 'bueno', 'buen'];

const has = (tokens, words) => words.some((w) => tokens.includes(w));

function quantity(tokens, product) {
  const keywords = product.keywords.split(' ');
  for (const t of tokens) {
    if (keywords.includes(t)) continue;
    if (/^\d+$/.test(t)) return Number(t);
    if (NUMBER_WORDS[t]) return NUMBER_WORDS[t];
  }
  return 1;
}

function cartSummary(db, cart) {
  const lines = cart.map(({ productId, qty }) => {
    const p = getProduct(db, productId);
    return { text: `• ${qty} × ${p.name}: ${money(p.price * qty)}`, subtotal: p.price * qty };
  });
  const total = lines.reduce((sum, l) => sum + l.subtotal, 0);
  return `${lines.map((l) => l.text).join('\n')}\nTotal: ${money(total)}`;
}

const productLine = (p) => `• ${p.name}: ${money(p.price)} (${p.stock > 0 ? `${p.stock} en stock` : 'sin stock'})`;

/**
 * @returns {{ reply: string, cart: Array<{productId:number, qty:number}>, needsHuman: boolean, order?: object }}
 */
export function demoAgent(db, conversation, text, { publicUrl }) {
  const tokens = tokenize(text);
  const cart = JSON.parse(conversation.cart);
  const done = (reply, extra = {}) => ({ reply, cart, needsHuman: false, ...extra });

  if (has(tokens, HUMAN)) {
    return done('Listo, le aviso a alguien del equipo para que te responda por acá.', { needsHuman: true });
  }

  if (has(tokens, CANCEL)) {
    return done('Vacié tu carrito. ¿Querés ver algo más?', { cart: [] });
  }

  if (has(tokens, CONFIRM)) {
    if (cart.length === 0) return done('Tu carrito está vacío. Decime qué querés llevar, por ejemplo: "quiero 2 bombillas".');
    try {
      const order = createOrder(db, conversation.id, cart);
      return done(
        `¡Pedido #${order.id} confirmado!\n${cartSummary(db, cart)}\n\nPagalo acá: ${publicUrl}/checkout/${order.id}`,
        { cart: [], order },
      );
    } catch (err) {
      if (!(err instanceof OutOfStockError)) throw err;
      return done(`Uy, se acaba de agotar ${err.product.name} (quedan ${err.product.stock}). Ajustá el carrito y confirmá de nuevo.`);
    }
  }

  const matches = searchProducts(db, tokens);
  const best = matches.filter((p) => p.score === matches[0]?.score);

  if (matches.length > 0 && has(tokens, BUY)) {
    if (best.length > 1) {
      return done(`¿Cuál de estos querés?\n${best.map(productLine).join('\n')}`);
    }
    const product = best[0];
    const qty = quantity(tokens, product);
    const inCart = cart.find((i) => i.productId === product.id);
    const wanted = (inCart?.qty ?? 0) + qty;
    if (product.stock === 0) return done(`No nos queda stock de ${product.name}. ¿Te muestro otra opción?`);
    if (wanted > product.stock) return done(`De ${product.name} solo tenemos ${product.stock}. ¿Cuántos querés?`);
    const next = inCart
      ? cart.map((i) => (i === inCart ? { ...i, qty: wanted } : i))
      : [...cart, { productId: product.id, qty }];
    return done(`Sumé ${qty} × ${product.name}.\n\nTu carrito:\n${cartSummary(db, next)}\n\nEscribí "confirmar" para generar el link de pago.`, { cart: next });
  }

  if (matches.length > 0) {
    return done(`Esto es lo que tengo:\n${matches.map(productLine).join('\n')}\n\nPara sumar algo escribí, por ejemplo: "quiero 1 ${matches[0].name.toLowerCase()}".`);
  }

  if (has(tokens, CART)) {
    return done(cart.length ? `Tu carrito:\n${cartSummary(db, cart)}` : 'Tu carrito está vacío.');
  }

  if (has(tokens, CATALOG) || has(tokens, GREETING)) {
    const greeting = has(tokens, GREETING) ? '¡Hola! Soy el asistente de la tienda. ' : '';
    return done(`${greeting}Estos son nuestros productos:\n${listProducts(db).map(productLine).join('\n')}`);
  }

  return done('No te entendí bien, así que le aviso a alguien del equipo. Mientras tanto podés preguntarme por un producto, por ejemplo: "¿tenés termos?".', { needsHuman: true });
}
