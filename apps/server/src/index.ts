import { buildApp } from './app';
const { app } = await buildApp();
const port = Number(process.env.PORT ?? 8787);
await app.listen({ port, host: process.env.HOST ?? '127.0.0.1' });
console.log(`AI Futsal Arena API listening on :${port}`);
