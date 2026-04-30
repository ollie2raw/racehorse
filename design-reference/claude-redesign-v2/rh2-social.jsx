// rh2-social.jsx — Friends Page + My Stats Page v2
const { useState: useStateSo } = React;

/* ── Friends Page ────────────────────────────────────────── */
const FRIENDS2 = [
  { handle: '@nonniee',   rating: 1640, online: true,  wins: 22 },
  { handle: '@hafnerjan', rating: 1512, online: false, wins: 18 },
  { handle: '@ollie2',    rating: 1389, online: true,  wins: 9  },
];

function FriendRow({ f }) {
  const [hov, setHov] = useStateSo(false);
  return (
    <div
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 0', borderBottom: '1px solid rgba(255,255,255,0.05)',
        transition: 'background 120ms',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
          background: f.online ? '#00e676' : 'rgba(255,255,255,0.18)',
          boxShadow: f.online ? '0 0 8px #00e67688' : 'none',
        }} />
        <div>
          <div style={{ fontFamily: T.display, fontSize: '15px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: hov ? '#fff' : 'rgba(255,255,255,0.78)', transition: 'color 120ms' }}>{f.handle}</div>
          <div style={{ fontFamily: T.body, fontSize: '11px', color: 'rgba(255,255,255,0.30)', marginTop: 2 }}>{f.rating} rating · {f.wins} wins</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {[
          { label: 'Invite', accent: '#3d8eff' },
          { label: 'Stats',  accent: null },
          { label: 'Remove', accent: '#ff4040' },
        ].map(btn => {
          const rgb = btn.accent ? hexToRgb2(btn.accent) : null;
          return (
            <button key={btn.label} style={{
              padding: '5px 12px', cursor: 'pointer',
              background: rgb ? `rgba(${rgb},0.09)` : 'rgba(255,255,255,0.04)',
              border: `1px solid ${rgb ? `rgba(${rgb},0.26)` : 'rgba(255,255,255,0.08)'}`,
              fontFamily: T.label, fontSize: '9px', fontWeight: 700,
              letterSpacing: '0.14em', color: btn.accent || 'rgba(255,255,255,0.45)',
              transition: 'all 120ms ease',
            }}
              onMouseEnter={e => { e.currentTarget.style.filter = 'brightness(1.2)'; }}
              onMouseLeave={e => { e.currentTarget.style.filter = 'none'; }}
            >{btn.label}</button>
          );
        })}
      </div>
    </div>
  );
}

