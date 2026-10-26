import { money, useData } from '../api.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function Card({ label, value, detail, tone }) {
  return (
    <div className={`card ${tone ?? ''}`}>
      <span className="label">{label}</span>
      <b className="value">{value}</b>
      {detail && <small>{detail}</small>}
    </div>
  );
}

export default function Home({ tick, go }) {
  const s = useData('/api/stats', tick);
  if (!s) return <section className="page" />;
  const replies = s.replies.ai + s.replies.agent;
  const aiShare = replies ? Math.round((s.replies.ai / replies) * 100) : 0;
  return (
    <section className="page home">
      <h2>Lo importante de hoy</h2>
      <div className="cards">
        <Card label="Vendido hoy" value={money(s.sales.total)} detail={plural(s.sales.orders, 'pedido pagado', 'pedidos pagados')} />
        <Card label="Pendiente de cobro" value={money(s.pending.total)} detail={plural(s.pending.orders, 'pedido sin pagar', 'pedidos sin pagar')} />
        <Card label="Chats de hoy" value={s.chats} detail={plural(replies, 'respuesta enviada', 'respuestas enviadas')} />
        <Card label="Respondió la IA" value={`${aiShare}%`} detail={`${s.replies.ai} IA · ${s.replies.agent} vendedor`} />
        <Card
          label="Esperan respuesta"
          value={s.waiting}
          detail={s.waiting ? 'Ir a Mensajes' : 'Nadie esperando'}
          tone={s.waiting ? 'warn' : 'ok'}
        />
      </div>
      <div className="split">
        <div>
          <h3>Lo más vendido</h3>
          {s.topProducts.length === 0 ? (
            <p className="empty">Todavía no hay ventas pagadas.</p>
          ) : (
            <table>
              <tbody>
                {s.topProducts.map((p) => (
                  <tr key={p.name}>
                    <td>{p.name}</td>
                    <td>{p.qty} u.</td>
                    <td>{money(p.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div>
          <h3>Stock bajo</h3>
          {s.lowStock.length === 0 ? (
            <p className="empty">Todo el catálogo tiene stock.</p>
          ) : (
            <table>
              <tbody>
                {s.lowStock.map((p) => (
                  <tr key={p.name}>
                    <td>{p.name}</td>
                    <td className={p.stock === 0 ? 'out' : ''}>{p.stock === 0 ? 'Sin stock' : `${p.stock} u.`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {s.waiting > 0 && (
        <button className="cta" onClick={() => go('inbox')}>
          Ver chats que esperan respuesta
        </button>
      )}
    </section>
  );
}
