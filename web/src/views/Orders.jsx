import { money, useData } from '../api.js';

const STATUS = { pending: 'Pendiente de pago', paid: 'Pagado', expired: 'Vencido' };

export default function Orders({ tick }) {
  const orders = useData('/api/orders', tick) ?? [];
  return (
    <section className="page">
      <h2>Pedidos</h2>
      {orders.length === 0 ? (
        <p className="empty">Todavía no hay pedidos.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Cliente</th>
              <th>Productos</th>
              <th>Entrega</th>
              <th>Total</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id}>
                <td>
                  <a href={`/checkout/${o.id}`} target="_blank" rel="noreferrer">
                    {o.id}
                  </a>
                </td>
                <td>
                  {o.delivery?.nombre ?? o.customer}
                  <br />
                  <small>+{o.phone}</small>
                </td>
                <td>{o.items.map((i) => `${i.qty} × ${i.name}`).join(', ')}</td>
                <td>{!o.delivery ? '—' : o.delivery.entrega === 'envio' ? `Envío a ${o.delivery.direccion}` : 'Retiro en el local'}</td>
                <td>{money(o.total)}</td>
                <td>
                  <span className={`status ${o.status}`}>{STATUS[o.status]}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
