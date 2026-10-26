import { fileURLToPath } from 'node:url';
import express from 'express';
import { demoAgent } from './agent.js';
import { createApp } from './app.js';
import { openDb } from './db.js';
import { createLlmAgent, openAiCompatible, withFallback } from './llm-agent.js';

const env = process.env;
const port = Number(env.PORT ?? 3000);
const publicUrl = (env.PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/$/, '');
const dev = process.argv.includes('--dev');

// Por defecto usa Gemini (tiene plan gratuito). Cualquier API compatible con OpenAI sirve cambiando estas variables.
const apiKey = env.LLM_API_KEY ?? env.GEMINI_API_KEY;
// El plan gratuito tiene cupo por modelo: si uno está saturado o sin cupo, se prueba el siguiente.
const models = (env.LLM_MODELS ?? 'gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-3-flash-preview').split(',').map((m) => m.trim());
const agent = apiKey
  ? withFallback(
      createLlmAgent({
        complete: openAiCompatible({ apiKey, models, baseUrl: env.LLM_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta/openai' }),
      }),
      demoAgent,
      { dailyLimit: Number(env.LLM_DAILY_LIMIT ?? 300) },
    )
  : demoAgent;

const { app, inbox } = createApp(openDb(), { publicUrl, agent });

// Los pedidos impagos vencen y devuelven el stock reservado.
const orderTtl = Number(env.ORDER_TTL_MINUTES ?? 30);
setInterval(() => inbox.expireUnpaid(orderTtl), 60_000).unref();

if (dev) {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
} else {
  const dist = fileURLToPath(new URL('../web/dist', import.meta.url));
  app.use(express.static(dist));
  app.get('/{*path}', (req, res) => res.sendFile('index.html', { root: dist }));
}

app.listen(port, () => console.log(`chat-commerce-ai en ${publicUrl}${dev ? ' (dev)' : ''} · agente: ${apiKey ? `LLM (${models[0]})` : 'reglas'}`));
