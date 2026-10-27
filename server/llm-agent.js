import { addToCart, cartSummary, createOrder, listProducts, OutOfStockError, searchProducts } from './commerce.js';
import { rateLimiter } from './limit.js';
import { tokenize } from './text.js';

const MAX_TOOL_ROUNDS = 8;
const HISTORY = 20;
const TIMEOUT_MS = 15_000; // por llamada al modelo
const TURN_MS = 30_000; // por mensaje del cliente; después responde el agente de reglas

const SYSTEM = `Sos el asistente de ventas por WhatsApp de una tienda argentina de mates.
Hablás en español rioplatense, con mensajes cortos y amables, sin markdown (WhatsApp no lo muestra).
Reglas:
- Precios, stock y productos salen SOLO de las herramientas. Nunca los inventes ni prometas algo que no figure.
- Para sumar productos llamá a agregar_al_carrito con el sku exacto. Si no sabés el sku, buscá primero.
- Nunca digas que sumaste, sacaste o confirmaste algo si no llamaste a la herramienta y te devolvió éxito.
- El carrito real es el que figura abajo o el que devuelven las herramientas, no lo que se dijo antes en el chat.
- Confirmá el pedido solo cuando el cliente lo pida. El link de pago sale únicamente de confirmar_pedido; pasalo tal cual.
- Si piden algo que no podés resolver (envíos, reclamos, descuentos, factura) o quieren hablar con una persona, usá derivar_a_humano.`;

const fn = (name, description, properties = {}, required = []) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } },
});

const TOOLS = [
  fn('buscar_productos', 'Busca productos del catálogo por nombre o tipo. Con consulta vacía devuelve todo el catálogo.', {
    consulta: { type: 'string' },
  }),
  fn('ver_carrito', 'Muestra el carrito actual con subtotales y total.'),
  fn('agregar_al_carrito', 'Suma unidades de un producto al carrito, validando stock.', { sku: { type: 'string' }, cantidad: { type: 'integer' } }, ['sku', 'cantidad']),
  fn('quitar_del_carrito', 'Saca un producto del carrito.', { sku: { type: 'string' } }, ['sku']),
  fn('confirmar_pedido', 'Crea el pedido con el carrito actual, reserva el stock y devuelve el link de pago.'),
  fn('derivar_a_humano', 'Avisa a una persona del equipo para que siga la conversación.', { motivo: { type: 'string' } }, ['motivo']),
];

const productView = (p) => ({ sku: p.sku, nombre: p.name, precio: p.price, stock: p.stock });

/** Ejecuta una herramienta sobre el estado de la conversación. Devuelve lo que ve el modelo. */
function runTool(db, state, name, args) {
  const bySku = (sku) => listProducts(db).find((p) => p.sku === sku);
  switch (name) {
    case 'buscar_productos': {
      const matches = args.consulta ? searchProducts(db, tokenize(args.consulta)) : [];
      return matches.length ? matches.map(productView) : { sin_coincidencias: Boolean(args.consulta), catalogo: listProducts(db).map(productView) };
    }
    case 'ver_carrito':
      return state.cart.length ? cartSummary(db, state.cart) : 'El carrito está vacío.';
    case 'agregar_al_carrito': {
      const product = bySku(args.sku);
      if (!product) return { error: `No existe el sku ${args.sku}` };
      const added = addToCart(state.cart, product, args.cantidad);
      if (added.error) return { error: added.error };
      state.cart = added.cart;
      return cartSummary(db, state.cart);
    }
    case 'quitar_del_carrito': {
      const product = bySku(args.sku);
      state.cart = state.cart.filter((i) => i.productId !== product?.id);
      return state.cart.length ? cartSummary(db, state.cart) : 'El carrito quedó vacío.';
    }
    case 'confirmar_pedido': {
      if (!state.cart.length) return { error: 'El carrito está vacío.' };
      try {
        const summary = cartSummary(db, state.cart);
        state.order = createOrder(db, state.conversation.id, state.cart);
        state.cart = [];
        return { pedido: state.order.id, resumen: summary, link_de_pago: `${state.publicUrl}/checkout/${state.order.id}` };
      } catch (err) {
        if (err instanceof OutOfStockError) return { error: `${err.product.name} ya no tiene stock suficiente (quedan ${err.product.stock}).` };
        throw err;
      }
    }
    case 'derivar_a_humano':
      state.needsHuman = true;
      return 'Listo, el equipo ya fue avisado.';
    default:
      return { error: `Herramienta desconocida: ${name}` };
  }
}

