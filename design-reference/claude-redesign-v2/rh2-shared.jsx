// rh2-shared.jsx — Racehorse Design System v2
// Complete visual identity overhaul

const { useState: useStateS, useEffect: useEffectS } = React;

/* ── Design tokens ──────────────────────────────────────── */
const T = {
  bg0: '#01010a', bg1: '#04050d', bg2: '#080912', bg3: '#0d0f1c',
  hero:    "'Outfit', sans-serif",
  display: "'Barlow Condensed', sans-serif",
  label:   "'Rajdhani', sans-serif",
  body:    "'Space Grotesk', sans-serif",
};

/* ── Mode accent colors (bolder, more saturated) ────────── */
const MODE_COLORS = {
  multiplayer:    '#3d8eff',
  'daily-fritz':  '#00f0c8',
  'daily-puzzle': '#ffb800',
  'single-player':'#3d8eff',
  tournament:     '#f0c040',
  learn:          '#00e676',
  ghost:          '#c040ff',
  default:        '#00f0c8',
};

/* ── Utility ─────────────────────────────────────────────── */
function hexToRgb2(hex) {
  const h = (hex||'#888888').replace('#','');
  return `${parseInt(h.slice(0,2),16)},${parseInt(h.slice(2,4),16)},${parseInt(h.slice(4,6),16)}`;
}

/* ── Nav2 ────────────────────────────────────────────────── */
function Nav2({ navigate, variant = 'home', backLabel = 'Back', backTo = 'home' }) {
  return (
    <nav style={{
      height: 46, display: 'flex', alignItems: 'center',
      padding: '0 clamp(20px,3vw,52px)', flexShrink: 0, gap: 0,
      borderBottom: '1px solid rgba(255,255,255,0.05)',
      background: 'rgba(1,1,10,0.94)', backdropFilter: 'blur(24px)',
      position: 'relative', zIndex: 100,
    }}>
      <div onClick={() => navigate('home')} style={{
        fontFamily: T.display, fontSize: '15px', fontWeight: 800,
        letterSpacing: '0.42em', textTransform: 'uppercase',
        color: 'rgba(255,255,255,0.92)', cursor: 'pointer', userSelect: 'none',
      }}>RACEHORSE</div>

      {variant === 'home' ? (
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => navigate('my-stats')} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '5px 14px', borderRadius: 3,
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
            cursor: 'pointer', transition: 'all 120ms ease',
            fontFamily: T.body, fontSize: '13px', fontWeight: 500,
            color: 'rgba(255,255,255,0.72)',
          }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.09)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
          >
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#00f0c8', boxShadow: '0 0 7px #00f0c8bb', flexShrink: 0 }} />
            @oliver · 1,821
          </button>
          <button onClick={() => navigate('friends')} style={{
            padding: '5px 14px', borderRadius: 3, cursor: 'pointer',
            background: 'transparent', border: '1px solid rgba(255,255,255,0.07)',
            fontFamily: T.label, fontSize: '10px', fontWeight: 700,
            letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.34)',
            transition: 'all 120ms ease',
          }}
            onMouseEnter={e => { e.currentTarget.style.color='rgba(255,255,255,0.72)'; e.currentTarget.style.borderColor='rgba(255,255,255,0.18)'; }}
            onMouseLeave={e => { e.currentTarget.style.color='rgba(255,255,255,0.34)'; e.currentTarget.style.borderColor='rgba(255,255,255,0.07)'; }}
          >Friends</button>
        </div>
      ) : (
        <button onClick={() => navigate(backTo)} style={{
          marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8,
          background: 'none', border: 'none', cursor: 'pointer', padding: 0,
          fontFamily: T.label, fontSize: '10px', fontWeight: 700,
          letterSpacing: '0.18em', textTransform: 'uppercase',
          color: 'rgba(255,255,255,0.32)', transition: 'color 120ms',
        }}
          onMouseEnter={e => e.currentTarget.style.color='rgba(255,255,255,0.7)'}
          onMouseLeave={e => e.currentTarget.style.color='rgba(255,255,255,0.32)'}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7.5 2L3 6l4.5 4" />
          </svg>
          {backLabel}
        </button>
      )}
    </nav>
  );
}

