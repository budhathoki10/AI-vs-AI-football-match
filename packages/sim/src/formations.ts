import type { Formation, Role } from './types';

/** Anchors in the team frame: u = forward metres from own goal line along the pitch (−20 own goal … +20 opp goal), v = lateral. Slot 0 = outfield slot 1 … 3. */
export const FORMATION_ANCHORS: Record<Formation, [number, number][]> = {
  '2-2': [[-9, -4], [-9, 4], [-2, -5.5], [-2, 5.5]],
  '1-2-1': [[-10, 0], [-4.5, -6], [-4.5, 6], [3, 0]],
  '3-1': [[-9, -6], [-11, 0], [-9, 6], [2, 0]],
  '4-0': [[-5, -7.5], [-5, -2.5], [-5, 2.5], [-5, 7.5]],
};

export const defaultRoleForSlot = (f: Formation, slot: number): Role => {
  const m: Record<Formation, Role[]> = {
    '2-2': ['FIXO', 'FIXO', 'ALA', 'ALA'], '1-2-1': ['FIXO', 'ALA', 'ALA', 'PIVOT'],
    '3-1': ['ALA', 'FIXO', 'ALA', 'PIVOT'], '4-0': ['UNIVERSAL', 'UNIVERSAL', 'UNIVERSAL', 'UNIVERSAL'],
  };
  return m[f][slot];
};