function FriendsPage({ navigate }) {
  const [query, setQuery] = useStateSo('');
  const online = FRIENDS2.filter(f => f.online).length;

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: T.bg0, overflow: 'hidden' }}>
      <Nav2 navigate={navigate} variant="back" backLabel="Back to Home" backTo="home" />
      <SplitScreen
        leftWidth="38%"
        left={
          <div style={{ height: '100%', position: 'relative', background: T.bg1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: '0 48px 52px', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: '55%', pointerEvents: 'none', background: 'radial-gradient(ellipse 80% 70% at 0% 100%, rgba(61,142,255,0.20) 0%, transparent 70%)' }} />
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, #3d8eff, rgba(61,142,255,0.2), transparent)' }} />
            <div style={{ position: 'absolute', top: -10, right: -10, fontFamily: T.hero, fontSize: '220px', fontWeight: 900, color: 'rgba(61,142,255,0.04)', lineHeight: 1, userSelect: 'none' }}>F</div>
            <div style={{ position: 'relative', zIndex: 1 }}>
              <div style={{ fontFamily: T.label, fontSize: '10px', fontWeight: 700, letterSpacing: '0.22em', color: '#3d8eff', opacity: 0.8, marginBottom: 14 }}>SOCIAL</div>
              <div style={{ fontFamily: T.hero, fontSize: 'clamp(56px,7vw,88px)', fontWeight: 900, letterSpacing: '-0.03em', color: '#fff', lineHeight: 0.9, marginBottom: 20 }}>FRIENDS</div>
              {/* Online stat */}
              <div style={{ display: 'flex', gap: 20 }}>
                <div>
                  <div style={{ fontFamily: T.hero, fontSize: '36px', fontWeight: 900, color: '#00e676', letterSpacing: '-0.02em', lineHeight: 1 }}>{online}</div>
                  <div style={{ fontFamily: T.label, fontSize: '9px', fontWeight: 700, letterSpacing: '0.18em', color: 'rgba(255,255,255,0.30)', marginTop: 4 }}>ONLINE</div>
                </div>
                <div>
                  <div style={{ fontFamily: T.hero, fontSize: '36px', fontWeight: 900, color: 'rgba(255,255,255,0.55)', letterSpacing: '-0.02em', lineHeight: 1 }}>{FRIENDS2.length}</div>
                  <div style={{ fontFamily: T.label, fontSize: '9px', fontWeight: 700, letterSpacing: '0.18em', color: 'rgba(255,255,255,0.30)', marginTop: 4 }}>FRIENDS</div>
                </div>
              </div>
            </div>
          </div>
        }
        right={
          <ControlPane accent="#3d8eff">
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              {/* Add friend */}
              <SmallLabel mb={12}>Add Friend</SmallLabel>
              <div style={{ display: 'flex', gap: 0, marginBottom: 28 }}>
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="USERNAME"
                  style={{
                    flex: 1, height: 42, padding: '0 16px', outline: 'none',
                    background: 'rgba(255,255,255,0.04)',
                    border: `1px solid rgba(255,255,255,${query ? 0.16 : 0.07})`,
                    borderRight: 'none',
                    fontFamily: T.display, fontSize: '14px', fontWeight: 600,
                    letterSpacing: '0.12em', color: '#fff', transition: 'border-color 120ms',
                  }}
                  onFocus={e => e.target.style.borderColor='rgba(61,142,255,0.5)'}
                  onBlur={e => e.target.style.borderColor=query?'rgba(255,255,255,0.16)':'rgba(255,255,255,0.07)'}
                />
                <button style={{ padding: '0 20px', height: 42, border: 'none', cursor: 'pointer', background: '#3d8eff', fontFamily: T.display, fontSize: '12px', fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#01010a' }}>Add</button>
              </div>

              {/* Friends list */}
              <SmallLabel mb={0}>Your Friends</SmallLabel>
              <div style={{ flex: 1 }}>
                {FRIENDS2.map(f => <FriendRow key={f.handle} f={f} />)}
              </div>
            </div>
          </ControlPane>
        }
      />
    </div>
  );
}

/* ── My Stats Page ───────────────────────────────────────── */
const FRITZ_S2 = [
  { label: 'Win Rate',        value: '37.1%' },
  { label: 'Record',          value: '33–56' },
  { label: 'Current Streak',  value: '1' },
  { label: 'Best Streak',     value: '5' },
  { label: 'Avg Score',       value: '44.6' },
  { label: 'Best Score',      value: '96' },
];
const TIERS_S = [
  { label: 'Rookie',   record: '1–4',   games: 5,  color: '#00e676' },
  { label: 'Standard', record: '0–0',   games: 0,  color: '#3d8eff' },
  { label: 'Elite',    record: '10–9',  games: 19, color: '#ff4040' },
  { label: 'Master',   record: '22–43', games: 65, color: '#f0c040' },
];

