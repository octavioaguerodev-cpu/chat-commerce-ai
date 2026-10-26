import { time } from './api.js';

const AUTHOR = { customer: 'Cliente', ai: 'IA', agent: 'Vendedor' };

function Linkified({ text }) {
  return text.split(/(https?:\/\/\S+)/g).map((part, i) =>
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
