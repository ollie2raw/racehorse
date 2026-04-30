// rh2-ghost.jsx — Ghost Mode v2
const { useState: useStateG } = React;

const SCORES2 = [77, 74, 60, 61, 59];
const STYLE2 = [
  { label: 'Scoring Bias',    val: 0.72 },
  { label: 'Double Priority', val: 0.58 },
  { label: 'Board Control',   val: 0.88 },
  { label: 'Branching',       val: 0.30 },
];
const OPPS2 = [
  { id: 'you',       label: 'You',        sub: 'Your ghost · 94% trained', self: true },
  { id: 'oliver',    label: '@oliver',    sub: 'Trained ghost' },
  { id: 'nonniee',   label: 'nonniee',    sub: '71% trained' },
  { id: 'hafnerjan', label: 'hafnerjan',  sub: '68% trained' },
  { id: 'ollie2',    label: 'ollie2',     sub: '55% trained' },
];

function Sparkline2({ scores }) {
  const W = 180, H = 44;
  const mn = Math.min(...scores) - 4, mx = Math.max(...scores) + 4;
  const pts = scores.map((s, i) => `${(i / (scores.length-1)) * W},${H - ((s-mn)/(mx-mn))*H}`).join(' ');
  return (
    <svg width={W} height={H} style={{ overflow: 'visible', display: 'block' }}>
      <polyline points={pts} fill="none" stroke="#c040ff" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" opacity="0.75" />
      {scores.map((s,i) => <circle key={i} cx={(i/(scores.length-1))*W} cy={H-((s-mn)/(mx-mn))*H} r="2.5" fill="#c040ff" opacity="0.9" />)}
    </svg>
  );
}

function ConfRing2({ pct }) {
  const r=20, circ=2*Math.PI*r;
  return (
    <svg width={50} height={50} viewBox="0 0 50 50">
      <circle cx="25" cy="25" r={r} fill="none" stroke="rgba(192,64,255,0.12)" strokeWidth="3" />
      <circle cx="25" cy="25" r={r} fill="none" stroke="#c040ff" strokeWidth="3"
        strokeDasharray={circ} strokeDashoffset={circ*(1-pct/100)}
        strokeLinecap="round" transform="rotate(-90 25 25)" />
      <text x="25" y="30" textAnchor="middle" fill="rgba(255,255,255,0.85)" fontFamily="'Outfit',sans-serif" fontSize="11" fontWeight="900">{pct}%</text>
    </svg>
  );
}

function GhostMode({ navigate }) {
  const [opp, setOpp] = useStateG('you');
  const activeOpp = OPPS2.find(o => o.id === opp);

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: T.bg0, overflow: 'hidden' }}>
      <Nav2 navigate={navigate} variant="back" backLabel="Back to Single Player" backTo="single-player" />
      <SplitScreen
        leftWidth="48%"
        left={
          <HeroPane title={'GHOST\nMODE'} eyebrow="Single Player" accent="#c040ff" decorChar="G">
            {/* Style profile bars embedded in hero */}
            <div style={{ marginTop: 8 }}>
              {STYLE2.map(s => (
                <div key={s.label} style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontFamily: T.body, fontSize: '11px', color: 'rgba(255,255,255,0.40)' }}>{s.label}</span>
                    <span style={{ fontFamily: T.label, fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.28)' }}>{Math.round(s.val*100)}%</span>
                  </div>
                  <div style={{ height: 2, background: 'rgba(255,255,255,0.07)' }}>
                    <div style={{ width: `${s.val*100}%`, height: '100%', background: 'linear-gradient(90deg,#7c10cc,#c040ff)', transition: 'width 600ms ease' }} />
                  </div>
                </div>
              ))}
            </div>
          </HeroPane>
        }
        right={
          <ControlPane accent="#c040ff">
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 0, overflowY: 'auto', overflowX: 'hidden', scrollbarWidth: 'none' }}>

              {/* Ghost stats header */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, flexShrink: 0 }}>
                <div>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', background: 'rgba(192,64,255,0.10)', border: '1px solid rgba(192,64,255,0.28)', marginBottom: 12 }}>
                    <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#c040ff' }} />
                    <span style={{ fontFamily: T.label, fontSize: '9px', fontWeight: 700, letterSpacing: '0.16em', color: '#c040ff' }}>TRAINED GHOST — 94% CONFIDENCE</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <div style={{ fontFamily: T.hero, fontSize: '52px', fontWeight: 900, color: '#fff', lineHeight: 1, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }}>61.3</div>
                    <div style={{ fontFamily: T.label, fontSize: '11px', fontWeight: 700, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.35)', marginBottom: 4 }}>AVG PTS</div>
                  </div>
                </div>
                <ConfRing2 pct={84} />
              </div>

              {/* Last 5 scores */}
              <div style={{ marginBottom: 24, flexShrink: 0 }}>
                <SmallLabel mb={10}>Last 5 Scores</SmallLabel>
                <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                  {SCORES2.map((s,i) => (
                    <div key={i} style={{
                      padding: '4px 10px', fontFamily: T.label, fontSize: '11px', fontWeight: 700,
                      color: 'rgba(255,255,255,0.65)', fontVariantNumeric: 'tabular-nums',
                      border: '1px solid rgba(192,64,255,0.18)', letterSpacing: '0.04em',
                    }}>{s}</div>
                  ))}
                </div>
                <Sparkline2 scores={SCORES2} />
              </div>

              {/* How it works */}
              <div style={{ marginBottom: 24, flexShrink: 0 }}>
                <SmallLabel mb={12}>How It Works</SmallLabel>
                {[
                  { n: '01', title: 'Play Fritz matches', desc: 'Every match teaches your ghost your habits.' },
                  { n: '02', title: 'Unlock at 5 games', desc: 'Then you can play against your own ghost.' },
                  { n: '03', title: 'Gets sharper over time', desc: 'Around 30 games, it starts to feel much more like you.' },
                ].map(s => (
                  <div key={s.n} style={{ display: 'flex', gap: 14, paddingBottom: 12, borderBottom: '1px solid rgba(255,255,255,0.04)', marginBottom: 12 }}>
                    <div style={{ fontFamily: T.hero, fontSize: '18px', fontWeight: 900, color: 'rgba(192,64,255,0.30)', letterSpacing: '-0.02em', flexShrink: 0, lineHeight: 1.2 }}>{s.n}</div>
                    <div>
                      <div style={{ fontFamily: T.display, fontSize: '13px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.65)', marginBottom: 3 }}>{s.title}</div>
                      <div style={{ fontFamily: T.body, fontSize: '12px', color: 'rgba(255,255,255,0.30)', lineHeight: 1.4 }}>{s.desc}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Opponent selector */}
              <div style={{ marginBottom: 24, flexShrink: 0 }}>
                <SmallLabel mb={12}>Select Opponent</SmallLabel>
                {OPPS2.map(o => (
                  <SelectRow
                    key={o.id}
                    label={o.label}
                    desc={o.sub}
                    active={opp === o.id}
                    accent="#c040ff"
                    onClick={() => setOpp(o.id)}
                  />
                ))}
              </div>

              {/* CTA */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, flexShrink: 0, paddingBottom: 4 }}>
                <PrimaryBtn label="Play Ghost" sub={`vs ${activeOpp?.label}`} accent="#c040ff" onClick={() => {}} />
                <NavRow label="Back to Home" sub="Return to game mode menu" onClick={() => navigate('home')} />
              </div>
            </div>
          </ControlPane>
        }
      />
    </div>
  );
}

Object.assign(window, { GhostMode });
