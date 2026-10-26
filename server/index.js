import { fileURLToPath } from 'node:url';
import express from 'express';
import { createApp } from './app.js';
import { openDb } from './db.js';

const port = Number(process.env.PORT ?? 3000);
const publicUrl = (process.env.PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/$/, '');
const dev = process.argv.includes('--dev');

const { app } = createApp(openDb(), { publicUrl });

if (dev) {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
} else {
  const dist = fileURLToPath(new URL('../web/dist', import.meta.url));
  app.use(express.static(dist));
  app.get('/{*path}', (req, res) => res.sendFile('index.html', { root: dist }));
}

app.listen(port, () => console.log(`chat-commerce-ai en ${publicUrl}${dev ? ' (dev)' : ''}`));