/* ── SplitScreen ─────────────────────────────────────────── */
function SplitScreen({ left, right, leftWidth = '42%' }) {
  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
      <div style={{ width: leftWidth, flexShrink: 0, position: 'relative', overflow: 'hidden' }}>{left}</div>
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', borderLeft: '1px solid rgba(255,255,255,0.05)', scrollbarWidth: 'none' }}>{right}</div>
    </div>
  );
}

/* ── HeroPane ────────────────────────────────────────────── */
function HeroPane({ title, eyebrow, accent, decorChar, children }) {
  const rgb = hexToRgb2(accent);
  return (
    <div style={{
      height: '100%', position: 'relative', overflow: 'hidden',
      background: T.bg1,
      display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
      padding: '0 clamp(28px,4vw,52px) clamp(36px,5vh,64px)',
    }}>
      {/* Color atmosphere - bottom left */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0,
        width: '90%', height: '65%', pointerEvents: 'none',
        background: `radial-gradient(ellipse 80% 70% at 0% 100%, rgba(${rgb},0.26) 0%, transparent 70%)`,
      }} />
      {/* Top right fade */}
      <div style={{
        position: 'absolute', top: 0, right: 0,
        width: '60%', height: '40%', pointerEvents: 'none',
        background: `radial-gradient(ellipse 80% 80% at 100% 0%, rgba(${rgb},0.06) 0%, transparent 70%)`,
      }} />
      {/* Decorative character */}
      {decorChar && (
        <div style={{
          position: 'absolute', top: -30, right: -20, userSelect: 'none', pointerEvents: 'none',
          fontFamily: T.hero, fontSize: 'clamp(180px,18vw,260px)', fontWeight: 900, lineHeight: 1,
          color: `rgba(${rgb},0.04)`,
        }}>{decorChar}</div>
      )}
      {/* Horizontal accent line */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, height: 2,
        background: `linear-gradient(90deg, ${accent}, rgba(${rgb},0.2) 60%, transparent)`,
      }} />
      {/* Content */}
      <div style={{ position: 'relative', zIndex: 1 }}>
        {eyebrow && (
          <div style={{
            fontFamily: T.label, fontSize: '10px', fontWeight: 700,
            letterSpacing: '0.22em', textTransform: 'uppercase',
            color: accent, opacity: 0.85, marginBottom: 16,
          }}>{eyebrow}</div>
        )}
        <div style={{
          fontFamily: T.hero, fontWeight: 900,
          fontSize: 'clamp(52px,6vw,88px)', lineHeight: 0.9,
          letterSpacing: '-0.025em', color: '#fff',
          whiteSpace: 'pre-line',
          textShadow: `0 0 80px rgba(${rgb},0.25)`,
          marginBottom: children ? 24 : 0,
        }}>{title}</div>
        {children}
      </div>
    </div>
  );
}

/* ── ControlPane ─────────────────────────────────────────── */
function ControlPane({ children, accent }) {
  const rgb = hexToRgb2(accent);
  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      padding: 'clamp(28px,4vh,52px) clamp(28px,4vw,52px)',
      background: T.bg2, position: 'relative', overflow: 'hidden',
    }}>
      {/* Subtle top accent line */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: `rgba(${rgb},0.18)` }} />
      {children}
    </div>
  );
}

/* ── SmallLabel ──────────────────────────────────────────── */
function SmallLabel({ children, color, mb = 10 }) {
  return (
    <div style={{
      fontFamily: T.label, fontSize: '10px', fontWeight: 700,
      letterSpacing: '0.20em', textTransform: 'uppercase',
      color: color || 'rgba(255,255,255,0.28)', marginBottom: mb,
    }}>{children}</div>
  );
}

/* ── PrimaryBtn ──────────────────────────────────────────── */
function PrimaryBtn({ label, sub, accent, onClick }) {
  const [hov, setHov] = useStateS(false);
  const rgb = hexToRgb2(accent);
  return (
    <button onClick={onClick}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        width: '100%', padding: '17px 24px', border: 'none', cursor: 'pointer',
        background: accent, filter: hov ? 'brightness(1.12)' : 'brightness(1)',
        fontFamily: T.display, fontSize: '17px', fontWeight: 800,
        letterSpacing: '0.10em', textTransform: 'uppercase', color: '#01010a',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        transition: 'filter 120ms ease, box-shadow 120ms ease',
        boxShadow: hov ? `0 8px 36px rgba(${rgb},0.45)` : `0 4px 18px rgba(${rgb},0.22)`,
      }}
    >
      <span>{label}</span>
      {sub && <span style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.04em', opacity: 0.6 }}>{sub}</span>}
    </button>
  );
}

