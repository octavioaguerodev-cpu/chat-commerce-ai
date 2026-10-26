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

/** `mine` decide de qué lado va la burbuja según quién mira (panel o cliente). */
export function Message({ message, mine }) {
  return (
    <div className={`bubble ${mine ? 'mine' : ''} ${message.author}`}>
      <span className="who">{AUTHOR[message.author]}</span>
      <p>
        <Linkified text={message.body} />
      </p>
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
