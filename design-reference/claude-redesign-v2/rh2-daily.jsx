// rh2-daily.jsx — Daily Puzzle + Daily Fritz screens v2
const { useState: useStateD } = React;

const TODAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date());

/* ── Shared: info stat row ───────────────────────────────── */
function StatLine({ label, value, accent, big }) {
  return (
    <div style={{
      display: 'flex', alignItems: big ? 'flex-end' : 'center',
      justifyContent: 'space-between', padding: '11px 0',
      borderBottom: '1px solid rgba(255,255,255,0.05)',
    }}>
      <span style={{ fontFamily: T.label, fontSize: '10px', fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.28)' }}>{label}</span>
      <span style={{
        fontFamily: big ? T.hero : T.display, fontWeight: big ? 900 : 700,
        fontSize: big ? '28px' : '15px', letterSpacing: big ? '-0.02em' : '0.06em',
        color: accent || 'rgba(255,255,255,0.82)', textTransform: big ? 'none' : 'uppercase',
        fontVariantNumeric: 'tabular-nums',
      }}>{value}</span>
    </div>
  );
}

/* ── Result badge ────────────────────────────────────────── */
function ResultBadge({ result }) {
  const win = result === 'W' || result === 'WIN';
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      padding: '4px 14px',
      background: win ? 'rgba(0,230,118,0.12)' : 'rgba(255,64,64,0.12)',
      border: `1px solid ${win ? 'rgba(0,230,118,0.35)' : 'rgba(255,64,64,0.35)'}`,
      fontFamily: T.label, fontSize: '10px', fontWeight: 700,
      letterSpacing: '0.18em', color: win ? '#00e676' : '#ff4040',
    }}>{win ? 'WIN' : 'LOSS'}</div>
  );
}

/* ── Mini domino (CSS) ───────────────────────────────────── */
function MiniDomino({ h, l }) {
  return (
    <div style={{ width: 32, height: 58, background: 'linear-gradient(145deg,#fff,#f8f8f8)', border: '1.5px solid #7a6a56', borderRadius: 7, boxShadow: '0 6px 16px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.9)', display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0 }}>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: '12px', fontWeight: 900, color: '#1a1a1a', fontFamily: T.hero }}>{h}</span>
      </div>
      <div style={{ height: 1, background: 'rgba(30,20,10,0.18)', margin: '0 5px' }} />
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: '12px', fontWeight: 900, color: '#1a1a1a', fontFamily: T.hero }}>{l}</span>
      </div>
    </div>
  );
}

