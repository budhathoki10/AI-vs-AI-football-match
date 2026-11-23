import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import { Label } from './Label';
import { useMemo, useRef, type MutableRefObject } from 'react';
import * as THREE from 'three';
import type { Frame } from '../lib/api';

export type CamMode = 'broadcast' | 'tactical' | 'follow' | 'goal' | 'replay';
export interface TeamLook { A: [string, string]; B: [string, string]; numbers: Record<string, number>; roles: Record<string, string> }
const L = 20, W = 10;

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
  const board = '#10b981';
  return <group>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow><planeGeometry args={[2 * L + 8, 2 * W + 8]} /><meshStandardMaterial color="#17324a" /></mesh>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow><planeGeometry args={[2 * L, 2 * W]} /><meshStandardMaterial color="#1f6f55" roughness={0.55} /></mesh>
    <Lines /><Goal s={1} /><Goal s={-1} />
    {[1, -1].map((s) => <mesh key={s} position={[0, 0.4, s * (W + 2.2)]}><boxGeometry args={[2 * L + 6, 0.8, 0.15]} /><meshStandardMaterial color="#0b1220" emissive={board} emissiveIntensity={0.25} /></mesh>)}
    {[1, -1].map((s) => <mesh key={`e${s}`} position={[s * (L + 4), 0.4, 0]}><boxGeometry args={[0.15, 0.8, 2 * W + 4]} /><meshStandardMaterial color="#0b1220" emissive={board} emissiveIntensity={0.25} /></mesh>)}
    {[1, -1].map((s) => <group key={`st${s}`}>{[0, 1, 2, 3].map((r) => <mesh key={r} position={[0, 0.8 + r * 0.7, s * (W + 4 + r * 1.1)]}><boxGeometry args={[2 * L + 6, 0.6, 1.1]} /><meshStandardMaterial color={['#1b2b45', '#223557', '#1b2b45', '#223557'][r]} /></mesh>)}</group>)}
    {[-1, 1].map((s) => <mesh key={`b${s}`} position={[s * 6, 0.5, W + 1.4]}><boxGeometry args={[5, 0.9, 0.7]} /><meshStandardMaterial color="#334155" /></mesh>)}
    <mesh position={[0, 0.9, W - 0.8]} />
  </group>;
}

function Player({ id, look, team, frameRef, idx }: { id: string; look: TeamLook; team: 'A' | 'B'; frameRef: MutableRefObject<Frame | null>; idx: number }) {
  const g = useRef<THREE.Group>(null!); const body = useRef<THREE.Group>(null!);
  const isGk = look.roles[id] === 'GK'; const [p, s] = look[team];
  const shirt = isGk ? '#facc15' : p;
  useFrame((_, dt) => {
    const f = frameRef.current; const e = f?.players.find((q) => q[0] === id);
    if (!e) { g.current.visible = false; return; }
    g.current.visible = true; const k = 1 - Math.pow(0.0001, dt);
    g.current.position.x += (e[1] - g.current.position.x) * k; g.current.position.z += (e[2] - g.current.position.z) * k;
    let da = -e[3] - g.current.rotation.y; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI; g.current.rotation.y += da * Math.min(1, dt * 10);
    const st = e[4]; const t = performance.now() / 1000 + idx;
    const run = st === 'sprint' ? 1 : st === 'run' ? 0.7 : st === 'walk' ? 0.35 : 0;
    body.current.position.y = Math.abs(Math.sin(t * 9)) * 0.06 * run; body.current.rotation.x = st === 'dive' ? 1.3 : run * 0.18 + (st === 'shoot' || st === 'kick' || st === 'pass' ? 0.25 : 0);
    body.current.rotation.z = st === 'dive' ? 0.2 : 0;
  });
  return <group ref={g} position={[0, 0, 0]}>
    <group ref={body}>
      <mesh position={[0, 0.9, 0]} castShadow><capsuleGeometry args={[0.26, 0.7, 4, 10]} /><meshStandardMaterial color={shirt} /></mesh>
      <mesh position={[0, 0.4, 0]}><cylinderGeometry args={[0.24, 0.22, 0.45, 10]} /><meshStandardMaterial color={s} /></mesh>
      <mesh position={[0, 1.55, 0]} castShadow><sphereGeometry args={[0.17, 12, 12]} /><meshStandardMaterial color="#e5b794" /></mesh>
    </group>
    <Label position={[0, 2.1, 0]} text={String(look.numbers[id] ?? '')} />
  </group>;
}

