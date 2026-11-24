import { motion } from 'motion/react';

/** Brand mark: a futsal ball in brass. The panels breathe in sequence; hover spins it half a turn. */
export function Logo({ size = 36 }: { size?: number }) {
  return (
    <motion.svg viewBox="0 0 40 40" width={size} height={size} aria-hidden="true" initial={{ rotate: -140, scale: 0.4, opacity: 0 }} animate={{ rotate: 0, scale: 1, opacity: 1 }} whileHover={{ rotate: 180 }} transition={{ type: 'spring', stiffness: 200, damping: 15 }}>
      <defs>
        <linearGradient id="logo-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fbe0a0" /><stop offset="1" stopColor="#d49a35" /></linearGradient>
      </defs>
      <circle cx="20" cy="20" r="16.5" fill="url(#logo-gold)" />
      <g stroke="#1c1405" strokeOpacity="0.55" strokeWidth="1.3" strokeLinecap="round" fill="none">
        <path d="M20 14.8V4M24.95 18.4l10.3-3.4M23.06 24.2l6.4 8.8M16.94 24.2l-6.4 8.8M15.05 18.4 4.75 15" />
      </g>
      <polygon points="20,14.4 25.2,18.2 23.2,24.3 16.8,24.3 14.8,18.2" fill="#1c1405" className="logo-square" />
      <circle cx="20" cy="20" r="16.5" fill="none" stroke="#fff" strokeOpacity="0.35" strokeWidth="1" />
    </motion.svg>
  );
}
