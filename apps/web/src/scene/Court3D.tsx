import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import { Humanoid, kitFor, newPose, type PoseInput } from './Humanoid';
import { useMemo, useRef, type MutableRefObject } from 'react';
import * as THREE from 'three';
import type { Frame } from '../lib/types';
import { Track } from './track';

export type CamMode = 'broadcast' | 'tactical' | 'follow' | 'goal' | 'replay';
export interface Celebration { team: 'A' | 'B' | null; until: number; sad?: 'A' | 'B' | null }
export interface TeamLook { A: [string, string]; B: [string, string]; numbers: Record<string, number>; roles: Record<string, string> }
const L = 20, W = 10;
/** the scene is drawn this far behind the newest simulation sample so there are always two samples to interpolate between */
const INTERP_MS = 90;

function Lines() {
  const mat = <meshBasicMaterial color="#e8f5ee" />;
  const bar = (x: number, z: number, sx: number, sz: number, k: string) => <mesh key={k} position={[x, 0.012, z]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[sx, sz]} />{mat}</mesh>;
  const area = (s: number) => { const pts: [number, number, number][] = []; for (let i = 0; i <= 40; i++) { const a = -Math.PI / 2 + (i / 40) * Math.PI; pts.push([s * (L - Math.cos(a) * 6), 0.02, Math.sin(a) * 6]); } return <Line key={`a${s}`} points={pts} color="#e8f5ee" lineWidth={1.6} />; };
  const circle = useMemo(() => { const pts: [number, number, number][] = []; for (let i = 0; i <= 48; i++) { const a = (i / 48) * Math.PI * 2; pts.push([Math.cos(a) * 3, 0.02, Math.sin(a) * 3]); } return pts; }, []);
  return <group>
    {bar(0, W, 2 * L, 0.08, 't1')}{bar(0, -W, 2 * L, 0.08, 't2')}{bar(L, 0, 0.08, 2 * W, 'g1')}{bar(-L, 0, 0.08, 2 * W, 'g2')}{bar(0, 0, 0.08, 2 * W, 'mid')}
    <Line points={circle} color="#e8f5ee" lineWidth={1.6} />{area(1)}{area(-1)}
    {[L - 6, -(L - 6)].map((x) => <mesh key={x} position={[x, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[0.12, 12]} />{mat}</mesh>)}
    {[L - 10, -(L - 10)].map((x) => <mesh key={x} position={[x, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[0.1, 12]} />{mat}</mesh>)}
  </group>;
}

function Goal({ s }: { s: number }) {
  const post = '#f8fafc';
  return <group position={[s * L, 0, 0]}>
    {[-1.5, 1.5].map((z) => <mesh key={z} position={[0, 1, z]}><cylinderGeometry args={[0.05, 0.05, 2, 8]} /><meshStandardMaterial color={post} /></mesh>)}
    <mesh position={[0, 2, 0]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.05, 0.05, 3.1, 8]} /><meshStandardMaterial color={post} /></mesh>
    <mesh position={[s * 0.5, 1, 0]}><boxGeometry args={[1, 2, 3]} /><meshBasicMaterial color="#ffffff" wireframe transparent opacity={0.25} /></mesh>
  </group>;
}

function Arena() {
  const board = '#e9b44c';
  return <group>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow><planeGeometry args={[2 * L + 8, 2 * W + 8]} /><meshStandardMaterial color="#0d0f14" /></mesh>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow><planeGeometry args={[2 * L, 2 * W]} /><meshStandardMaterial color="#3a7468" roughness={0.6} /></mesh>
    <Lines /><Goal s={1} /><Goal s={-1} />
    {[1, -1].map((s) => <mesh key={s} position={[0, 0.4, s * (W + 2.2)]}><boxGeometry args={[2 * L + 6, 0.8, 0.15]} /><meshStandardMaterial color="#0b1220" emissive={board} emissiveIntensity={0.25} /></mesh>)}
    {[1, -1].map((s) => <mesh key={`e${s}`} position={[s * (L + 4), 0.4, 0]}><boxGeometry args={[0.15, 0.8, 2 * W + 4]} /><meshStandardMaterial color="#0b1220" emissive={board} emissiveIntensity={0.25} /></mesh>)}
    {[1, -1].map((s) => <group key={`st${s}`}>{[0, 1, 2, 3].map((r) => <mesh key={r} position={[0, 0.8 + r * 0.7, s * (W + 4 + r * 1.1)]}><boxGeometry args={[2 * L + 6, 0.6, 1.1]} /><meshStandardMaterial color={['#14161c', '#1a1d25', '#14161c', '#1a1d25'][r]} /></mesh>)}</group>)}
    <mesh position={[0, 0.9, W - 0.8]} />
  </group>;
}

function Player({ id, look, team, frameRef, idx, celebrate }: { id: string; look: TeamLook; team: 'A' | 'B'; frameRef: MutableRefObject<Frame | null>; idx: number; celebrate?: MutableRefObject<Celebration> }) {
  const g = useRef<THREE.Group>(null!); const pose = useRef<PoseInput>(newPose());
  const isGk = look.roles[id] === 'GK'; const [p, s] = look[team];
  const kit = useMemo(() => kitFor(p, s, idx, isGk), [p, s, idx, isGk]);
  const prev = useRef({ x: 0, z: 0, h: 0, st: 'idle', init: false }); const track = useRef(new Track(3)); const lastFrame = useRef<Frame | null>(null);
  useFrame((_, dt) => {
    const f = frameRef.current; const e = f?.players.find((q) => q[0] === id);
    if (!e || !f) { g.current.visible = false; prev.current.init = false; track.current.reset(); lastFrame.current = null; return; }
    g.current.visible = true;
    if (f !== lastFrame.current) { lastFrame.current = f; track.current.push(performance.now(), [e[1], e[2], e[3]], [false, false, true]); }
    const [ix, iz, ih] = track.current.sample(performance.now() - INTERP_MS);
    if (!prev.current.init) { g.current.position.set(ix, 0, iz); prev.current = { x: ix, z: iz, h: ih, st: e[4], init: true }; }
    const ox = g.current.position.x, oz = g.current.position.z;
    g.current.position.x = ix; g.current.position.z = iz;
    let da = -ih - g.current.rotation.y; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI; g.current.rotation.y += da * Math.min(1, dt * 14);
    // ground speed measured from the rendered motion (gait follows real speed, never faster)
    const vx = (g.current.position.x - ox) / Math.max(dt, 1e-3), vz = (g.current.position.z - oz) / Math.max(dt, 1e-3); const sp = Math.hypot(vx, vz);
    const po = pose.current; po.speed += (sp - po.speed) * Math.min(1, dt * 8); po.turn = da / Math.max(dt, 1e-3);
    const st = e[4]; po.st = st; if (st !== prev.current.st && (st === 'shoot' || st === 'pass' || st === 'kick' || st === 'tackle')) po.kick = 1; else po.kick = Math.max(0, po.kick - dt / 0.38);
    prev.current.st = st; prev.current.h = e[3];
    const right = -Math.sin(e[3]) * vx + Math.cos(e[3]) * vz; po.dive = st === 'dive' ? Math.sign(right || 1) : 0;
    const c = celebrate?.current; const now = performance.now(); po.celebrate = !!c && c.team === team && c.until > now; po.react = !!c && c.sad === team && c.until > now;
  });
  return <group ref={g}><Humanoid kit={kit} pose={pose} label={String(look.numbers[id] ?? '')} phaseOffset={idx * 1.7} /></group>;
}

/** Referee: shadows the play from the touchline side, in black with a yellow bib. */
function Referee({ frameRef }: { frameRef: MutableRefObject<Frame | null> }) {
  const g = useRef<THREE.Group>(null!); const pose = useRef<PoseInput>(newPose()); const kit = useMemo(() => ({ shirt: '#eab308', shorts: '#0b1220', socks: '#0b1220', skin: '#e0ac87', hair: '#1b1410', boots: '#000' }), []);
  useFrame((_, dt) => {
    const b = frameRef.current?.ball; if (!b) return; const k = 1 - Math.pow(0.15, dt);
    const tx = Math.max(-L + 2, Math.min(L - 2, b[0] * 0.8 - 2)), tz = Math.max(-W + 1, Math.min(W - 1, b[2] * 0.6 + (b[2] >= 0 ? -3.5 : 3.5)));
    const ox = g.current.position.x, oz = g.current.position.z; g.current.position.x += (tx - ox) * k * 0.6; g.current.position.z += (tz - oz) * k * 0.6;
    const vx = (g.current.position.x - ox) / Math.max(dt, 1e-3), vz = (g.current.position.z - oz) / Math.max(dt, 1e-3); const sp = Math.min(6, Math.hypot(vx, vz));
    pose.current.speed += (sp - pose.current.speed) * Math.min(1, dt * 6);
    const want = -Math.atan2(b[2] - g.current.position.z, b[0] - g.current.position.x); let da = want - g.current.rotation.y; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI; g.current.rotation.y += da * Math.min(1, dt * 5);
  });
  return <group ref={g} position={[0, 0, -5]}><Humanoid kit={kit} pose={pose} phaseOffset={3} /></group>;
}

/** Spectators: one instanced mesh, team-coloured supporters, a gentle sway (cheap: no per-person objects). */
function Crowd({ colors, quality }: { colors: [string, string]; quality: 'low' | 'medium' | 'high' }) {
  const ref = useRef<THREE.InstancedMesh>(null!); const dummy = useMemo(() => new THREE.Object3D(), []);
  const seats = useMemo(() => {
    const out: { x: number; y: number; z: number; c: THREE.Color; ph: number }[] = []; const neutral = ['#94a3b8', '#64748b', '#cbd5e1', '#475569', '#e2e8f0'];
    const per = quality === 'low' ? 18 : quality === 'medium' ? 36 : 54;
    for (const side of [1, -1]) for (let r = 0; r < 4; r++) for (let i = 0; i < per; i++) {
      const x = -L - 2 + (i / (per - 1)) * (2 * L + 4); const hash = Math.sin(i * 12.9898 + r * 78.233 + side * 3.1) * 43758.5453; const u = hash - Math.floor(hash);
      const fan = u < 0.34 ? colors[0] : u < 0.62 ? colors[1] : neutral[Math.floor(u * 97) % neutral.length];
      out.push({ x, y: 1.25 + r * 0.7, z: side * (W + 4.2 + r * 1.1), c: new THREE.Color(fan), ph: u * 6.28 });
    }
    return out;
  }, [colors, quality]);
  useFrame(({ clock }) => {
    const m = ref.current; if (!m) return; const t = clock.getElapsedTime();
    seats.forEach((s, i) => { dummy.position.set(s.x, s.y + Math.max(0, Math.sin(t * 1.6 + s.ph)) * 0.05, s.z); dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix); m.setColorAt(i, s.c); });
    m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });
  return <instancedMesh ref={ref} args={[undefined, undefined, seats.length]}><capsuleGeometry args={[0.2, 0.35, 3, 6]} /><meshStandardMaterial roughness={0.8} /></instancedMesh>;
}

