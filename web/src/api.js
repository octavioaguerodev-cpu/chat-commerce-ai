import { useEffect, useState } from 'react';

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? res.statusText);
  return res.headers.get('content-type')?.includes('json') ? res.json() : null;
}

/** Cada evento del servidor incrementa `tick`; las vistas lo usan para recargar datos. */
export function useLiveTick() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const events = new EventSource('/api/events');
    events.onmessage = () => setTick((t) => t + 1);
    return () => events.close();
  }, []);
  return tick;
}

export function useData(path, tick) {
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!path) return setData(null);
    let active = true;
    api(path).then((d) => active && setData(d)).catch(console.error);
    return () => {
      active = false;
    };
  }, [path, tick]);
  return data;
}

const ARS = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
export const money = (n) => ARS.format(n);

export const time = (iso) => new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
