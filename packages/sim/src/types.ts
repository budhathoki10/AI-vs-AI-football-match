export type Role = 'GK' | 'FIXO' | 'ALA' | 'PIVOT' | 'UNIVERSAL';
export type TeamId = 'A' | 'B';
export type Formation = '2-2' | '1-2-1' | '3-1' | '4-0';
export const FORMATIONS: Formation[] = ['2-2', '1-2-1', '3-1', '4-0'];
export type Architecture = 'llm' | 'rule' | 'fsm' | 'behavior_tree' | 'utility' | 'goap' | 'hybrid';
export const ARCHITECTURES: Architecture[] = ['llm', 'rule', 'fsm', 'behavior_tree', 'utility', 'goap', 'hybrid'];

export interface Attributes {
  acceleration: number; maxSpeed: number; agility: number; stamina: number;
  passing: number; shooting: number; ballControl: number; dribbling: number;
  tackling: number; positioning: number; defensiveAwareness: number;
  decisionMaking: number; goalkeeping: number;
}
/** all attributes 0..100 */
export const ATTRIBUTE_KEYS: (keyof Attributes)[] = ['acceleration','maxSpeed','agility','stamina','passing','shooting','ballControl','dribbling','tackling','positioning','defensiveAwareness','decisionMaking','goalkeeping'];

export interface PlayerConfig { id: string; number: number; name: string; role: Role; attributes: Attributes }
export type AttackingStyle = 'possession' | 'direct' | 'counter' | 'wing_play' | 'pivot_play';
export type DefensiveStyle = 'high_press' | 'mid_block' | 'low_block' | 'man_marking';
export type TeamStrategy = 'balanced' | 'attacking' | 'defensive' | 'counter' | 'park_the_bus' | 'all_out_attack';

export const INSTRUCTIONS = ['hold_position','support_build_up','protect_central_area','stay_wide','press_high','drop_deep','make_forward_run','mark_nearest','pivot_hold_up'] as const;
export type Instruction = typeof INSTRUCTIONS[number];

export interface TeamTactics {
  formation: Formation;
  teamStrategy: TeamStrategy;
  attackingStyle: AttackingStyle;
  defensiveStyle: DefensiveStyle;
  pressingIntensity: number; // 0..1
  riskLevel: number; // 0..1
  flyingGoalkeeper: boolean;
  playerInstructions: { playerId: string; instruction: Instruction }[];
  substitutions?: { out: string; in: string }[];
  reasonSummary: string;
}

export interface TeamConfig {
  id: TeamId; name: string; badge: string; primaryColor: string; secondaryColor: string;
  formation: Formation; attackingStyle: AttackingStyle; defensiveStyle: DefensiveStyle;
  architecture: Architecture;
  provider?: string; model?: string; tacticalInstructions?: string;
  players: PlayerConfig[]; // 5 starters first (index 0 = GK) then bench (>=3)
}

export interface MatchConfig {
  teamA: TeamConfig; teamB: TeamConfig;
  realDurationMinutes: 1 | 2 | 3 | 4 | 5 | 6;
  seed: number;
  shootoutOnDraw: boolean; // mandatory true for competitions
  swapSides?: boolean;
}

export type EventType =
  | 'kickoff' | 'goal' | 'shot' | 'save' | 'foul' | 'accumulated_foul' | 'yellow_card' | 'red_card'
  | 'corner' | 'kick_in' | 'goal_clearance' | 'free_kick' | 'penalty_kick' | 'substitution'
  | 'tactical_change' | 'formation_change' | 'halftime' | 'fulltime' | 'four_second_violation'
  | 'pass' | 'tackle' | 'interception' | 'flying_gk' | 'shootout_start';

export interface MatchEvent {
  id: number; type: EventType; vt: number; // virtual seconds
  half: 1 | 2; team?: TeamId; playerId?: string; assistId?: string; detail?: string;
  pos?: [number, number];
}

export type Phase = 'pre' | 'first_half' | 'halftime' | 'second_half' | 'full_time' | 'shootout' | 'finished';

export interface PlayerSnap { id: string; x: number; z: number; vx: number; vz: number; h: number; stamina: number; state: string; }
export interface Snapshot {
  vt: number; rt: number; phase: Phase; play: string;
  ball: { x: number; y: number; z: number; vx: number; vy: number; vz: number };
  players: PlayerSnap[]; score: [number, number]; possession: TeamId | null;
}
