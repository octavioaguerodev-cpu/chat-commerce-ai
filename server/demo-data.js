import { createOrder, listProducts, markPaid } from './commerce.js';

/**
 * Carga tres conversaciones de ejemplo si la base no tiene ninguna, para que la demo pública
 * no arranque vacía: una venta pagada, un pedido pendiente de pago y un cliente que espera a una persona.
 * Los pedidos pasan por `createOrder`, así el stock y las métricas quedan consistentes.
 */
export function seedDemoData(db, publicUrl) {
  if (db.prepare('SELECT 1 FROM conversations LIMIT 1').get()) return false;
  const id = Object.fromEntries(listProducts(db).map((p) => [p.sku, p.id]));
  const addConversation = db.prepare('INSERT INTO conversations (phone, name, needs_human) VALUES (?, ?, ?) RETURNING id');
  const addMessage = db.prepare('INSERT INTO messages (conversation_id, direction, author, body, meta) VALUES (?, ?, ?, ?, ?)');
  const setDelivery = db.prepare('UPDATE conversations SET delivery = ? WHERE id = ?');
  const customer = (c, body) => addMessage.run(c, 'in', 'customer', body, null);
  const ai = (c, body, trace) => addMessage.run(c, 'out', 'ai', body, trace ? JSON.stringify({ engine: 'ia', trace }) : null);
  const tool = (name, args = {}) => ({ name, args });

  const bruno = addConversation.get('5491155550010', 'Martín', 0).id;
  customer(bruno, 'hola! busco un regalo para mi viejo que toma mate todo el día');
  ai(
    bruno,
    '¡Hola Martín! Para alguien que toma mate todo el día te recomiendo el Termo Stanley 1 L ($ 89.000), que le mantiene el agua caliente toda la jornada. Si querés sumarle algo, la bombilla de acero sale $ 6.500.',
    [tool('buscar_productos', { consulta: 'termo' }), tool('buscar_productos', { consulta: 'bombilla' })],
  );
  customer(bruno, 'dale, sumame el termo y una bombilla');
  ai(
    bruno,
    'Listo, te sumé el Termo Stanley 1 L y la bombilla de acero. Total: $ 95.500. Para confirmarlo, ¿a nombre de quién va y lo retirás en el local o te lo enviamos?',
    [tool('agregar_al_carrito', { sku: 'TER-STA-1L', cantidad: 1 }), tool('agregar_al_carrito', { sku: 'BOM-ACE', cantidad: 1 })],
  );
  customer(bruno, 'Martín Gómez, mandalo a Av. Rivadavia 4500, CABA. Confirmo');
  const martin = { nombre: 'Martín Gómez', entrega: 'envio', direccion: 'Av. Rivadavia 4500, CABA' };
  const paid = createOrder(
    db,
    bruno,
    [
      { productId: id['TER-STA-1L'], qty: 1 },
      { productId: id['BOM-ACE'], qty: 1 },
    ],
    martin,
  );
  ai(bruno, `¡Pedido #${paid.id} confirmado! Va a Av. Rivadavia 4500, CABA, a nombre de Martín Gómez. Pagalo acá: ${publicUrl}/checkout/${paid.id}`, [
    tool('guardar_datos_cliente', martin),
    tool('confirmar_pedido'),
  ]);
  markPaid(db, paid.id);
  ai(bruno, `¡Recibimos tu pago de $ 95.500 para el pedido #${paid.id}! En breve lo preparamos.`);
  setDelivery.run(JSON.stringify(martin), bruno);

  const carla = addConversation.get('5491155550011', 'Lucía', 0).id;
  customer(carla, '¿tenés yerba y algún mate de calabaza?');
  ai(carla, 'Sí: la yerba mate de 1 kg está $ 7.800 y el mate de calabaza $ 12.000, hay stock de los dos. ¿Cuánto querés de cada uno?', [
    tool('buscar_productos', { consulta: 'yerba' }),
    tool('buscar_productos', { consulta: 'mate calabaza' }),
  ]);
  customer(carla, '2 yerbas y un mate. Lo paso a buscar, soy Lucía Fernández');
  const lucia = { nombre: 'Lucía Fernández', entrega: 'retiro' };
  const pending = createOrder(
    db,
    carla,
    [
      { productId: id['YER-1KG'], qty: 2 },
      { productId: id['MAT-CAL'], qty: 1 },
    ],
    lucia,
  );
  ai(
    carla,
    `Listo, Lucía: 2 × Yerba mate 1 kg y 1 × Mate de calabaza, total $ 27.600, para retirar en el local. Pagalo acá: ${publicUrl}/checkout/${pending.id}`,
    [
      tool('agregar_al_carrito', { sku: 'YER-1KG', cantidad: 2 }),
      tool('agregar_al_carrito', { sku: 'MAT-CAL', cantidad: 1 }),
      tool('guardar_datos_cliente', lucia),
      tool('confirmar_pedido'),
    ],
  );
  setDelivery.run(JSON.stringify(lucia), carla);

  const diego = addConversation.get('5491155550012', 'Diego', 1).id;
  customer(diego, '¿hacen envíos a Córdoba? ¿cuánto sale?');
  ai(diego, 'Los envíos los coordina alguien del equipo. Ya les avisé y te escriben por acá en un rato.', [
    tool('derivar_a_humano', { motivo: 'Consulta por envío a Córdoba' }),
  ]);
  return true;
}
