import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Resolve the 32-byte credential-encryption key. Production must supply CREDENTIAL_KEY (64 hex chars). Dev generates a local, git-ignored key file. */
export function loadCredentialKey(env = process.env, devKeyPath = 'data/.dev-credential-key'): Buffer {
  const v = env.CREDENTIAL_KEY;
  if (v) {
    if (!/^[0-9a-fA-F]{64}$/.test(v)) throw new Error('CREDENTIAL_KEY must be 64 hex characters (32 bytes)');
    return Buffer.from(v, 'hex');
  }
  if (env.NODE_ENV === 'production') throw new Error('CREDENTIAL_KEY is required in production');
  if (existsSync(devKeyPath)) return Buffer.from(readFileSync(devKeyPath, 'utf8').trim(), 'hex');
  mkdirSync(dirname(devKeyPath), { recursive: true });
  const k = randomBytes(32); writeFileSync(devKeyPath, k.toString('hex'), { mode: 0o600 });
  return k;
}

/** AES-256-GCM: output is `v1.<iv>.<tag>.<ciphertext>` (base64url). */
export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}
export function decryptSecret(blob: string, key: Buffer): string {
  const [v, iv, tag, ct] = blob.split('.'); if (v !== 'v1' || !iv || !tag || !ct) throw new Error('bad ciphertext');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url')); d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}
export const maskKey = (k: string) => (k.length <= 8 ? '••••' : `${k.slice(0, 3)}••••••••${k.slice(-4)}`);

export function hashPassword(pw: string): string {
  const salt = randomBytes(16); const h = scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64url')}$${h.toString('base64url')}`;
}
export function verifyPassword(pw: string, stored: string): boolean {
  const [alg, s, h] = stored.split('$'); if (alg !== 'scrypt' || !s || !h) return false;
  const exp = Buffer.from(h, 'base64url'); const got = scryptSync(pw, Buffer.from(s, 'base64url'), exp.length, { N: 16384, r: 8, p: 1 });
  return got.length === exp.length && timingSafeEqual(got, exp);
}
export const newToken = () => randomBytes(32).toString('base64url');
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
