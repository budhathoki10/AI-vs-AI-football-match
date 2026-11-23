# Design system

Tokens (`apps/web/src/styles.css`): deep navy/charcoal backgrounds (`--bg #0b1220`, panels `#121e33`), emerald accent (`#10b981`), white text, muted `#8fa0ba`, subtle 1 px borders, 10 px radius, system font stack with tabular numerals for clocks/scores.
Components: `.card`, `.btn` (primary/ghost/danger/sm), form controls, `.tablewrap` tables, `.chip` status badges, `.tabs`, broadcast `.score` board, `.timeline`, `.bar` stat bars, penalty `.pk` history dots, `.stage` 3D frame with `.camtabs`.
Responsive: breakpoints 860 px (sidebar → top bar + bottom nav, single-column grids, 4:3 stage) and 1100 px; verified at 1280 px and 390 px (no horizontal overflow on the create page). Motion: framer-motion banners for goal/half-time/full-time/shootout results; `prefers-reduced-motion` disables animation. Avoided: heavy glassmorphism, glow borders, decorative icons.
