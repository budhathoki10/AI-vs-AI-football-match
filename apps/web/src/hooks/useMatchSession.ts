import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject } from 'react';
import type { ServerMsg, StartMatchBody } from '@futsal/shared';
import type { Frame } from '../lib/types';
import type { MatchAction } from '../state/match';

/** React state is refreshed this often from the 10 Hz stream; the 3D scene reads every frame directly from the ref. */
const STATE_DISPATCH_MS = 220;

/**
 * Starts a match on the local server and follows its stream. The browser never decides anything: it renders what it is told,
 * and can only ask the server to pause, resume or stop.
 */
export function useMatchSession(dispatch: Dispatch<MatchAction>, frameRef: MutableRefObject<Frame | null>) {
  const wsRef = useRef<WebSocket | null>(null); const idRef = useRef<string | null>(null); const timer = useRef<number>(0); const pending = useRef<ServerMsg | null>(null);

  const close = useCallback(() => { window.clearTimeout(timer.current); timer.current = 0; pending.current = null; wsRef.current?.close(); wsRef.current = null; }, []);
  useEffect(() => close, [close]);

  const follow = useCallback((id: string) => {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/match/${id}`); wsRef.current = ws;
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string) as ServerMsg;
      if (msg.t === 'state') {
        frameRef.current = { ball: msg.ball, players: msg.players, own: msg.own, dbg: msg.dbg };
        pending.current = msg; if (!timer.current) timer.current = window.setTimeout(() => { timer.current = 0; if (pending.current) dispatch({ type: 'server', msg: pending.current }); pending.current = null; }, STATE_DISPATCH_MS);
        return;
      }
      if (pending.current) { dispatch({ type: 'server', msg: pending.current }); pending.current = null; } // keep order: the latest state precedes any later message
      dispatch({ type: 'server', msg });
    };
    ws.onerror = () => dispatch({ type: 'fail', message: 'Lost the connection to the local server.' });
  }, [dispatch, frameRef]);

  const start = useCallback(async (body: StartMatchBody): Promise<boolean> => {
    close(); frameRef.current = null;
    try {
      const res = await fetch('/api/match', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = (await res.json().catch(() => ({}))) as { id?: string; error?: string; issues?: { path: string; message: string }[] };
      if (!res.ok || !json.id) { dispatch({ type: 'fail', message: json.error ? `${json.error}${json.issues?.length ? `: ${json.issues.map((i) => `${i.path} ${i.message}`).join('; ')}` : ''}` : `Server error ${res.status}` }); return false; }
      idRef.current = json.id; follow(json.id); return true;
    } catch (e) { dispatch({ type: 'fail', message: `Could not reach the local server: ${(e as Error).message}` }); return false; }
  }, [close, dispatch, follow, frameRef]);

  const control = useCallback((action: 'pause' | 'resume' | 'stop') => { if (idRef.current) void fetch(`/api/match/${idRef.current}/${action}`, { method: 'POST' }); }, []);
  return { start, pause: () => control('pause'), resume: () => control('resume'), stop: () => control('stop'), close };
}