/** Benches with the substitutes seated, plus the substitution zone marked on the touchline. */
function Benches({ look }: { look: TeamLook }) {
  const subs = (team: 'A' | 'B') => Object.keys(look.numbers).filter((id) => id.startsWith(team) && look.roles[id] !== 'GK').slice(4, 7);
  const still = useRef<PoseInput>({ ...newPose() });
  return <group>{(['A', 'B'] as const).map((team, ti) => {
    const sx = ti === 0 ? -6 : 6; const [p, s] = look[team];
    return <group key={team} position={[sx, 0, W + 1.9]}>
      <mesh position={[0, 0.25, 0]}><boxGeometry args={[5, 0.5, 0.7]} /><meshStandardMaterial color="#334155" /></mesh>
      <mesh position={[0, 0.9, 0.3]}><boxGeometry args={[5, 0.7, 0.08]} /><meshStandardMaterial color="#1e293b" /></mesh>
      {subs(team).map((id, i) => <group key={id} position={[-1.4 + i * 1.4, 0.35, 0]} rotation={[0, -Math.PI / 2, 0]} scale={0.95}><group position={[0, -0.12, 0]}><Humanoid kit={kitFor(p, s, 7 + i + ti * 3)} pose={still} phaseOffset={i} /></group></group>)}
      <mesh position={[0, 0.011, -1.1]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[5, 0.06]} /><meshBasicMaterial color="#fbbf24" /></mesh>
    </group>; })}</group>;
}