function Ball({ frameRef, trail }: { frameRef: MutableRefObject<Frame | null>; trail?: boolean }) {
  const m = useRef<THREE.Mesh>(null!); const pts = useRef<[number, number, number][]>([[0, 0.1, 0], [0, 0.1, 0]]); const lineRef = useRef<any>(null);
  useFrame((_, dt) => {
    const b = frameRef.current?.ball; if (!b) return; const k = 1 - Math.pow(0.00001, dt);
    m.current.position.x += (b[0] - m.current.position.x) * k; m.current.position.y += (b[1] - m.current.position.y) * k; m.current.position.z += (b[2] - m.current.position.z) * k;
    m.current.rotation.x += dt * 4; m.current.rotation.z += dt * 3;
    if (trail) { const p = pts.current; const last = p[p.length - 1]; if (Math.hypot(last[0] - b[0], last[2] - b[2]) > 0.4) { p.push([b[0], 0.12, b[2]]); if (p.length > 40) p.shift(); if (lineRef.current?.geometry?.setPositions) lineRef.current.geometry.setPositions(p.flat()); } }
  });
  return <group><mesh ref={m} castShadow position={[0, 0.1, 0]}><sphereGeometry args={[0.11, 16, 16]} /><meshStandardMaterial color="#fafafa" roughness={0.4} /></mesh>
    {trail && <Line ref={lineRef} points={[[0, 0.1, 0], [0.01, 0.1, 0]]} color="#fbbf24" lineWidth={1.5} transparent opacity={0.7} />}</group>;
}

function CameraRig({ mode, frameRef, follow }: { mode: CamMode; frameRef: MutableRefObject<Frame | null>; follow?: string }) {
  const { camera } = useThree(); const look = useRef(new THREE.Vector3()); const pos = useRef(new THREE.Vector3(0, 14, 24));
  useFrame((_, dt) => {
    const f = frameRef.current; const b = f?.ball ?? [0, 0, 0]; const k = 1 - Math.pow(0.02, dt);
    const target = new THREE.Vector3(), lookAt = new THREE.Vector3(b[0] * 0.6, 0.5, b[2] * 0.4);
    if (mode === 'broadcast') target.set(b[0] * 0.35, 13, 23);
    else if (mode === 'tactical') { target.set(0, 36, 0.01); lookAt.set(0, 0, 0); }
    else if (mode === 'follow') { const pl = follow ? f?.players.find((p) => p[0] === follow) : null; const fx = pl ? pl[1] : b[0], fz = pl ? pl[2] : b[2]; target.set(fx - Math.sign(fx || 1) * 5, 5, fz + 8); lookAt.set(fx, 0.8, fz); }
    else if (mode === 'goal') { const s = b[0] >= 0 ? 1 : -1; target.set(s * (L + 5.5), 3.2, b[2] * 0.3); lookAt.set(s * (L - 4), 0.8, b[2] * 0.5); }
    else { target.set(b[0] + 7, 4.5, 11); lookAt.set(b[0], 0.4, b[2]); }
    pos.current.lerp(target, k); look.current.lerp(lookAt, k); camera.position.copy(pos.current); camera.lookAt(look.current);
  });
  return null;
}

export function Court3D({ frameRef, look, mode, follow, trail, quality = 'medium' }: { frameRef: MutableRefObject<Frame | null>; look: TeamLook; mode: CamMode; follow?: string; trail?: boolean; quality?: 'low' | 'medium' | 'high' }) {
  const ids = Object.keys(look.numbers);
  return <Canvas shadows={quality !== 'low'} dpr={quality === 'high' ? [1, 2] : [1, 1.5]} camera={{ fov: 45, position: [0, 14, 24], near: 0.1, far: 200 }} gl={{ antialias: quality !== 'low' }}>
    <color attach="background" args={['#060b16']} />
    <fog attach="fog" args={['#060b16', 45, 90]} />
    <ambientLight intensity={0.7} />
    <directionalLight position={[10, 25, 8]} intensity={1.1} castShadow={quality !== 'low'} shadow-mapSize={[1024, 1024]} shadow-camera-left={-26} shadow-camera-right={26} shadow-camera-top={16} shadow-camera-bottom={-16} />
    {[-12, 12].map((x) => <pointLight key={x} position={[x, 9, 0]} intensity={0.5} />)}
    <Arena />
    {ids.map((id, i) => <Player key={id} id={id} idx={i} team={id.startsWith('A') ? 'A' : 'B'} look={look} frameRef={frameRef} />)}
    <Ball frameRef={frameRef} trail={trail} />
    <CameraRig mode={mode} frameRef={frameRef} follow={follow} />
  </Canvas>;
}
