// rh2-multi.jsx — Multiplayer Setup, Lobby, Tournament v2
const { useState: useStateM } = React;

/* ── Multiplayer Setup ───────────────────────────────────── */
function MultiplayerSetup({ navigate }) {
  const [code, setCode] = useStateM('');

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: T.bg0, overflow: 'hidden' }}>
      <Nav2 navigate={navigate} variant="back" backLabel="Back to Home" backTo="home" />
      <SplitScreen
        left={
          <HeroPane title={'MULTI\nPLAYER'} eyebrow="Real-time Online" accent="#3d8eff" decorChar="M">
            {/* LIVE indicator */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#3d8eff', boxShadow: '0 0 10px #3d8eff', animation: 'livePulse2 1.8s ease-in-out infinite' }} />
              <span style={{ fontFamily: T.label, fontSize: '10px', fontWeight: 700, letterSpacing: '0.18em', color: '#3d8eff' }}>LIVE MATCHES AVAILABLE</span>
            </div>
          </HeroPane>
        }
        right={
          <ControlPane accent="#3d8eff">
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <SmallLabel mb={6}>Private Room</SmallLabel>
              <div style={{ fontFamily: T.hero, fontSize: '38px', fontWeight: 900, color: '#fff', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: 28 }}>Play head to head in real time.</div>

              {/* Create room */}
              <div style={{ marginBottom: 24 }}>
                <SmallLabel mb={12}>Create a Room</SmallLabel>
                <div
                  onClick={() => navigate('multiplayer-lobby')}
                  style={{
                    padding: '18px 20px', cursor: 'pointer',
                    background: 'rgba(61,142,255,0.08)', border: '1px solid rgba(61,142,255,0.22)',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    transition: 'all 140ms ease',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background='rgba(61,142,255,0.14)'; e.currentTarget.style.borderColor='rgba(61,142,255,0.40)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background='rgba(61,142,255,0.08)'; e.currentTarget.style.borderColor='rgba(61,142,255,0.22)'; }}
                >
                  <div>
                    <div style={{ fontFamily: T.display, fontSize: '15px', fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', color: '#fff', marginBottom: 3 }}>Create New Room</div>
                    <div style={{ fontFamily: T.body, fontSize: '12px', color: 'rgba(255,255,255,0.35)' }}>Start a room and share the code</div>
                  </div>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="rgba(61,142,255,0.7)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3.5 7h7M7.5 3.5l3.5 3.5-3.5 3.5" />
                  </svg>
                </div>
              </div>

              {/* Join with code */}
              <div style={{ marginBottom: 32 }}>
                <SmallLabel mb={12}>Join with Code</SmallLabel>
                <div style={{ display: 'flex', gap: 0 }}>
                  <input
                    value={code}
                    onChange={e => setCode(e.target.value.toUpperCase())}
                    placeholder="ENTER CODE"
                    maxLength={6}
                    style={{
                      flex: 1, height: 46, padding: '0 16px',
                      background: 'rgba(255,255,255,0.04)',
                      border: `1px solid rgba(255,255,255,${code ? 0.18 : 0.07})`,
                      borderRight: 'none', outline: 'none',
                      fontFamily: T.display, fontSize: '16px', fontWeight: 700,
                      letterSpacing: '0.20em', color: '#fff',
                      transition: 'border-color 120ms',
                    }}
                    onFocus={e => e.target.style.borderColor='rgba(61,142,255,0.55)'}
                    onBlur={e => e.target.style.borderColor=code?'rgba(255,255,255,0.18)':'rgba(255,255,255,0.07)'}
                  />
                  <button
                    onClick={() => code.length >= 4 && navigate('multiplayer-lobby')}
                    style={{
                      padding: '0 22px', height: 46, border: 'none', cursor: 'pointer',
                      background: code.length >= 4 ? '#3d8eff' : 'rgba(61,142,255,0.12)',
                      fontFamily: T.display, fontSize: '12px', fontWeight: 800,
                      letterSpacing: '0.12em', textTransform: 'uppercase',
                      color: code.length >= 4 ? '#01010a' : 'rgba(61,142,255,0.4)',
                      transition: 'all 130ms ease', whiteSpace: 'nowrap',
                    }}
                  >Join</button>
                </div>
              </div>

              <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
                <NavRow label="Back to Home" onClick={() => navigate('home')} />
              </div>
            </div>
          </ControlPane>
        }
      />
      <style>{`@keyframes livePulse2{0%,100%{opacity:1}50%{opacity:0.2}}`}</style>
    </div>
  );
}

/* ── Multiplayer Lobby ───────────────────────────────────── */
function MultiplayerLobby({ navigate }) {
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: T.bg0, overflow: 'hidden' }}>
      <Nav2 navigate={navigate} variant="back" backLabel="Leave Room" backTo="multiplayer" />
      <SplitScreen
        left={
          <div style={{ height: '100%', position: 'relative', background: T.bg1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: '0 52px 52px', overflow: 'hidden' }}>
            {/* Atmosphere */}
            <div style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: '60%', pointerEvents: 'none', background: 'radial-gradient(ellipse 80% 70% at 0% 100%, rgba(61,142,255,0.22) 0%, transparent 70%)' }} />
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, #3d8eff, rgba(61,142,255,0.2), transparent)' }} />
            {/* Decorative */}
            <div style={{ position: 'absolute', top: -20, right: -10, fontFamily: T.hero, fontSize: '220px', fontWeight: 900, color: 'rgba(61,142,255,0.04)', lineHeight: 1, userSelect: 'none' }}>R</div>
            <div style={{ position: 'relative', zIndex: 1 }}>
              <div style={{ fontFamily: T.label, fontSize: '10px', fontWeight: 700, letterSpacing: '0.22em', color: '#3d8eff', opacity: 0.8, marginBottom: 14 }}>ROOM CODE</div>
              <div style={{ fontFamily: T.hero, fontSize: 'clamp(64px,8vw,96px)', fontWeight: 900, letterSpacing: '0.12em', color: '#fff', lineHeight: 1, marginBottom: 16, textShadow: '0 0 60px rgba(61,142,255,0.3)' }}>XVXK5</div>
              <div style={{ fontFamily: T.body, fontSize: '13px', color: 'rgba(255,255,255,0.38)', lineHeight: 1.5 }}>Waiting for all players to join before starting the hand.</div>
            </div>
          </div>
        }
        right={
          <ControlPane accent="#3d8eff">
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 18 }}>
                <SmallLabel mb={0}>Players</SmallLabel>
                <span style={{ fontFamily: T.hero, fontSize: '32px', fontWeight: 900, color: 'rgba(255,255,255,0.15)', letterSpacing: '-0.03em', lineHeight: 1 }}>1/2</span>
              </div>

              {/* You — Host */}
              <div style={{ padding: '14px 16px', background: 'rgba(0,240,200,0.06)', borderLeft: '3px solid #00f0c8', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontFamily: T.display, fontSize: '14px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#00f0c8' }}>You</div>
                  <div style={{ fontFamily: T.body, fontSize: '12px', color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>@oliver</div>
                </div>
                <div style={{ padding: '3px 10px', background: 'rgba(0,240,200,0.12)', border: '1px solid rgba(0,240,200,0.30)', fontFamily: T.label, fontSize: '9px', fontWeight: 700, letterSpacing: '0.18em', color: '#00f0c8' }}>HOST</div>
              </div>

              {/* Waiting */}
              <div style={{ padding: '14px 16px', border: '1px dashed rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'rgba(255,255,255,0.18)', animation: 'waitPulse2 1.6s ease-in-out infinite' }} />
                <span style={{ fontFamily: T.body, fontSize: '13px', color: 'rgba(255,255,255,0.25)', fontStyle: 'italic' }}>Waiting for another player…</span>
              </div>

              <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
                <PrimaryBtn label="Copy Invite Link" sub="One-tap room join" accent="#3d8eff" onClick={() => {}} />
                <NavRow label="Leave Room" sub="Exit and return to setup" onClick={() => navigate('multiplayer')} />
              </div>
            </div>
          </ControlPane>
        }
      />
      <style>{`@keyframes waitPulse2{0%,100%{opacity:0.3}50%{opacity:0.9}}`}</style>
    </div>
  );
}

/* ── Tournament Lobby ────────────────────────────────────── */
function TournamentLobby({ navigate }) {
  const [code, setCode] = useStateM('');

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: T.bg0, overflow: 'hidden' }}>
      <Nav2 navigate={navigate} variant="back" backLabel="Back to Home" backTo="home" />
      <SplitScreen
        left={
          <HeroPane title={'TOURNA\nMENT'} eyebrow="Competitive Mode" accent="#f0c040" decorChar="T">
            <div style={{ fontFamily: T.body, fontSize: '13px', color: 'rgba(255,255,255,0.42)', lineHeight: 1.55 }}>
              Round robin format. 4+ players, matches to 30. Play everyone once.
            </div>
          </HeroPane>
        }
        right={
          <ControlPane accent="#f0c040">
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 28 }}>
              {/* Create */}
              <div>
                <SmallLabel mb={12}>Create a Lobby</SmallLabel>
                <div
                  onClick={() => {}}
                  style={{ padding: '20px', background: 'rgba(240,192,64,0.07)', border: '1px solid rgba(240,192,64,0.20)', cursor: 'pointer', transition: 'all 140ms ease' }}
                  onMouseEnter={e => { e.currentTarget.style.background='rgba(240,192,64,0.13)'; e.currentTarget.style.borderColor='rgba(240,192,64,0.40)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background='rgba(240,192,64,0.07)'; e.currentTarget.style.borderColor='rgba(240,192,64,0.20)'; }}
                >
                  <div style={{ width: 24, height: 2, background: '#f0c040', marginBottom: 14, opacity: 0.7 }} />
                  <div style={{ fontFamily: T.display, fontSize: '16px', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#fff', marginBottom: 6 }}>Create Lobby</div>
                  <div style={{ fontFamily: T.body, fontSize: '12px', color: 'rgba(255,255,255,0.38)' }}>Start a tournament lobby and share the code</div>
                </div>
              </div>

              {/* Join */}
              <div>
                <SmallLabel mb={12}>Join with Code</SmallLabel>
                <div style={{ padding: '20px', background: T.bg3, border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ width: 24, height: 2, background: 'rgba(240,192,64,0.35)', marginBottom: 14 }} />
                  <div style={{ fontFamily: T.display, fontSize: '16px', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.72)', marginBottom: 6 }}>Join Lobby</div>
                  <div style={{ fontFamily: T.body, fontSize: '12px', color: 'rgba(255,255,255,0.35)', marginBottom: 14 }}>Enter a lobby code to join an existing tournament</div>
                  <div style={{ display: 'flex', gap: 0 }}>
                    <input
                      value={code}
                      onChange={e => setCode(e.target.value.toUpperCase())}
                      placeholder="LOBBY CODE"
                      maxLength={6}
                      style={{
                        flex: 1, height: 42, padding: '0 14px',
                        background: 'rgba(255,255,255,0.04)',
                        border: `1px solid rgba(255,255,255,${code ? 0.16 : 0.07})`,
                        borderRight: 'none', outline: 'none',
                        fontFamily: T.display, fontSize: '14px', fontWeight: 700,
                        letterSpacing: '0.18em', color: '#fff', transition: 'border-color 120ms',
                      }}
                      onFocus={e => e.target.style.borderColor='rgba(240,192,64,0.5)'}
                      onBlur={e => e.target.style.borderColor=code?'rgba(255,255,255,0.16)':'rgba(255,255,255,0.07)'}
                    />
                    <button style={{
                      padding: '0 20px', height: 42, border: 'none', cursor: 'pointer',
                      background: '#f0c040', fontFamily: T.display, fontSize: '12px', fontWeight: 800,
                      letterSpacing: '0.12em', textTransform: 'uppercase', color: '#01010a',
                    }}>Join</button>
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 'auto' }}>
                <NavRow label="Back to Home" onClick={() => navigate('home')} />
              </div>
            </div>
          </ControlPane>
        }
      />
    </div>
  );
}

Object.assign(window, { MultiplayerSetup, MultiplayerLobby, TournamentLobby });
