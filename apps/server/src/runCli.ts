import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export interface CliRunOptions { command: string; args: string[]; cwd?: string; timeoutMs: number; signal?: AbortSignal }
export interface CliRunResult { stdout: string; stderr: string; exitCode: number | null }

const MAX_CAPTURE_BYTES = 2_000_000;

export class CliError extends Error {
  constructor(message: string, readonly kind: 'missing' | 'timeout' | 'aborted' | 'failed') { super(message); }
}

/**
 * On Windows, npm installs CLIs as `.cmd` shims, which Node refuses to spawn without a shell (and a shell would let model ids or
 * prompts be interpreted as syntax). The shim only forwards to a JavaScript file, so we find that file and run it with Node directly.
 */
export function resolveCommand(command: string, env: NodeJS.ProcessEnv = process.env): { file: string; prefix: string[] } {
  if (/\.(c|m)?js$/.test(command)) return { file: process.execPath, prefix: [command] }; // a script path (used by tests as a stand-in CLI)
  if (process.platform !== 'win32') return { file: command, prefix: [] };
  const dirs = (env.PATH ?? env.Path ?? '').split(';').filter(Boolean);
  for (const dir of dirs) {
    if (existsSync(path.join(dir, `${command}.exe`))) return { file: path.join(dir, `${command}.exe`), prefix: [] };
    const shim = path.join(dir, `${command}.cmd`);
    if (existsSync(shim)) {
      const m = /"%dp0%\\([^"]+\.js)"/i.exec(readFileSync(shim, 'utf8'));
      if (m) return { file: process.execPath, prefix: [path.join(dir, m[1])] };
    }
  }
  return { file: command, prefix: [] };
}

/** Runs a CLI without a shell. stdin is closed immediately because both CLIs wait on an open stdin otherwise. */
export function runCli({ command, args, cwd, timeoutMs, signal }: CliRunOptions): Promise<CliRunResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new CliError(`${command} was cancelled`, 'aborted'));
    const target = resolveCommand(command);
    const child = spawn(target.file, [...target.prefix, ...args], { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = ''; let stderr = ''; let settled = false;
    const finish = (fn: () => void) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', onAbort); fn(); };
    const kill = () => { if (child.exitCode === null) child.kill('SIGTERM'); };
    const onAbort = () => { kill(); finish(() => reject(new CliError(`${command} was cancelled`, 'aborted'))); };
    const timer = setTimeout(() => { kill(); finish(() => reject(new CliError(`${command} did not answer within ${Math.round(timeoutMs / 1000)}s`, 'timeout'))); }, timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', (c: Buffer) => { if (stdout.length < MAX_CAPTURE_BYTES) stdout += c.toString(); });
    child.stderr.on('data', (c: Buffer) => { if (stderr.length < MAX_CAPTURE_BYTES) stderr += c.toString(); });
    child.on('error', (e: NodeJS.ErrnoException) => {
      const missing = e.code === 'ENOENT';
      finish(() => reject(new CliError(missing ? `${command} CLI is not installed or not on PATH` : `${command} failed to start: ${e.message}`, missing ? 'missing' : 'failed')));
    });
    child.on('close', (exitCode) => finish(() => resolve({ stdout, stderr, exitCode })));
  });
}

export const lastLines = (text: string, count = 4) => text.trim().split('\n').slice(-count).join('\n');
