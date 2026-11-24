import { buildApp } from './app';
const { app } = await buildApp();
const port = Number(process.env.PORT ?? 8787);
// Local-only by default: starting a match can spend your Claude / ChatGPT / OpenRouter quota.
await app.listen({ port, host: process.env.HOST ?? '127.0.0.1' });
console.log(`AI Futsal Arena server listening on http://${process.env.HOST ?? '127.0.0.1'}:${port}`);
