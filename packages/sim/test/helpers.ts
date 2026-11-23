import { Match, makeMatchConfig, initPhysics } from '../src';
export async function liveMatch(seed = 11, minutes: 1 | 2 | 3 | 4 | 5 | 6 = 3) {
  await initPhysics();
  const m = await Match.create(makeMatchConfig({ seed, minutes }));
  m.play = 'live'; m.restart = null; m.restartLive = null;
  return m;
}
export const evs = (m: Match, t: string) => m.events.filter((e) => e.type === t);
