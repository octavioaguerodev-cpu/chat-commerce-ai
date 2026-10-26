import { useState } from 'react';
import { useLiveTick } from './api.js';
import Home from './views/Home.jsx';
import Inbox from './views/Inbox.jsx';
import Orders from './views/Orders.jsx';
import Products from './views/Products.jsx';
import Simulator from './views/Simulator.jsx';

const VIEWS = [
  { id: 'home', label: 'Inicio', Component: Home },
  { id: 'inbox', label: 'Mensajes', Component: Inbox },
  { id: 'orders', label: 'Pedidos', Component: Orders },
  { id: 'products', label: 'Productos', Component: Products },
  { id: 'simulator', label: 'Simulador de cliente', Component: Simulator },
];

export default function App() {
  const tick = useLiveTick();
  const [view, setView] = useState('home');
  const { Component } = VIEWS.find((v) => v.id === view);
  return (
    <div className="layout">
      <nav>
        <h1>Chat Commerce AI</h1>
        {VIEWS.map((v) => (
          <button key={v.id} className={v.id === view ? 'active' : ''} onClick={() => setView(v.id)}>
            {v.label}
          </button>
        ))}
      </nav>
      <main>
        <Component tick={tick} go={setView} />
      </main>
    </div>
  );
}