function Ball({ frameRef, trail, debug }: { frameRef: MutableRefObject<Frame | null>; trail?: boolean; debug?: boolean }) {
  const m = useRef<THREE.Mesh>(null!); const track = useRef(new Track(3)); const lastFrame = useRef<Frame | null>(null); const ring = useRef<THREE.Mesh>(null!); const pts = useRef<[number, number, number][]>([[0, 0.1, 0], [0, 0.1, 0]]); const lineRef = useRef<any>(null);
  useFrame((_, dt) => {
    const f = frameRef.current; const raw = f?.ball; if (!f || !raw) return;
    if (f !== lastFrame.current) { lastFrame.current = f; track.current.push(performance.now(), [raw[0], raw[1], raw[2]]); }
    const b = track.current.sample(performance.now() - INTERP_MS);
    m.current.position.set(b[0], b[1], b[2]);
    if (ring.current) { const o = debug && f.own ? f.players.find((q) => q[0] === f.own) : null; ring.current.visible = !!o; if (o) ring.current.position.set(o[1], 0.04, o[2]); }
    m.current.rotation.x += dt * 4; m.current.rotation.z += dt * 3;
    if (trail) { const p = pts.current; const last = p[p.length - 1]; if (Math.hypot(last[0] - b[0], last[2] - b[2]) > 0.4) { p.push([b[0], 0.12, b[2]]); if (p.length > 40) p.shift(); if (lineRef.current?.geometry?.setPositions) lineRef.current.geometry.setPositions(p.flat()); } }
  });
  return <group><mesh ref={m} castShadow position={[0, 0.1, 0]}><sphereGeometry args={[0.11, 16, 16]} /><meshStandardMaterial color="#fafafa" roughness={0.4} /></mesh>
    <mesh ref={ring} visible={false} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.55, 0.68, 32]} /><meshBasicMaterial color="#22d3ee" transparent opacity={0.9} /></mesh>
    {trail && <Line ref={lineRef} points={[[0, 0.1, 0], [0.01, 0.1, 0]]} color="#fbbf24" lineWidth={1.5} transparent opacity={0.7} />}</group>;
}

