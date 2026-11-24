import type { StateDebug } from '@futsal/shared';
/** A render frame for the 3D pitch: ball [x,y,z] and players [id, x, z, heading, state, stamina]. Written from the live stream (or replay), read every animation frame. */
export interface Frame { ball: [number, number, number]; players: [string, number, number, number, string, number][]; own?: string | null; dbg?: StateDebug }