/* ── NavRow ──────────────────────────────────────────────── */
function NavRow({ label, sub, onClick }) {
  const [hov, setHov] = useStateS(false);
  return (
    <div onClick={onClick}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        padding: '13px 0', cursor: 'pointer', display: 'flex',
        alignItems: 'center', justifyContent: 'space-between',
        borderBottom: `1px solid rgba(255,255,255,${hov ? 0.08 : 0.04})`,
        transition: 'all 120ms ease',
        transform: hov ? 'translateX(4px)' : 'none',
      }}>
      <div>
        <div style={{
          fontFamily: T.display, fontSize: '14px', fontWeight: 700,
          letterSpacing: '0.08em', textTransform: 'uppercase',
          color: hov ? 'rgba(255,255,255,0.82)' : 'rgba(255,255,255,0.48)',
          transition: 'color 120ms',
        }}>{label}</div>
        {sub && <div style={{ fontFamily: T.body, fontSize: '11px', color: 'rgba(255,255,255,0.26)', marginTop: 2 }}>{sub}</div>}
      </div>
      <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke={hov?'rgba(255,255,255,0.5)':'rgba(255,255,255,0.15)'} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ transition: 'stroke 120ms', flexShrink: 0 }}>
        <path d="M3.5 6.5h6M6.5 3.5l3 3-3 3" />
      </svg>
    </div>
  );
}

/* ── SelectRow ───────────────────────────────────────────── */
function SelectRow({ label, value, desc, active, accent, onClick }) {
  const rgb = hexToRgb2(accent);
  return (
    <div onClick={onClick} style={{
      padding: '12px 16px', cursor: 'pointer', position: 'relative',
      borderBottom: `1px solid rgba(255,255,255,${active ? 0.08 : 0.04})`,
      background: active ? `rgba(${rgb},0.08)` : 'transparent',
      transition: 'all 120ms ease', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      borderLeft: active ? `3px solid ${accent}` : '3px solid transparent',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: active ? accent : 'rgba(255,255,255,0.2)', flexShrink: 0, boxShadow: active ? `0 0 8px ${accent}` : 'none', transition: 'all 150ms ease' }} />
        <div>
          <div style={{ fontFamily: T.display, fontSize: '14px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: active ? '#fff' : 'rgba(255,255,255,0.55)', transition: 'color 120ms' }}>{label}</div>
          {desc && <div style={{ fontFamily: T.body, fontSize: '11px', color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>{desc}</div>}
        </div>
      </div>
      {value !== undefined && (
        <div style={{ fontFamily: T.hero, fontSize: '26px', fontWeight: 900, color: active ? accent : 'rgba(255,255,255,0.22)', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em', transition: 'color 150ms', flexShrink: 0 }}>{value}</div>
      )}
    </div>
  );
}

/* ── Seg2 (segmented toggle) ─────────────────────────────── */
function Seg2({ options, value, onChange, accent }) {
  const rgb = hexToRgb2(accent);
  return (
    <div style={{ display: 'flex', gap: 0, border: `1px solid rgba(255,255,255,0.08)` }}>
      {options.map((o, i) => {
        const active = value === o.value;
        return (
          <button key={o.value} onClick={() => onChange(o.value)} style={{
            flex: 1, padding: '10px', border: 'none', cursor: 'pointer',
            background: active ? accent : 'transparent',
            fontFamily: T.display, fontSize: '13px', fontWeight: 700,
            letterSpacing: '0.10em', textTransform: 'uppercase',
            color: active ? '#01010a' : 'rgba(255,255,255,0.38)',
            borderRight: i < options.length - 1 ? '1px solid rgba(255,255,255,0.08)' : 'none',
            transition: 'all 130ms ease',
          }}>{o.label}</button>
        );
      })}
    </div>
  );
}

Object.assign(window, { T, MODE_COLORS, Nav2, SplitScreen, HeroPane, ControlPane, SmallLabel, PrimaryBtn, NavRow, SelectRow, Seg2, hexToRgb2 });
