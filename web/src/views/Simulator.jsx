import { useState } from 'react';
import { api, useData } from '../api.js';
import { Message } from '../Message.jsx';
import { useAutoScroll } from '../useAutoScroll.js';

const CUSTOMERS = [
  { name: 'Ana', phone: '5491155550001' },
  { name: 'Bruno', phone: '5491155550002' },
  { name: 'Carla', phone: '5491155550003' },
];
const SUGGESTIONS = ['Hola', '¿Tenés termos?', 'Quiero 2 bombillas', 'Quiero un termo stanley', 'Confirmar', 'Quiero hablar con una persona'];

/** Arma el mismo payload que manda WhatsApp Cloud API a nuestro webhook. */
const whatsappPayload = ({ name, phone }, text) => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      changes: [
        {
          field: 'messages',
          value: {
            contacts: [{ wa_id: phone, profile: { name } }],
            messages: [{ from: phone, id: `wamid.${crypto.randomUUID()}`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }],
          },
        },
      ],
    },
  ],
});

export default function Simulator({ tick }) {
  const [customer, setCustomer] = useState(CUSTOMERS[0]);
  const [draft, setDraft] = useState('');
  const conversations = useData('/api/conversations', tick) ?? [];
  const conversation = conversations.find((c) => c.phone === customer.phone);
  const messages = useData(conversation ? `/api/conversations/${conversation.id}/messages` : null, tick) ?? [];
  const scrollRef = useAutoScroll(messages.length);

  const send = async (text) => {
    if (!text.trim()) return;
    await api('/webhook/whatsapp', { method: 'POST', body: whatsappPayload(customer, text) });
    setDraft('');
  };

  return (
    <section className="simulator">
      <div className="phone">
        <header>
          <select value={customer.phone} onChange={(e) => setCustomer(CUSTOMERS.find((c) => c.phone === e.target.value))}>
            {CUSTOMERS.map((c) => (
              <option key={c.phone} value={c.phone}>
                {c.name} (+{c.phone})
              </option>
            ))}
          </select>
        </header>
        <div className="messages" ref={scrollRef}>
          {messages.map((m) => (
            <Message key={m.id} message={m} mine={m.direction === 'in'} />
          ))}
        </div>
        <div className="suggestions">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => send(s)}>
              {s}
            </button>
          ))}
        </div>
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            send(draft);
          }}
        >
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={`Escribir como ${customer.name}…`} />
          <button>Enviar</button>
        </form>
      </div>
      <p className="hint">
        Cada mensaje entra por <code>POST /webhook/whatsapp</code> con el formato de WhatsApp Cloud API. Abrí <b>Mensajes</b> en otra pestaña para ver la bandeja del vendedor en tiempo real.
      </p>
    </section>
  );
}