/* ── Daily Puzzle Setup ───────────────────────────────────── */
function DailyPuzzleSetup({ navigate }) {
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: T.bg0, overflow: 'hidden' }}>
      <Nav2 navigate={navigate} variant="back" backLabel="Back to Home" backTo="home" />
      <SplitScreen
        left={
          <HeroPane title={'DAILY\nPUZZLE'} eyebrow="Today's Challenge" accent="#ffb800" decorChar="P">
            {/* Domino display */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              {[[6,4],[4,3],[3,5],[5,2],[2,6]].map(([h,l],i) => (
                <div key={i} style={{ transform: `translateY(${i%2===1?-6:0}px)`, transition: 'transform 300ms ease' }}>
                  <MiniDomino h={h} l={l} />
                </div>
              ))}
            </div>
          </HeroPane>
        }
        right={
          <ControlPane accent="#ffb800">
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <SmallLabel mb={6}>Today's Board</SmallLabel>
              <div style={{ fontFamily: T.hero, fontSize: '42px', fontWeight: 900, color: '#fff', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: 24 }}>Score as many points as you can.</div>

              {/* Stats */}
              <div style={{ marginBottom: 28 }}>
                <StatLine label="Date"   value={TODAY} />
                <StatLine label="Mode"   value="Daily" />
                <StatLine label="Format" value="One-turn high score" />
                <StatLine label="Streak" value="3 days 🔥" accent="#ffb800" />
              </div>

              {/* Streak bar */}
              <div style={{ marginBottom: 32 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <SmallLabel mb={0}>Streak Progress</SmallLabel>
                  <span style={{ fontFamily: T.label, fontSize: '9px', fontWeight: 700, letterSpacing: '0.14em', color: 'rgba(255,255,255,0.28)' }}>3 / 7</span>
                </div>
                <div style={{ height: 3, background: 'rgba(255,255,255,0.07)' }}>
                  <div style={{ width: '43%', height: '100%', background: '#ffb800', boxShadow: '0 0 10px #ffb80066' }} />
                </div>
              </div>

              <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
                <PrimaryBtn label="Start Daily Puzzle" sub="Play today's one-turn puzzle" accent="#ffb800" onClick={() => {}} />
                <NavRow label="Leaderboard" sub="See today's top scores" onClick={() => navigate('leaderboard-puzzle')} />
                <NavRow label="Back to Home" sub="Return to game mode menu" onClick={() => navigate('home')} />
              </div>
            </div>
          </ControlPane>
        }
      />
    </div>
  );
}

/* ── Daily Fritz Setup ───────────────────────────────────── */
function DailyFritzSetup({ navigate }) {
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: T.bg0, overflow: 'hidden' }}>
      <Nav2 navigate={navigate} variant="back" backLabel="Back to Home" backTo="home" />
      <SplitScreen
        left={
          <HeroPane title={'DAILY\nFRITZ'} eyebrow="Today's Challenge" accent="#00f0c8" decorChar="F">
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <div style={{ padding: '6px 14px', background: 'rgba(255,64,64,0.14)', border: '1px solid rgba(255,64,64,0.35)', fontFamily: T.display, fontSize: '13px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#ff4040' }}>Elite 1800</div>
              <div style={{ fontFamily: T.body, fontSize: '12px', color: 'rgba(255,255,255,0.35)' }}>7-tile format</div>
            </div>
          </HeroPane>
        }
        right={
          <ControlPane accent="#00f0c8">
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <SmallLabel mb={6}>Same deal for everyone.</SmallLabel>
              <div style={{ fontFamily: T.hero, fontSize: '38px', fontWeight: 900, color: '#fff', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: 24 }}>One run only.</div>

              <div style={{ marginBottom: 28 }}>
                <StatLine label="Date"     value={TODAY} />
                <StatLine label="Tier"     value="Elite (1800)" accent="#ff4040" />
                <StatLine label="Mode"     value="7-tile" />
                <StatLine label="Streak"   value="3 days 🔥" accent="#00f0c8" />
              </div>

              {/* Match details */}
              <div style={{ padding: '16px', background: 'rgba(0,240,200,0.05)', border: '1px solid rgba(0,240,200,0.12)', marginBottom: 28 }}>
                <SmallLabel mb={10} color="#00f0c8">Match Details</SmallLabel>
                {[
                  { label: 'Opponent',  value: 'Fritz Elite (1800)' },
                  { label: 'Scoring',   value: 'Diff + speed bonus' },
                  { label: 'Players',   value: '3 completed today' },
                ].map(item => (
                  <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 8, marginBottom: 8, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <span style={{ fontFamily: T.body, fontSize: '12px', color: 'rgba(255,255,255,0.36)' }}>{item.label}</span>
                    <span style={{ fontFamily: T.display, fontSize: '13px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.72)' }}>{item.value}</span>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
                <PrimaryBtn label="Start Daily Fritz" sub="Begin today's match" accent="#00f0c8" onClick={() => navigate('daily-fritz-result')} />
                <NavRow label="Leaderboard" sub="See today's standings" onClick={() => navigate('leaderboard-fritz')} />
                <NavRow label="Back to Home" onClick={() => navigate('home')} />
              </div>
            </div>
          </ControlPane>
        }
      />
    </div>
  );
}

/* ── Daily Fritz Result ──────────────────────────────────── */
function DailyFritzResult({ navigate }) {
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: T.bg0, overflow: 'hidden' }}>
      <Nav2 navigate={navigate} variant="back" backLabel="Back to Home" backTo="home" />
      <SplitScreen
        left={
          <HeroPane title={'TODAY\'S\nRESULT'} eyebrow="Daily Fritz" accent="#00f0c8" decorChar="R">
            {/* Large result */}
            <div>
              <div style={{ fontFamily: T.hero, fontSize: '72px', fontWeight: 900, color: '#ff4040', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: 8 }}>LOSS</div>
              <div style={{ fontFamily: T.display, fontSize: '22px', fontWeight: 700, letterSpacing: '0.06em', color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase' }}>66 – 67</div>
            </div>
          </HeroPane>
        }
        right={
          <ControlPane accent="#00f0c8">
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <SmallLabel mb={6}>Match Summary</SmallLabel>
              <div style={{ fontFamily: T.hero, fontSize: '38px', fontWeight: 900, color: '#fff', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: 24 }}>Daily Fritz · {TODAY}</div>

              {/* Match stats */}
              <div style={{ marginBottom: 28 }}>
                <StatLine label="Tier"        value="Elite (1800)"  accent="#ff4040" />
                <StatLine label="Mode"        value="7-tile" />
                <StatLine label="Score"       value="66 – 67"  accent="#fff" big />
                <StatLine label="Point Diff"  value="−1"  accent="#ff4040" />
                <StatLine label="Rank"        value="#2"  accent="#00f0c8" />
                <StatLine label="Streak"      value="3 days 🔥"  accent="#00f0c8" />
              </div>

              {/* Rank context */}
              <div style={{ padding: '14px 16px', background: 'rgba(0,240,200,0.05)', border: '1px solid rgba(0,240,200,0.14)', marginBottom: 28 }}>
                <div style={{ fontFamily: T.display, fontSize: '13px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#00f0c8', marginBottom: 4 }}>#2 of 3 players today</div>
                <div style={{ fontFamily: T.body, fontSize: '12px', color: 'rgba(255,255,255,0.35)', lineHeight: 1.4 }}>You lost by 1 point. Check the leaderboard to see where you stand.</div>
              </div>

              <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
                <PrimaryBtn label="View Leaderboard" sub="See today's standings" accent="#00f0c8" onClick={() => navigate('leaderboard-fritz')} />
                <NavRow label="Back to Home" onClick={() => navigate('home')} />
              </div>
            </div>
          </ControlPane>
        }
      />
    </div>
  );
}

Object.assign(window, { DailyPuzzleSetup, DailyFritzSetup, DailyFritzResult });
