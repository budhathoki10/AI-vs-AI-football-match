import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { Label } from './Label';

/**
 * Procedural articulated humanoid (no external assets, so no licensing constraints). Gait cadence and amplitude are derived from the
 * player's real ground speed (never accelerated): a player standing still stands still, a sprinter at 7 m/s cycles at ~2 Hz.
 * Poses: idle, walk, run, sprint, kick/pass/shot swing, goalkeeper dive, celebration.
 */
export interface PoseInput {
  speed: number; // m/s, measured from the simulation
  kick: number; // 1 -> 0 swing envelope after a strike
  dive: number; // -1..1 sideways dive
  celebrate: boolean;
  react: boolean; // disappointment: head down, hands on head
  turn: number; // rad/s, used for body lean
  st: string; // state from the simulation: idle walk run sprint turn dribble defend receive tackle miscontrol pass shoot dive
}
export const newPose = (): PoseInput => ({ speed: 0, kick: 0, dive: 0, celebrate: false, react: false, turn: 0, st: 'idle' });

export interface Kit { shirt: string; shorts: string; socks: string; skin: string; hair: string; boots?: string; gloves?: string }
const SKINS = ['#f1c9a5', '#e0ac87', '#c68b62', '#8d5a3b', '#5f3b26'];
const HAIRS = ['#1b1410', '#3b2a1c', '#6a4a2a', '#c9a35b', '#111111'];
export const kitFor = (primary: string, secondary: string, idx: number, gk = false): Kit => ({
  shirt: gk ? '#facc15' : primary, shorts: gk ? '#1e293b' : secondary, socks: gk ? '#facc15' : primary,
  skin: SKINS[idx % SKINS.length], hair: HAIRS[(idx * 3 + 1) % HAIRS.length], boots: '#0f172a', gloves: gk ? '#f97316' : undefined,
});

