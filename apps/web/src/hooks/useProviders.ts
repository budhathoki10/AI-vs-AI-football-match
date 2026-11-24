import { useCallback, useEffect, useState } from 'react';
import type { ModelOption, ProviderId, ProviderStatus } from '@futsal/shared';

export type ProvidersState = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; byId: Record<ProviderId, ProviderStatus> };

export function useProviders(): { providers: ProvidersState; refresh: () => void } {
  const [providers, setProviders] = useState<ProvidersState>({ kind: 'loading' });
  const load = useCallback(() => {
    fetch('/api/providers')
      .then((r) => { if (!r.ok) throw new Error(`status check failed (${r.status})`); return r.json() as Promise<{ providers: ProviderStatus[] }>; })
      .then(({ providers: list }) => setProviders({ kind: 'ready', byId: Object.fromEntries(list.map((s) => [s.id, s])) as Record<ProviderId, ProviderStatus> }))
      .catch((e: Error) => setProviders({ kind: 'error', message: e.message }));
  }, []);
  useEffect(load, [load]);
  const refresh = useCallback(() => { setProviders({ kind: 'loading' }); load(); }, [load]);
  return { providers, refresh };
}

export function useOpenRouterModels(enabled: boolean): { models: ModelOption[]; error: string | null; loading: boolean } {
  const [state, setState] = useState<{ models: ModelOption[]; error: string | null; fetched: boolean }>({ models: [], error: null, fetched: false });
  const should = enabled && !state.fetched;
  useEffect(() => {
    if (!should) return; let cancelled = false;
    fetch('/api/openrouter/models').then((r) => r.json() as Promise<{ models: ModelOption[]; error?: string }>)
      .then((b) => !cancelled && setState({ models: b.models, error: b.error ?? null, fetched: true })).catch((e: Error) => !cancelled && setState({ models: [], error: e.message, fetched: true }));
    return () => { cancelled = true; };
  }, [should]);
  return { models: state.models, error: state.error, loading: should };
}