function StatCard2({ label, value, accent }) {
  const rgb = accent ? hexToRgb2(accent) : null;
  return (
    <div style={{ padding: '14px 16px', background: T.bg3, borderTop: `2px solid ${accent || 'rgba(255,255,255,0.08)'}` }}>
      <div style={{ fontFamily: T.label, fontSize: '9px', fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.28)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: T.hero, fontSize: '28px', fontWeight: 900, color: accent || 'rgba(255,255,255,0.88)', letterSpacing: '-0.02em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

function MyStatsPage({ navigate }) {
  const RATING = 1821, PEAK = 1913, GAMES = 88;

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: T.bg0, overflow: 'hidden' }}>
      <Nav2 navigate={navigate} variant="back" backLabel="Back to Home" backTo="home" />

      {/* Hero rating strip */}
      <div style={{ flexShrink: 0, background: T.bg1, borderBottom: '1px solid rgba(255,255,255,0.06)', padding: '20px clamp(24px,4vw,60px)', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', bottom: 0, left: 0, width: '60%', height: '100%', background: 'radial-gradient(ellipse 80% 100% at 0% 100%, rgba(0,240,200,0.12) 0%, transparent 70%)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, #00f0c8, rgba(0,240,200,0.1), transparent)' }} />
        <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20 }}>
          <div>
            <div style={{ fontFamily: T.label, fontSize: '10px', fontWeight: 700, letterSpacing: '0.22em', color: '#00f0c8', marginBottom: 8 }}>@OLIVER / RANKED RATING</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
              <div style={{ fontFamily: T.hero, fontSize: 'clamp(52px,7vw,80px)', fontWeight: 900, color: '#fff', letterSpacing: '-0.04em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{RATING.toLocaleString()}</div>
              <div style={{ fontFamily: T.display, fontSize: '14px', fontWeight: 700, letterSpacing: '0.10em', color: '#00f0c8', textTransform: 'uppercase', marginBottom: 8 }}>#2 Globally</div>
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
              <span style={{ fontFamily: T.body, fontSize: '12px', color: 'rgba(255,255,255,0.35)' }}>Peak: {PEAK.toLocaleString()}</span>
              <span style={{ fontFamily: T.body, fontSize: '12px', color: 'rgba(255,255,255,0.35)' }}>{GAMES} ranked games</span>
            </div>
          </div>
          {/* Rating bar */}
          <div style={{ flex: 1, maxWidth: 320 }}>
            <div style={{ height: 3, background: 'rgba(255,255,255,0.07)', marginBottom: 6 }}>
              <div style={{ width: `${(RATING/2400)*100}%`, height: '100%', background: 'linear-gradient(90deg,#34d399,#00f0c8)', boxShadow: '0 0 12px #00f0c866' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontFamily: T.label, fontSize: '9px', fontWeight: 700, letterSpacing: '0.14em', color: 'rgba(255,255,255,0.22)' }}>0</span>
              <span style={{ fontFamily: T.label, fontSize: '9px', fontWeight: 700, letterSpacing: '0.14em', color: 'rgba(255,255,255,0.22)' }}>2400</span>
            </div>
          </div>
        </div>
      </div>

      {/* Sections — scrollable */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.1) transparent', padding: 'clamp(20px,3vh,36px) clamp(24px,4vw,60px)' }}>

        {/* Fritz / Ranked */}
        <div style={{ marginBottom: 32 }}>
          <SmallLabel mb={16} color="#3d8eff">Fritz / Ranked</SmallLabel>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 6, marginBottom: 6 }}>
            {FRITZ_S2.map((s,i) => <StatCard2 key={s.label} label={s.label} value={s.value} accent={i===0?'#3d8eff':null} />)}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6 }}>
            {TIERS_S.map(t => (
              <div key={t.label} style={{ padding: '12px 14px', background: T.bg3, borderTop: `2px solid ${t.color}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: t.color }} />
                  <span style={{ fontFamily: T.label, fontSize: '9px', fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)' }}>{t.label}</span>
                </div>
                <div style={{ fontFamily: T.hero, fontSize: '24px', fontWeight: 900, color: '#fff', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>{t.record}</div>
                <div style={{ fontFamily: T.body, fontSize: '11px', color: 'rgba(255,255,255,0.28)', marginTop: 3 }}>{t.games} games</div>
              </div>
            ))}
          </div>
        </div>

        {/* Ghost + Puzzle */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          <div>
            <SmallLabel mb={16} color="#c040ff">Ghost Mode</SmallLabel>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {[{label:'Ghost Rating',value:'1,018'},{label:'Ghost Games',value:'91'},{label:'Win Rate',value:'58.2%'},{label:'Best Win',value:'60'}].map(s=><StatCard2 key={s.label} {...s} accent={s.label==='Ghost Rating'?'#c040ff':null}/>)}
            </div>
          </div>
          <div>
            <SmallLabel mb={16} color="#ffb800">Daily Puzzle</SmallLabel>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {[{label:'Puzzle Streak',value:'0'},{label:'Completions',value:'0'},{label:'Best Score',value:'40'},{label:'Perfect Days',value:'0'}].map(s=><StatCard2 key={s.label} {...s} accent={s.label==='Puzzle Streak'?'#ffb800':null}/>)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { FriendsPage, MyStatsPage });