/** Cliente para cualquier API compatible con OpenAI Chat Completions (Gemini, OpenAI, Groq…). */
export function openAiCompatible({ baseUrl, apiKey, models }) {
  return async (body, { deadline = Infinity } = {}) => {
    let lastError;
    for (const model of models) {
      const timeout = Math.min(TIMEOUT_MS, deadline - Date.now());
      if (timeout <= 0) break;
      try {
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, model }),
          signal: AbortSignal.timeout(timeout),
        });
        if (res.ok) return (await res.json()).choices[0].message;
        lastError = new Error(`${model}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
        // Saturación o cuota: probamos el siguiente modelo. Otro error es un problema nuestro.
        if (res.status !== 429 && res.status !== 503) break;
      } catch (err) {
        if (err.name !== 'TimeoutError') throw err;
        lastError = new Error(`${model}: sin respuesta en ${Math.round(timeout / 1000)}s`);
      }
    }
    throw lastError ?? new Error('Se agotó el tiempo para responder');
  };
}

/** `complete(body) → message` es la llamada al modelo; inyectable para tests. */
export function createLlmAgent({ complete }) {
  return async (db, conversation, text, { publicUrl, history = [] }) => {
    const state = { conversation, publicUrl, cart: JSON.parse(conversation.cart), needsHuman: false, order: undefined };
    // Qué herramientas usó el modelo en este mensaje; el panel lo muestra al vendedor.
    const trace = [];
    const done = (reply) => ({ reply, cart: state.cart, needsHuman: state.needsHuman, order: state.order, engine: 'ia', trace });
    const messages = [
      {
        role: 'system',
        content: `${SYSTEM}\n\nCliente: ${conversation.name}.\nCarrito actual:\n${state.cart.length ? cartSummary(db, state.cart) : 'vacío'}`,
      },
      ...history.slice(-HISTORY).map((m) => ({ role: m.direction === 'in' ? 'user' : 'assistant', content: m.body })),
      { role: 'user', content: text },
    ];
    const deadline = Date.now() + TURN_MS;
    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        if (Date.now() > deadline) throw new Error(`El modelo tardó más de ${TURN_MS / 1000}s en este mensaje`);
        const message = await complete({ messages, tools: TOOLS }, { deadline });
        // Se reenvía el mensaje tal cual: Gemini exige recibir de vuelta su firma de razonamiento.
        messages.push(message);
        if (!message.tool_calls?.length) {
          if (!message.content?.trim()) throw new Error('El modelo respondió vacío');
          return done(message.content.trim());
        }
        for (const call of message.tool_calls) {
          const name = call.function.name;
          let args = {};
          let result;
          try {
            args = JSON.parse(call.function.arguments || '{}');
            result = runTool(db, state, name, args);
          } catch (err) {
            if (err instanceof SyntaxError) result = { error: 'Argumentos inválidos' };
            else throw err;
          }
          trace.push({ name, args, error: result?.error });
          messages.push({ role: 'tool', tool_call_id: call.id, content: typeof result === 'string' ? result : JSON.stringify(result) });
        }
      }
      throw new Error('El modelo superó el máximo de llamadas a herramientas');
    } catch (err) {
      // Si el pedido ya se creó, no lo perdemos: el cliente igual recibe su link de pago.
      if (!state.order) throw err;
      console.warn('El LLM falló después de crear el pedido:', err.message);
      return done(`¡Pedido #${state.order.id} confirmado! Pagalo acá: ${publicUrl}/checkout/${state.order.id}`);
    }
  };
}

/**
 * Usa el LLM y, si falla o se pasa algún cupo, responde el agente de reglas.
 * Cupos: `dailyLimit` respuestas por día en total y `perConversation` por cliente y por hora,
 * así un solo número no gasta el cupo de la demo.
 * ponytail: los cupos viven en memoria y se reinician con el proceso; alcanza para una demo pública.
 */
export function withFallback(primary, fallback, { dailyLimit, perConversation = Infinity }) {
  let day = '';
  let used = 0;
  const perChat = rateLimiter(perConversation, 60 * 60_000);
  return async (db, conversation, text, ctx) => {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== day) [day, used] = [today, 0];
    if (used < dailyLimit && perChat(conversation.id)) {
      used++;
      try {
        return await primary(db, conversation, text, ctx);
      } catch (err) {
        console.warn('LLM no disponible, responde el agente de reglas:', err.message);
      }
    }
    return { ...(await fallback(db, conversation, text, ctx)), engine: 'reglas' };
  };
}
