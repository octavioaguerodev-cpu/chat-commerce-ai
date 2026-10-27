/**
 * Ventana fija por clave: `allow(key)` devuelve true mientras no se pase de `max` en `windowMs`.
 * ponytail: en memoria y por proceso; con varias instancias hace falta un store compartido (Redis).
 */
export function rateLimiter(max, windowMs) {
  const windows = new Map();
  return (key) => {
    const now = Date.now();
    let w = windows.get(key);
    if (!w || now >= w.reset) {
      if (windows.size > 10_000) for (const [k, v] of windows) if (now >= v.reset) windows.delete(k);
      w = { count: 0, reset: now + windowMs };
      windows.set(key, w);
    }
    return ++w.count <= max;
  };
}
