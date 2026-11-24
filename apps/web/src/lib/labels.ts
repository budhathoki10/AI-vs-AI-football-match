import type { PlayerConfig, ProviderId, ProviderStatus } from '@futsal/shared';

/** The label shown for a card's model: the provider's own name for it when known, otherwise the raw id. */
export function modelLabel(player: PlayerConfig, byId: Partial<Record<ProviderId, ProviderStatus>> | null, openRouterNames: Record<string, string> = {}): string {
  if (!player.model) return 'Choose a model';
  if (player.provider === 'openrouter') return openRouterNames[player.model] ?? player.model.split('/').pop() ?? player.model;
  return byId?.[player.provider]?.models.find((m) => m.id === player.model)?.label ?? player.model;
}
