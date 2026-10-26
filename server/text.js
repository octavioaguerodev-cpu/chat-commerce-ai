const ARS = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });

export const money = (n) => ARS.format(n);

export const normalize = (s) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

// ponytail: plural -> singular by dropping a trailing "s"; good enough for a small catalog, swap for a stemmer if it grows.
const singular = (w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);

export const tokenize = (s) => (normalize(s).match(/[a-z0-9]+/g) ?? []).map(singular);
