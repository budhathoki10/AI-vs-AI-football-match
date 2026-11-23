import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Label } from './Label';
import { useRef, type MutableRefObject } from 'react';
import * as THREE from 'three';

export interface PFrame { t: number; bx: number; by: number; bz: number; kx: number; kz: number; tx: number; tz: number }
const L = 20;

function Rig() {
  const { camera } = useThree();
  useFrame(() => { camera.position.set(5.4, 2.7, 4.2); camera.lookAt(L - 2.5, 0.8, -0.2); });
  return null;
}
function Actors({ frames, tColor, kColor, playRef }: { frames: PFrame[]; tColor: string; kColor: string; playRef: MutableRefObject<{ t0: number; speed: number }> }) {
  const ball = useRef<THREE.Mesh>(null!); const taker = useRef<THREE.Group>(null!); const keeper = useRef<THREE.Group>(null!);
  useFrame(() => {
    if (!frames.length) return; const t = ((performance.now() - playRef.current.t0) / 1000) * playRef.current.speed; const last = frames[frames.length - 1];
    const tt = Math.min(t, last.t); let i = 0; while (i < frames.length - 1 && frames[i + 1].t <= tt) i++; const a = frames[i], b = frames[Math.min(i + 1, frames.length - 1)]; const k = b.t > a.t ? (tt - a.t) / (b.t - a.t) : 0; const lp = (x: number, y: number) => x + (y - x) * k;
    ball.current.position.set(lp(a.bx, b.bx), lp(a.by, b.by), lp(a.bz, b.bz)); taker.current.position.set(lp(a.tx, b.tx), 0, lp(a.tz, b.tz));
    const kz = lp(a.kz, b.kz); keeper.current.position.set(lp(a.kx, b.kx), 0, kz); keeper.current.rotation.x = Math.max(-1.2, Math.min(1.2, (kz) * 0.7)) * -0.0 + 0; keeper.current.rotation.z = -Math.max(-1.1, Math.min(1.1, (kz - 0) * 0.55));
  });
  const person = (c: string, ref: MutableRefObject<THREE.Group>, label: string) => <group ref={ref}>
    <mesh position={[0, 0.95, 0]} castShadow><capsuleGeometry args={[0.27, 0.8, 4, 10]} /><meshStandardMaterial color={c} /></mesh>
    <mesh position={[0, 1.65, 0]}><sphereGeometry args={[0.18, 12, 12]} /><meshStandardMaterial color="#e5b794" /></mesh>
    <Label position={[0, 2.2, 0]} text={label} scale={0.45} /></group>;
  return <>{person(tColor, taker, 'TAKER')}{person(kColor, keeper, 'GK')}<mesh ref={ball} castShadow><sphereGeometry args={[0.11, 16, 16]} /><meshStandardMaterial color="#fff" /></mesh></>;
}
export function PenaltyScene({ frames, tColor, kColor, playRef }: { frames: PFrame[]; tColor: string; kColor: string; playRef: MutableRefObject<{ t0: number; speed: number }> }) {
  return <Canvas shadows dpr={[1, 1.5]} camera={{ fov: 42, near: 0.1, far: 120 }}>
    <color attach="background" args={['#050a14']} /><fog attach="fog" args={['#050a14', 25, 60]} />
    <ambientLight intensity={0.8} /><spotLight position={[14, 12, 4]} intensity={160} angle={0.7} penumbra={0.6} castShadow />
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[60, 30]} /><meshStandardMaterial color="#1f6f55" /></mesh>
    <mesh position={[L - 6, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[0.14, 16]} /><meshBasicMaterial color="#fff" /></mesh>
    <mesh position={[L, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[0.1, 22]} /><meshBasicMaterial color="#fff" /></mesh>
    {[-1.5, 1.5].map((z) => <mesh key={z} position={[L, 1, z]}><cylinderGeometry args={[0.05, 0.05, 2, 8]} /><meshStandardMaterial color="#fff" /></mesh>)}
    <mesh position={[L, 2, 0]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.05, 0.05, 3.1, 8]} /><meshStandardMaterial color="#fff" /></mesh>
    <mesh position={[L + 0.5, 1, 0]}><boxGeometry args={[1, 2, 3]} /><meshBasicMaterial color="#fff" wireframe transparent opacity={0.3} /></mesh>
    <mesh position={[L + 5, 1.5, 0]}><boxGeometry args={[0.2, 3, 26]} /><meshStandardMaterial color="#0b1220" emissive="#10b981" emissiveIntensity={0.2} /></mesh>
    <Actors frames={frames} tColor={tColor} kColor={kColor} playRef={playRef} /><Rig />
  </Canvas>;
}
