import { useEffect, useState } from 'react';
import { api, useData } from '../api.js';
import { Message, Typing } from '../Message.jsx';
import { useAutoScroll } from '../useAutoScroll.js';

const SUGGESTIONS = ['Hola', '¿Tenés termos?', 'Quiero 2 bombillas', 'Confirmar', 'Retiro en el local', 'Quiero hablar con una persona'];

// Cada visitante de la demo es un cliente distinto, con su propio número: no comparten chat.
const newCustomer = () => ({ name: 'Cliente', phone: `54911${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}` });

function useCustomer() {
  const [customer, setCustomer] = useState(() => JSON.parse(localStorage.getItem('simulator-customer') ?? 'null') ?? newCustomer());
  useEffect(() => localStorage.setItem('simulator-customer', JSON.stringify(customer)), [customer]);
  return [customer, setCustomer];
}

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
  const [customer, setCustomer] = useCustomer();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const conversations = useData('/api/conversations', tick) ?? [];
  const conversation = conversations.find((c) => c.phone === customer.phone);
  const messages = useData(conversation ? `/api/conversations/${conversation.id}/messages` : null, tick) ?? [];
  const scrollRef = useAutoScroll(messages.length + (conversation?.typing ? 1 : 0));

  const send = async (text) => {
    if (!text.trim()) return;
    try {
      await api('/webhook/whatsapp', { method: 'POST', body: whatsappPayload(customer, text) });
      setDraft('');
      setError('');
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <section className="simulator">
      <div className="phone">
        <header className="customer">
          <label>
            Nombre de perfil
            <input value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} maxLength={40} />
          </label>
          <small>+{customer.phone}</small>
          <button type="button" onClick={() => setCustomer(newCustomer())}>
            Nuevo cliente
          </button>
        </header>
        <div className="messages" ref={scrollRef}>
          {messages.map((m) => (
            <Message key={m.id} message={m} mine={m.direction === 'in'} />
          ))}
          {conversation?.typing && <Typing />}
        </div>
        {error && <p className="error">{error}</p>}
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
        Sos un cliente nuevo con tu propio número. Cada mensaje entra por <code>POST /webhook/whatsapp</code> con el formato de WhatsApp Cloud API; el nombre de perfil es el que WhatsApp manda, y la IA te pide los datos de entrega antes de confirmar. Abrí <b>Mensajes</b> en otra pestaña para ver la bandeja del vendedor en tiempo real.
      </p>
    </section>
  );
}
