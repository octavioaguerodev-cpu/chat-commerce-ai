import { addToCart, cartSummary, createOrder, listProducts, OutOfStockError, searchProducts } from './commerce.js';
import { money, tokenize } from './text.js';

// Agente de reglas: no necesita API key y es el respaldo cuando el LLM no está disponible.
// Opera con las mismas funciones de negocio (buscar, carrito, pedido) que el agente con LLM.

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
    const added = addToCart(cart, product, qty);
    if (added.error) return done(`${added.error} ${product.stock === 0 ? '¿Te muestro otra opción?' : '¿Cuántos querés?'}`);
    return done(`Sumé ${qty} × ${product.name}.\n\nTu carrito:\n${cartSummary(db, added.cart)}\n\nEscribí "confirmar" para generar el link de pago.`, { cart: added.cart });
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
