import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import { useMemo, useRef, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { Humanoid, kitFor, newPose, type PoseInput } from './Humanoid';

export interface PFrame { t: number; bx: number; by: number; bz: number; kx: number; kz: number; tx: number; tz: number }
const L = 20;

/** Dedicated penalty camera: low three-quarter view that frames the taker, the spot, the keeper and the whole goal mouth. */
function Rig() {
  const { camera } = useThree();
  useFrame(() => { camera.position.set(L - 11.2, 2.6, 5.2); camera.lookAt(L - 2.2, 0.9, -0.1); });
  return null;
}

function Actors({ frames, tColor, tColor2, kColor, playRef }: { frames: PFrame[]; tColor: string; tColor2: string; kColor: string; playRef: MutableRefObject<{ t0: number; speed: number }> }) {
  const ball = useRef<THREE.Mesh>(null!); const taker = useRef<THREE.Group>(null!); const keeper = useRef<THREE.Group>(null!);
  const tp = useRef<PoseInput>(newPose()), kp = useRef<PoseInput>(newPose()); const last = useRef({ tx: 0, tz: 0, kz: 0, t: 0, bx: 0, kicked: false });
  const tKit = useMemo(() => kitFor(tColor, tColor2, 2), [tColor, tColor2]); const kKit = useMemo(() => kitFor(kColor, '#0b1220', 4, true), [kColor]);
  useFrame(() => {
    if (!frames.length) return; const t = ((performance.now() - playRef.current.t0) / 1000) * playRef.current.speed; const lastF = frames[frames.length - 1];
    const tt = Math.min(t, lastF.t); let i = 0; while (i < frames.length - 1 && frames[i + 1].t <= tt) i++; const a = frames[i], b = frames[Math.min(i + 1, frames.length - 1)]; const k = b.t > a.t ? (tt - a.t) / (b.t - a.t) : 0; const lp = (x: number, y: number) => x + (y - x) * k;
    const bx = lp(a.bx, b.bx), by = lp(a.by, b.by), bz = lp(a.bz, b.bz); ball.current.position.set(bx, by, bz);
    const tx = lp(a.tx, b.tx), tz = lp(a.tz, b.tz), kx = lp(a.kx, b.kx), kz = lp(a.kz, b.kz);
    taker.current.position.set(tx, 0, tz); keeper.current.position.set(kx, 0, kz); taker.current.rotation.y = 0; keeper.current.rotation.y = Math.PI;
    const l = last.current; const dt = Math.max(1e-3, tt - l.t);
    if (tt < l.t) { l.kicked = false; l.bx = bx; }
    tp.current.speed = Math.min(7, Math.hypot(tx - l.tx, tz - l.tz) / dt);
    const kv = (kz - l.kz) / dt; kp.current.speed = Math.min(4, Math.abs(kv)); kp.current.dive = Math.abs(kv) > 1.2 ? -Math.sign(kv) : kp.current.dive * 0.9;
    if (!l.kicked && Math.abs(bx - l.bx) > 0.05) { l.kicked = true; tp.current.kick = 1; } else tp.current.kick = Math.max(0, tp.current.kick - dt / 0.38);
    if (tt >= lastF.t - 0.05) { tp.current.react = false; }
    l.tx = tx; l.tz = tz; l.kz = kz; l.t = tt; if (!l.kicked) l.bx = bx;
  });
  return <>
    <group ref={taker}><Humanoid kit={tKit} pose={tp} label="TAKER" labelScale={0.4} /></group>
    <group ref={keeper}><Humanoid kit={kKit} pose={kp} label="GK" labelScale={0.4} /></group>
    <mesh ref={ball} castShadow><sphereGeometry args={[0.11, 16, 16]} /><meshStandardMaterial color="#fff" roughness={0.4} /></mesh>
  </>;
}

/** A visible goal net (grid of lines on the back, sides and top) so goals read as goals. */
function Net() {
  const lines = useMemo(() => {
    const out: [number, number, number][][] = [];
    for (let z = -1.5; z <= 1.51; z += 0.25) { out.push([[L, 0, z], [L + 1, 0, z]], [[L + 1, 0, z], [L + 1, 2, z]], [[L, 2, z], [L + 1, 2, z]]); }
    for (let y = 0; y <= 2.01; y += 0.25) { out.push([[L + 1, y, -1.5], [L + 1, y, 1.5]], [[L, y, -1.5], [L + 1, y, -1.5]], [[L, y, 1.5], [L + 1, y, 1.5]]); }
    for (let x = L; x <= L + 1.01; x += 0.25) { out.push([[x, 2, -1.5], [x, 2, 1.5]]); }
    return out;
  }, []);
  return <group>{lines.map((pts, i) => <Line key={i} points={pts} color="#e2e8f0" lineWidth={0.6} transparent opacity={0.32} />)}</group>;
}

export function PenaltyScene({ frames, tColor, kColor, playRef, tColor2 = '#0b1220' }: { frames: PFrame[]; tColor: string; kColor: string; playRef: MutableRefObject<{ t0: number; speed: number }>; tColor2?: string }) {
  const area = useMemo(() => { const pts: [number, number, number][] = []; for (let i = 0; i <= 40; i++) { const a = -Math.PI / 2 + (i / 40) * Math.PI; pts.push([L - Math.cos(a) * 6, 0.02, Math.sin(a) * 6]); } return pts; }, []);
  return <Canvas shadows dpr={[1, 1.5]} camera={{ fov: 42, near: 0.1, far: 120 }}>
    <color attach="background" args={['#060709']} /><fog attach="fog" args={['#060709', 22, 55]} />
    <ambientLight intensity={0.75} /><spotLight position={[L - 6, 11, 5]} intensity={170} angle={0.75} penumbra={0.6} castShadow /><pointLight position={[L + 2, 3, 0]} intensity={14} color="#a7f3d0" />
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[70, 30]} /><meshStandardMaterial color="#3a7468" roughness={0.6} /></mesh>
    <mesh position={[L - 6, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[0.14, 16]} /><meshBasicMaterial color="#fff" /></mesh>
    <mesh position={[L - 10, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[0.1, 16]} /><meshBasicMaterial color="#fff" /></mesh>
    <mesh position={[L, 0.008, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[0.1, 22]} /><meshBasicMaterial color="#fff" /></mesh>
    <Line points={area} color="#e8f5ee" lineWidth={1.6} />
    {[-1.5, 1.5].map((z) => <mesh key={z} position={[L, 1, z]} castShadow><cylinderGeometry args={[0.05, 0.05, 2, 8]} /><meshStandardMaterial color="#fff" /></mesh>)}
    <mesh position={[L, 2, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow><cylinderGeometry args={[0.05, 0.05, 3.1, 8]} /><meshStandardMaterial color="#fff" /></mesh>
    <Net />
    <mesh position={[L + 5, 1.5, 0]}><boxGeometry args={[0.2, 3, 26]} /><meshStandardMaterial color="#0b0c10" emissive="#e9b44c" emissiveIntensity={0.18} /></mesh>
    <Actors frames={frames} tColor={tColor} tColor2={tColor2} kColor={kColor} playRef={playRef} /><Rig />
  </Canvas>;
}
