import { time } from './api.js';

const AUTHOR = { customer: 'Cliente', ai: 'IA', agent: 'Vendedor' };

function Linkified({ text }) {
  // La puntuación final ("…/checkout/1.") no es parte del link.
  return text.split(/(https?:\/\/\S+?)(?=[.,;:!?)]*(?:\s|$))/g).map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part} target="_blank" rel="noreferrer">
        {part}
      </a>
    ) : (
      part
    ),
  );
}

const TOOL = {
  buscar_productos: (a) => (a.consulta ? `buscó "${a.consulta}"` : 'miró el catálogo'),
  ver_carrito: () => 'miró el carrito',
  agregar_al_carrito: (a) => `sumó ${a.cantidad} × ${a.sku}`,
  quitar_del_carrito: (a) => `sacó ${a.sku}`,
  confirmar_pedido: () => 'confirmó el pedido',
  derivar_a_humano: (a) => `derivó a una persona: ${a.motivo}`,
};

/** Qué hizo el asistente para responder: solo lo ve el vendedor. */
function Trace({ meta }) {
  if (meta.engine === 'reglas') return <small className="trace">Respondió el asistente de reglas</small>;
  if (!meta.trace.length) return <small className="trace">IA · respondió sin usar herramientas</small>;
  return (
    <details className="trace">
      <summary>IA · {meta.trace.length === 1 ? '1 acción' : `${meta.trace.length} acciones`}</summary>
      <ol>
        {meta.trace.map((t, i) => (
          <li key={i} className={t.error ? 'failed' : ''}>
            {(TOOL[t.name] ?? (() => t.name))(t.args)}
            {t.error && ` → rechazado: ${t.error}`}
          </li>
        ))}
      </ol>
    </details>
  );
}

/** `mine` decide de qué lado va la burbuja según quién mira (panel o cliente). */
export function Message({ message, mine, showTrace = false }) {
  return (
    <div className={`bubble ${mine ? 'mine' : ''} ${message.author}`}>
      <span className="who">{AUTHOR[message.author]}</span>
      <p>
        <Linkified text={message.body} />
      </p>
      {showTrace && message.meta && <Trace meta={message.meta} />}
      <span className="when">{time(message.created_at)}</span>
    </div>
  );
}

export function Typing({ mine }) {
  return (
    <div className={`bubble ai typing ${mine ? 'mine' : ''}`} aria-label="El asistente está escribiendo">
      <span />
      <span />
      <span />
    </div>
  );
}
