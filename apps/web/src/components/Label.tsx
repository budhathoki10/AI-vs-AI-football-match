import { useMemo } from 'react';
import * as THREE from 'three';

/** Billboard text drawn on a canvas (no remote font download, works offline). */
export function Label({ text, position, scale = 0.7 }: { text: string; position: [number, number, number]; scale?: number }) {
  const tex = useMemo(() => {
    const c = document.createElement('canvas'); c.width = 128; c.height = 64; const g = c.getContext('2d')!;
    g.font = '700 44px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 6; g.strokeStyle = '#000'; g.strokeText(text, 64, 34); g.fillStyle = '#fff'; g.fillText(text, 64, 34);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }, [text]);
  return <sprite position={position} scale={[scale * 2, scale, 1]}><spriteMaterial map={tex} transparent depthTest={false} /></sprite>;
}
