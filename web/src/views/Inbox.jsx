import { useState } from 'react';
import { api, time, useData } from '../api.js';
import { Message, Typing } from '../Message.jsx';
import { useAutoScroll } from '../useAutoScroll.js';

export default function Inbox({ tick }) {
  const conversations = useData('/api/conversations', tick) ?? [];
  const [selectedId, setSelectedId] = useState(null);
  const current = conversations.find((c) => c.id === selectedId);
  const messages = useData(current ? `/api/conversations/${current.id}/messages` : null, tick) ?? [];
  const [draft, setDraft] = useState('');
  const scrollRef = useAutoScroll(messages.length + (current?.typing ? 1 : 0));

  const send = async (e) => {
    e.preventDefault();
    if (!draft.trim()) return;
    await api(`/api/conversations/${current.id}/messages`, { method: 'POST', body: { text: draft } });
    setDraft('');
  };

  const toggleAi = () => api(`/api/conversations/${current.id}`, { method: 'PATCH', body: { ai_enabled: !current.ai_enabled } });

  return (
    <div className={`inbox ${current ? 'has-chat' : ''}`}>
      <aside>
        {conversations.length === 0 && <p className="empty">Todavía no hay chats. Escribí como cliente desde el Simulador.</p>}
        {conversations.map((c) => (
          <button key={c.id} className={`conversation ${c.id === selectedId ? 'active' : ''}`} onClick={() => setSelectedId(c.id)}>
            <span className="row">
              <b>{c.name}</b>
              <small>{time(c.last_at)}</small>
            </span>
            <span className="row">
              <span className="preview">{c.typing ? <i>escribiendo…</i> : c.last_body}</span>
              {c.needs_human ? <span className="badge">Espera respuesta</span> : null}
            </span>
          </button>
        ))}
      </aside>
      {current ? (
        <section className="chat">
          <header>
            <button className="back" onClick={() => setSelectedId(null)} aria-label="Volver a los chats">
              ←
            </button>
            <div className="title">
              <b>{current.name}</b> <small>+{current.phone}</small>
            </div>
            <label className="switch">
              <input type="checkbox" checked={!!current.ai_enabled} onChange={toggleAi} />
              IA responde
            </label>
          </header>
          <div className="messages" ref={scrollRef}>
            {messages.map((m) => (
              <Message key={m.id} message={m} mine={m.direction === 'out'} showTrace />
            ))}
            {current.typing && <Typing mine />}
          </div>
          <form className="composer" onSubmit={send}>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Responder como vendedor…" />
            <button>Enviar</button>
          </form>
        </section>
      ) : (
        <section className="chat placeholder">Elegí una conversación</section>
      )}
    </div>
  );
}
