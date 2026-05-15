/** Decorative concentric rings behind 1v1 duel cards (Quick + Private match hubs). */
export function ArenaRings() {
  return (
    <svg
      className="pml-arena-rings"
      viewBox="-200 -200 400 400"
      aria-hidden
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <radialGradient id="pml-ring-fade" cx="50%" cy="50%" r="70%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.85)" />
          <stop offset="55%" stopColor="rgba(255,255,255,0.35)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </radialGradient>
        <mask id="pml-ring-mask">
          <rect x="-200" y="-200" width="400" height="400" fill="url(#pml-ring-fade)" />
        </mask>
      </defs>
      <g mask="url(#pml-ring-mask)" fill="none" stroke="rgba(140,210,230,0.45)" strokeWidth="0.6">
        <circle r="14" />
        <circle r="24" />
        <circle r="36" />
        <circle r="50" />
        <circle r="66" />
        <circle r="84" />
        <circle r="104" />
        <circle r="126" />
        <circle r="150" />
        <circle r="176" />
        <circle r="204" />
        <circle r="234" />
      </g>
      <g mask="url(#pml-ring-mask)" stroke="rgba(140,210,230,0.4)" strokeWidth="0.5" strokeDasharray="2 4">
        <line x1="-230" y1="0" x2="230" y2="0" />
      </g>
    </svg>
  );
}
