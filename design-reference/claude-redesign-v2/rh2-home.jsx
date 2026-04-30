// rh2-home.jsx — Home Screen v2 (full-viewport accordion)
const { useState: useStateH } = React;

const MODES2 = [
  { id: 'multiplayer',    short: 'MULTI',   label: 'Multiplayer\nOnline',    desc: 'Create a private room and play head to head in real time',          color: '#3d8eff', screen: 'multiplayer',        live: true },
  { id: 'daily-fritz',   short: 'FRITZ',   label: 'Daily Fritz\nMatch',     desc: 'One fixed live Fritz match per day. Same deals for everyone.',       color: '#00f0c8', screen: 'daily-fritz-setup' },
  { id: 'daily-puzzle',  short: 'PUZZLE',  label: 'Daily\nPuzzle',          desc: "Solve today's featured scenario and compare leaderboard results",    color: '#ffb800', screen: 'daily-puzzle-setup' },
  { id: 'single',        short: 'SOLO',    label: 'Single\nPlayer',         desc: 'Play vs Fritz, Ghost Mode, Your League & No Brainer Lab',           color: '#3d8eff', screen: 'single-player' },
  { id: 'tournament',    short: 'TOURN',   label: 'Tournament\nMode',       desc: 'Round robin (4+ players), matches to 30, play everyone once',        color: '#f0c040', screen: 'tournament' },
  { id: 'learn',         short: 'LEARN',   label: 'Learn\nAcademy',         desc: 'New to dominoes? Learn how to play and win.',                        color: '#00e676', screen: null },
];

