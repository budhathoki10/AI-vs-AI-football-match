import type { ProviderId } from '@futsal/shared';

export interface ProviderStyle {
  /** Two-stop tile gradient for the in-app emblem. */
  gradient: [string, string];
  /** Glow and ring colour while this provider is thinking. */
  glow: string;
  color: string;
}

export const PROVIDER_STYLES: Record<ProviderId, ProviderStyle> = {
  claude: { gradient: ['#f0a07f', '#c4572f'], glow: '#ff9b6e', color: '#fff' },
  codex: { gradient: ['#ffffff', '#cfcac0'], glow: '#e9f3ff', color: '#111' },
  openrouter: { gradient: ['#8f92ff', '#4144c9'], glow: '#8f92ff', color: '#fff' },
};
export const UNKNOWN_PROVIDER_STYLE: ProviderStyle = { gradient: ['#4a4c55', '#2a2c33'], glow: '#9c978c', color: '#bbb' };
