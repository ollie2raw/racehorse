// rh2-single.jsx — Single Player Modes + Fritz Setup (v2)
const { useState: useStateR } = React;

/* ── Single Player Modes ─────────────────────────────────── */
const SP2 = [
  { id: 'fritz',     label: 'Play vs Fritz',   desc: 'Test yourself against the toughest opponent in the room',          color: '#3d8eff', screen: 'fritz-setup' },
  { id: 'ghost',     label: 'Ghost Mode',      desc: 'Play against a ghost trained on your own playstyle',              color: '#c040ff', screen: 'ghost-mode' },
  { id: 'league',    label: 'Your League',     desc: 'One match a day. Climb the table, survive promotion and relegation', color: '#00f0c8', screen: null },
  { id: 'nobrainer', label: 'No Brainer Lab',  desc: 'Practice one-turn clear runs with curated hands',                 color: '#3d8eff', screen: null },
];

function SPCard({ mode, navigate }) {
  const [hov, setHov] = useStateR(false);
  const rgb = hexToRgb2(mode.color);
  return (
    <div
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      onClick={() => mode.screen && navigate(mode.screen)}
      style={{
        padding: '22px 24px', cursor: mode.screen ? 'pointer' : 'default',
        background: hov && mode.screen ? `rgba(${rgb},0.07)` : 'transparent',
        borderLeft: `3px solid ${hov && mode.screen ? mode.color : `rgba(${rgb},0.22)`}`,
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        transition: 'all 150ms ease',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'relative', overflow: 'hidden',
      }}
    >
      {hov && mode.screen && (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: '40%', pointerEvents: 'none',
          background: `radial-gradient(ellipse 80% 100% at 100% 50%, rgba(${rgb},0.06) 0%, transparent 70%)` }} />
      )}
      <div style={{ position: 'relative', zIndex: 1 }}>
        <div style={{
          fontFamily: T.display, fontSize: '18px', fontWeight: 800,
          letterSpacing: '0.06em', textTransform: 'uppercase',
          color: hov && mode.screen ? '#fff' : 'rgba(255,255,255,0.72)',
          transition: 'color 150ms', marginBottom: 6,
        }}>{mode.label}</div>
        <div style={{ fontFamily: T.body, fontSize: '13px', color: 'rgba(255,255,255,0.38)', lineHeight: 1.5 }}>{mode.desc}</div>
        {!mode.screen && (
          <div style={{ marginTop: 8, fontFamily: T.label, fontSize: '9px', fontWeight: 700, letterSpacing: '0.18em', color: 'rgba(255,255,255,0.18)' }}>COMING SOON</div>
        )}
      </div>
      {mode.screen && (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={hov ? mode.color : 'rgba(255,255,255,0.2)'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ transition: 'stroke 150ms', flexShrink: 0, marginLeft: 16 }}>
          <path d="M3.5 7h7M7.5 3.5l3.5 3.5-3.5 3.5" />
        </svg>
      )}
    </div>
  );
}

function SinglePlayerModes({ navigate }) {
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: T.bg0, overflow: 'hidden' }}>
      <Nav2 navigate={navigate} variant="back" backLabel="Back to Home" backTo="home" />
      <SplitScreen
        left={
          <HeroPane title={'SINGLE\nPLAYER'} eyebrow="Choose your mode" accent="#3d8eff" decorChar="S">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {['Fritz', 'Ghost', 'League', 'Lab'].map(tag => (
                <div key={tag} style={{ padding: '4px 10px', border: '1px solid rgba(61,142,255,0.22)', fontFamily: T.label, fontSize: '9px', fontWeight: 700, letterSpacing: '0.14em', color: 'rgba(61,142,255,0.7)' }}>{tag}</div>
              ))}
            </div>
          </HeroPane>
        }
        right={
          <ControlPane accent="#3d8eff">
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <SmallLabel mb={18}>Select Mode</SmallLabel>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                {SP2.map(m => <SPCard key={m.id} mode={m} navigate={navigate} />)}
              </div>
              <div style={{ marginTop: 28 }}>
                <NavRow label="Back to Home" sub="Return to game mode menu" onClick={() => navigate('home')} />
              </div>
            </div>
          </ControlPane>
        }
      />
    </div>
  );
}

/* ── Fritz Setup ─────────────────────────────────────────── */
const TIERS2 = [
  { id: 'rookie',   label: 'Rookie',   rating: 600,  color: '#00e676', desc: 'Learning the game. Good for beginners.' },
  { id: 'standard', label: 'Standard', rating: 1000, color: '#3d8eff', desc: 'Solid fundamentals. A real challenge.' },
  { id: 'elite',    label: 'Elite',    rating: 1800, color: '#ff4040', desc: 'Maximum strength. Unforgiving. The original Fritz.' },
  { id: 'master',   label: 'Master',   rating: 2200, color: '#f0c040', desc: 'Sampled endgame search. No mercy.' },
];

function FritzSetup({ navigate }) {
  const [tier, setTier] = useStateR('elite');
  const [deal, setDeal] = useStateR(7);
  const activeTier = TIERS2.find(t => t.id === tier);

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: T.bg0, overflow: 'hidden' }}>
      <Nav2 navigate={navigate} variant="back" backLabel="Back to Single Player" backTo="single-player" />
      <SplitScreen
        left={
          <HeroPane title={'PLAY\nVS\nFRITZ'} eyebrow="Single Player" accent="#3d8eff" decorChar="F">
            {/* Current tier indicator on hero */}
            {activeTier && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: activeTier.color, boxShadow: `0 0 10px ${activeTier.color}` }} />
                <div style={{ fontFamily: T.display, fontSize: '14px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: activeTier.color }}>
                  {activeTier.label} — {activeTier.rating}
                </div>
              </div>
            )}
          </HeroPane>
        }
        right={
          <ControlPane accent="#3d8eff">
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 28 }}>

              {/* Difficulty */}
              <div>
                <SmallLabel mb={12}>Difficulty</SmallLabel>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {TIERS2.map(t => (
                    <SelectRow
                      key={t.id}
                      label={t.label}
                      value={t.rating}
                      desc={t.desc}
                      active={tier === t.id}
                      accent={t.color}
                      onClick={() => setTier(t.id)}
                    />
                  ))}
                </div>
              </div>

              {/* Deal size */}
              <div>
                <SmallLabel mb={12}>Deal Size</SmallLabel>
                <Seg2
                  value={deal}
                  onChange={setDeal}
                  accent="#3d8eff"
                  options={[{ label: '7 Tiles', value: 7 }, { label: '14 Tiles', value: 14 }]}
                />
              </div>

              {/* CTA */}
              <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
                <PrimaryBtn
                  label="Start Match"
                  sub={`${deal}-tile · Fritz ${activeTier?.label}`}
                  accent="#3d8eff"
                  onClick={() => {}}
                />
                <NavRow label="Back to Home" sub="Return to game mode menu" onClick={() => navigate('home')} />
              </div>
            </div>
          </ControlPane>
        }
      />
    </div>
  );
}

Object.assign(window, { SinglePlayerModes, FritzSetup });