function HomePanel({ mode, index, isActive, hasActive, navigate }) {
  const rgb = hexToRgb2(mode.color);

  return (
    <div
      onMouseEnter={() => {}}
      onMouseLeave={() => {}}
      onClick={() => mode.screen && navigate(mode.screen)}
      style={{
        flex: isActive ? 4.2 : hasActive ? 0.62 : 1,
        transition: 'flex 380ms cubic-bezier(0.22,1,0.36,1)',
        position: 'relative', overflow: 'hidden',
        cursor: mode.screen ? 'pointer' : 'default',
        borderRight: index < MODES2.length - 1 ? `1px solid rgba(${rgb},0.07)` : 'none',
        background: T.bg0,
      }}
    >
      {/* Bottom colored atmosphere */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, height: '55%', pointerEvents: 'none',
        background: `radial-gradient(ellipse 100% 80% at 50% 100%, rgba(${rgb},${isActive ? 0.20 : 0.06}) 0%, transparent 70%)`,
        transition: 'background 300ms ease',
      }} />

      {/* Left edge glow when active */}
      {isActive && (
        <div style={{
          position: 'absolute', top: 0, left: 0, bottom: 0, width: 1,
          background: `linear-gradient(180deg, transparent, ${mode.color}, transparent)`,
          opacity: 0.6,
        }} />
      )}

      {/* Bottom color bar */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, height: 2,
        background: mode.color, opacity: isActive ? 1 : 0.2,
        transition: 'opacity 300ms ease',
      }} />

      {/* Huge decorative number */}
      <div style={{
        position: 'absolute', top: -10, right: -8, userSelect: 'none', pointerEvents: 'none',
        fontFamily: T.hero, fontSize: 'clamp(120px,13vw,200px)', fontWeight: 900, lineHeight: 1,
        color: `rgba(${rgb},${isActive ? 0.07 : 0.03})`,
        transition: 'color 300ms ease',
      }}>{index + 1}</div>

      {/* LIVE badge */}
      {mode.live && (
        <div style={{
          position: 'absolute', top: 18, right: 18, zIndex: 2,
          display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: '3px 9px', borderRadius: 2,
          background: `rgba(${hexToRgb2('#3d8eff')},0.15)`,
          border: `1px solid rgba(${hexToRgb2('#3d8eff')},0.38)`,
          fontFamily: T.label, fontSize: '9px', fontWeight: 700,
          letterSpacing: '0.22em', color: '#3d8eff',
          opacity: isActive || !hasActive ? 1 : 0,
          transition: 'opacity 200ms ease',
        }}>
          <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#3d8eff', animation: 'livePulse 1.8s ease-in-out infinite' }} />
          LIVE
        </div>
      )}

      {/* Expanded content — visible when active */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        padding: '0 clamp(20px,2.5vw,36px) clamp(28px,4vh,48px)',
        opacity: isActive ? 1 : 0,
        transform: isActive ? 'none' : 'translateY(14px)',
        transition: `opacity ${isActive ? 240 : 150}ms ease, transform ${isActive ? 280 : 150}ms ease`,
        pointerEvents: isActive ? 'all' : 'none',
        zIndex: 2,
      }}>
        {/* Mode index */}
        <div style={{
          fontFamily: T.label, fontSize: '9px', fontWeight: 700,
          letterSpacing: '0.26em', color: mode.color, opacity: 0.8,
          marginBottom: 12,
        }}>MODE {String(index + 1).padStart(2, '0')}</div>

        {/* Title */}
        <div style={{
          fontFamily: T.display, fontSize: 'clamp(30px,3.2vw,46px)', fontWeight: 800,
          letterSpacing: '0.03em', textTransform: 'uppercase', color: '#fff',
          lineHeight: 1.05, marginBottom: 14,
        }}>{mode.label.replace('\n', ' ')}</div>

        {/* Description */}
        <div style={{
          fontFamily: T.body, fontSize: '13px',
          color: 'rgba(255,255,255,0.48)', lineHeight: 1.55,
          marginBottom: 22, maxWidth: 260,
        }}>{mode.desc}</div>

        {/* CTA */}
        {mode.screen ? (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 10,
            padding: '9px 20px', background: mode.color,
            fontFamily: T.display, fontSize: '13px', fontWeight: 800,
            letterSpacing: '0.12em', textTransform: 'uppercase', color: '#01010a',
          }}>
            Enter
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#01010a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 6h8M6 2l4 4-4 4" />
            </svg>
          </div>
        ) : (
          <div style={{
            fontFamily: T.label, fontSize: '9px', fontWeight: 700,
            letterSpacing: '0.20em', color: 'rgba(255,255,255,0.2)',
          }}>COMING SOON</div>
        )}
      </div>

      {/* Collapsed label — vertical text */}
      <div style={{
        position: 'absolute', bottom: 28, left: 0, right: 0,
        display: 'flex', justifyContent: 'center', alignItems: 'center',
        opacity: isActive ? 0 : 1,
        transition: `opacity ${isActive ? 100 : 220}ms ease`,
        pointerEvents: 'none', zIndex: 2,
      }}>
        <div style={{
          fontFamily: T.display, fontSize: '11px', fontWeight: 700,
          letterSpacing: '0.26em', textTransform: 'uppercase',
          color: `rgba(${rgb},0.65)`,
          writingMode: 'vertical-rl', transform: 'rotate(180deg)',
          userSelect: 'none',
        }}>{mode.short}</div>
      </div>
    </div>
  );
}

function HomeScreen({ navigate }) {
  const [active, setActiveH] = useStateH(null);

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: T.bg0, overflow: 'hidden' }}>
      <style>{`
        @keyframes livePulse { 0%,100%{opacity:1} 50%{opacity:0.25} }
      `}</style>

      <Nav2 navigate={navigate} variant="home" />

      {/* Accordion */}
      <div
        style={{ flex: 1, display: 'flex', overflow: 'hidden' }}
        onMouseLeave={() => setActiveH(null)}
      >
        {MODES2.map((mode, i) => (
          <div
            key={mode.id}
            style={{ display: 'contents' }}
            onMouseEnter={() => setActiveH(mode.id)}
          >
            <HomePanel
              mode={mode}
              index={i}
              isActive={active === mode.id}
              hasActive={active !== null}
              navigate={navigate}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { HomeScreen });