export function Humanoid({ kit, pose, label, labelScale = 0.5, phaseOffset = 0 }: { kit: Kit; pose: MutableRefObject<PoseInput>; label?: string; labelScale?: number; phaseOffset?: number }) {
  const body = useRef<THREE.Group>(null!); const head = useRef<THREE.Group>(null!);
  const armL = useRef<THREE.Group>(null!), armR = useRef<THREE.Group>(null!), foreL = useRef<THREE.Group>(null!), foreR = useRef<THREE.Group>(null!);
  const legL = useRef<THREE.Group>(null!), legR = useRef<THREE.Group>(null!), shinL = useRef<THREE.Group>(null!), shinR = useRef<THREE.Group>(null!);
  const act = useRef(0); const phase = useRef(phaseOffset); const lean = useRef(0); const dive = useRef(0); const cel = useRef(0); const kick = useRef(0);
  const mats = useMemo(() => ({
    shirt: new THREE.MeshStandardMaterial({ color: kit.shirt, roughness: 0.7 }), shorts: new THREE.MeshStandardMaterial({ color: kit.shorts, roughness: 0.8 }),
    socks: new THREE.MeshStandardMaterial({ color: kit.socks, roughness: 0.8 }), skin: new THREE.MeshStandardMaterial({ color: kit.skin, roughness: 0.6 }),
    hair: new THREE.MeshStandardMaterial({ color: kit.hair, roughness: 0.9 }), boots: new THREE.MeshStandardMaterial({ color: kit.boots ?? '#0f172a', roughness: 0.5 }),
    gloves: new THREE.MeshStandardMaterial({ color: kit.gloves ?? kit.skin, roughness: 0.6 }),
  }), [kit.shirt, kit.shorts, kit.socks, kit.skin, kit.hair, kit.boots, kit.gloves]);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05); const p = pose.current;
    const sp = p.speed; const moving = sp > 0.35;
    const freq = moving ? 0.55 + 0.21 * sp : 0; // leg cycles per second, tied to real speed (7 m/s -> ~2 Hz)
    phase.current += dt * Math.PI * 2 * freq;
    const amp = Math.min(1, sp / 6.2);
    const k = (a: number, b: number, t: number) => a + (b - a) * Math.min(1, t * dt);
    dive.current = k(dive.current, p.dive, 9); cel.current = k(cel.current, p.celebrate ? 1 : 0, 6);
    kick.current = Math.max(p.kick, kick.current - dt / 0.38); if (p.kick > 0) kick.current = Math.max(kick.current, p.kick);
    lean.current = k(lean.current, Math.max(-0.35, Math.min(0.35, p.turn * 0.08)), 8);
    const s = Math.sin(phase.current), c = Math.cos(phase.current);
    const defend = p.st === 'defend' ? 1 : 0, tackle = p.st === 'tackle' ? 1 : 0, receive = p.st === 'receive' || p.st === 'miscontrol' ? 1 : 0, dribble = p.st === 'dribble' ? 1 : 0, turning = p.st === 'turn' ? 1 : 0;
    act.current = k(act.current, Math.max(defend, tackle, receive, dribble, turning), 10);
    const idle = Math.sin(performance.now() / 900 + phaseOffset) * 0.015;
    // legs: thigh swings about the hip, the knee bends on the recovery swing
    const lt = s * 0.95 * amp, rt = -s * 0.95 * amp;
    const kb = (v: number) => Math.max(0, -v) * 1.3 * amp + (moving ? 0.1 : 0);
    const kk = kick.current; const kickSwing = Math.sin(Math.min(1, (1 - kk) * 1.0) * Math.PI) * (kk > 0 ? 1 : 0);
    legL.current.rotation.z = lt; legR.current.rotation.z = rt + (kk > 0 ? 1.15 * kickSwing : 0) - (kk > 0 ? 0.5 * (1 - kickSwing) * kk : 0);
    shinL.current.rotation.z = -kb(Math.cos(phase.current + 0.6) * 0.9 + 0.1); shinR.current.rotation.z = -(kb(-Math.cos(phase.current + 0.6) * 0.9 - 0.1) + (kk > 0 ? 0.9 * (1 - kickSwing) : 0));
    // arms counter-swing; hands up on celebration and on a dive
    const celUp = cel.current, dv = Math.abs(dive.current);
    armL.current.rotation.z = -s * 0.7 * amp * (1 - celUp) + celUp * 2.6 + dv * 2.5 + idle; armR.current.rotation.z = s * 0.7 * amp * (1 - celUp) + celUp * 2.6 + dv * 2.5 - idle;
    armL.current.rotation.x = celUp * 0.35; armR.current.rotation.x = -celUp * 0.35;
    foreL.current.rotation.z = -(0.35 + amp * 0.7 * Math.max(0, c)) * (1 - celUp * 0.7); foreR.current.rotation.z = -(0.35 + amp * 0.7 * Math.max(0, -c)) * (1 - celUp * 0.7);
    if (p.react) { armL.current.rotation.z = 2.9; armR.current.rotation.z = 2.9; armL.current.rotation.x = 0.5; armR.current.rotation.x = -0.5; foreL.current.rotation.z = -1.8; foreR.current.rotation.z = -1.8; }
    // torso: forward lean with speed, sideways roll on dives, bounce on celebration / run
    body.current.rotation.z = Math.min(0.28, sp * 0.04) + (p.react ? 0.25 : 0);
    body.current.rotation.x = dive.current * 1.35 + lean.current;
    body.current.position.y = 0.95 + Math.abs(Math.cos(phase.current)) * 0.04 * amp + Math.abs(Math.sin(performance.now() / 160)) * 0.12 * celUp - dv * 0.45 + idle * 0.5;
    // action overlays: defensive crouch with arms out, tackle lunge, cushioned first touch, close-control dribble, pivot turn
    if (defend) { armL.current.rotation.z = 1.0; armR.current.rotation.z = 1.0; armL.current.rotation.x = 0.6; armR.current.rotation.x = -0.6; body.current.position.y -= 0.07; body.current.rotation.z += 0.12; shinL.current.rotation.z -= 0.35; shinR.current.rotation.z -= 0.35; }
    if (tackle) { legR.current.rotation.z = 1.25; shinR.current.rotation.z = -0.1; legL.current.rotation.z = -0.7; shinL.current.rotation.z = -0.9; body.current.rotation.z += 0.35; body.current.position.y -= 0.22; armL.current.rotation.z = 1.7; armR.current.rotation.z = 0.4; }
    if (receive) { legR.current.rotation.z = 0.65; shinR.current.rotation.z = -0.55; body.current.rotation.z -= 0.08; armL.current.rotation.z = 0.9; armR.current.rotation.z = 0.9; }
    if (dribble) { legR.current.rotation.z *= 0.6; body.current.rotation.z += 0.1; armL.current.rotation.z += 0.25; armR.current.rotation.z -= 0.25; }
    if (turning) { body.current.rotation.z += 0.1; armL.current.rotation.z = 0.8; armR.current.rotation.z = 0.8; }
    head.current.rotation.z = p.react ? 0.45 : -Math.min(0.12, sp * 0.015);
  });

  const limb = (len: number, rad: number, mat: THREE.Material, y = -len / 2) => <mesh position={[0, y, 0]} castShadow material={mat}><capsuleGeometry args={[rad, len - rad * 2, 3, 8]} /></mesh>;
  const arm = (ref: MutableRefObject<THREE.Group>, fore: MutableRefObject<THREE.Group>, z: number) => (
    <group ref={ref} position={[0, 0.6, z]}>{limb(0.3, 0.045, mats.shirt)}
      <group ref={fore} position={[0, -0.3, 0]}>{limb(0.28, 0.038, mats.skin)}<mesh position={[0, -0.31, 0]} material={mats.gloves}><sphereGeometry args={[0.05, 8, 8]} /></mesh></group></group>);
  const leg = (ref: MutableRefObject<THREE.Group>, shin: MutableRefObject<THREE.Group>, z: number) => (
    <group ref={ref} position={[0, 0, z]}>{limb(0.46, 0.075, mats.shorts)}
      <group ref={shin} position={[0, -0.46, 0]}>{limb(0.44, 0.052, mats.socks)}<mesh position={[0.05, -0.46, 0]} castShadow material={mats.boots}><boxGeometry args={[0.24, 0.07, 0.1]} /></mesh></group></group>);
  return <group>
    <group ref={body} position={[0, 0.95, 0]}>
      <mesh position={[0, 0.33, 0]} castShadow material={mats.shirt}><boxGeometry args={[0.2, 0.56, 0.4]} /></mesh>
      <mesh position={[0, 0.02, 0]} castShadow material={mats.shorts}><boxGeometry args={[0.22, 0.18, 0.38]} /></mesh>
      <group ref={head} position={[0, 0.7, 0]}>
        <mesh castShadow material={mats.skin}><sphereGeometry args={[0.115, 14, 14]} /></mesh>
        <mesh position={[-0.02, 0.04, 0]} material={mats.hair}><sphereGeometry args={[0.12, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55]} /></mesh>
        <mesh position={[0, -0.12, 0]} material={mats.skin}><cylinderGeometry args={[0.04, 0.05, 0.1, 8]} /></mesh>
      </group>
      {arm(armL, foreL, -0.26)}{arm(armR, foreR, 0.26)}
      {leg(legL, shinL, -0.1)}{leg(legR, shinR, 0.1)}
    </group>
    {label !== undefined && <Label position={[0, 2.12, 0]} text={label} scale={labelScale} />}
  </group>;
}