function CameraRig({ mode, frameRef, follow }: { mode: CamMode; frameRef: MutableRefObject<Frame | null>; follow?: string }) {
  const { camera } = useThree(); const look = useRef(new THREE.Vector3()); const pos = useRef(new THREE.Vector3(0, 14, 24));
  useFrame((_, dt) => {
    const f = frameRef.current; const b = f?.ball ?? [0, 0, 0]; const k = 1 - Math.pow(0.02, dt);
    const target = new THREE.Vector3(), lookAt = new THREE.Vector3(b[0] * 0.6, 0.5, b[2] * 0.4);
    if (mode === 'broadcast') target.set(b[0] * 0.45, 15.5, 29);
    else if (mode === 'tactical') { target.set(0, 36, 0.01); lookAt.set(0, 0, 0); }
    else if (mode === 'follow') { const pl = follow ? f?.players.find((p) => p[0] === follow) : null; const fx = pl ? pl[1] : b[0], fz = pl ? pl[2] : b[2]; target.set(fx - Math.sign(fx || 1) * 5, 5, fz + 8); lookAt.set(fx, 0.8, fz); }
    else if (mode === 'goal') { const s = b[0] >= 0 ? 1 : -1; target.set(s * (L + 5.5), 3.2, b[2] * 0.3); lookAt.set(s * (L - 4), 0.8, b[2] * 0.5); }
    else { target.set(b[0] + 7, 4.5, 11); lookAt.set(b[0], 0.4, b[2]); }
    pos.current.lerp(target, k); look.current.lerp(lookAt, k); camera.position.copy(pos.current); camera.lookAt(look.current);
  });
  return null;
}

export function Court3D({ frameRef, look, mode, follow, trail, quality = 'medium', celebrate, debug }: { debug?: boolean; frameRef: MutableRefObject<Frame | null>; look: TeamLook; mode: CamMode; follow?: string; trail?: boolean; quality?: 'low' | 'medium' | 'high'; celebrate?: MutableRefObject<Celebration> }) {
  const ids = Object.keys(look.numbers);
  return <Canvas shadows={quality !== 'low'} dpr={quality === 'high' ? [1, 2] : [1, 1.5]} camera={{ fov: 45, position: [0, 14, 24], near: 0.1, far: 200 }} gl={{ antialias: quality !== 'low' }}>
    <color attach="background" args={['#060709']} />
    <fog attach="fog" args={['#060709', 45, 90]} />
    <ambientLight intensity={0.7} />
    <directionalLight position={[10, 25, 8]} intensity={1.1} castShadow={quality !== 'low'} shadow-mapSize={[1024, 1024]} shadow-camera-left={-26} shadow-camera-right={26} shadow-camera-top={16} shadow-camera-bottom={-16} />
    {[-12, 12].map((x) => <pointLight key={x} position={[x, 9, 0]} intensity={0.5} />)}
    <Arena />
    {ids.map((id, i) => <Player key={id} id={id} idx={i} team={id.startsWith('A') ? 'A' : 'B'} look={look} frameRef={frameRef} celebrate={celebrate} />)}
    <Referee frameRef={frameRef} /><Crowd colors={[look.A[0], look.B[1]]} quality={quality} /><Benches look={look} />
    <Ball frameRef={frameRef} trail={trail} debug={debug} />
    <CameraRig mode={mode} frameRef={frameRef} follow={follow} />
  </Canvas>;
}
