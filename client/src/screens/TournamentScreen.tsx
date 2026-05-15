import type { Socket } from 'socket.io-client';
import {
  ClaudeModeScreen,
  ClaudePrimaryAction,
  ClaudeSecondaryAction,
  ClaudeSectionLabel,
  ClaudeStatLine,
} from '../ui/claudeMode';

type TournamentPlayer = {
  socketId: string;
  username: string;
  userId?: string | null;
  isBot?: boolean;
};

interface TournamentScreenProps {
  socket: Socket | null;
  connect: () => void;
  disconnect: (reason: string) => void;
  tournamentState: any;
  tournamentId: string | null;
  tournamentCode: string;
  tournamentActiveRoom: string | null;
  setTournamentId: (id: string | null) => void;
  setTournamentCode: (code: string) => void;
  setAppMode: (mode: string) => void;
  setJoinedRoom: (room: string) => void;
  setRoomCode: (code: string) => void;
  authProfile: { username?: string } | null;
  multiplayerIdentityUserId: string;
  multiplayerAuthToken: string | null;
  error: string;
  setError: (msg: string) => void;
  onSpectateAck?: () => void;
}

export function TournamentScreen({
  socket,
  connect,
  disconnect,
  tournamentState,
  tournamentId,
  tournamentCode,
  tournamentActiveRoom,
  setTournamentId,
  setTournamentCode,
  setAppMode,
  setJoinedRoom,
  setRoomCode,
  authProfile,
  multiplayerIdentityUserId,
  multiplayerAuthToken,
  error,
  setError,
  onSpectateAck,
}: TournamentScreenProps) {
  const players: TournamentPlayer[] = Array.isArray(tournamentState?.players)
    ? tournamentState.players.filter(
        (p: TournamentPlayer) =>
          !(p.isBot || p.socketId?.startsWith('bot:fritz:') || p.username?.startsWith('Fritz')),
      )
    : [];
  const standingsRaw = (tournamentState as any)?.standings;
  const standings = Array.isArray(standingsRaw)
    ? standingsRaw
    : standingsRaw && typeof standingsRaw === 'object'
      ? Object.values(standingsRaw)
      : [];
  const matchesRaw = (tournamentState as any)?.matches;
  const matches = Array.isArray(matchesRaw) ? matchesRaw : [];
  const activeRoom = tournamentActiveRoom ?? tournamentState?.activeRoomCode ?? null;
  const activeMatchId = tournamentState?.activeMatchId ?? null;
  const isHost = Boolean(
    socket?.id &&
      ((tournamentState?.hostSocketId && tournamentState.hostSocketId === socket.id) ||
        (tournamentState?.hostId && tournamentState.hostId === socket.id)),
  );

  const mySocketId = socket?.id ?? null;
  const nameFor = (sid: string) =>
    (players.find((p: any) => p.socketId === sid)?.username as string | undefined) ?? 'Player';

  const activeMatch =
    (activeMatchId ? matches.find((m: any) => m.id === activeMatchId) : null) ??
    matches.find((m: any) => m.status === 'active') ??
    null;

  const doneCount = matches.filter((m: any) => m.status === 'done').length;
  const totalMatches = matches.length;

  const youArePlaying = Boolean(
    activeMatch && mySocketId && (activeMatch.a === mySocketId || activeMatch.b === mySocketId),
  );

  const nextForYou =
    mySocketId
      ? matches.find(
          (m: any) =>
            m.status !== 'done' &&
            (m.a === mySocketId || m.b === mySocketId) &&
            (!activeMatch || m.id !== activeMatch.id),
        ) ?? null
      : null;

  const yourStatus =
    tournamentState?.status === 'complete'
      ? 'Tournament complete'
      : youArePlaying
        ? 'Playing now'
        : nextForYou
          ? 'Waiting for your next match'
          : tournamentState?.status === 'running'
            ? 'Waiting for assignment'
            : 'Lobby';
  const showLobbySetup = !tournamentId || tournamentState?.status === 'lobby';

  const createLobby = () => {
    if (!socket) {
      connect();
      return setError('Connecting to server…');
    }
    if (!socket.connected) {
      connect();
      setError('Connecting to server…');
      const retry = () => {
        socket.off('connect', retry);
        socket.emit(
          'tournament:create',
          { username: authProfile?.username ?? 'Guest', userId: multiplayerIdentityUserId },
          (resp: any) => {
            if (!resp?.ok) return setError(resp?.error ? `Create failed: ${resp.error}` : 'Failed to create lobby.');
            setTournamentId(resp.id);
            setTournamentCode(resp.lobbyCode);
            setError('');
          },
        );
      };
      socket.on('connect', retry);
      return;
    }
    socket.emit(
      'tournament:create',
      { username: authProfile?.username ?? 'Guest', userId: multiplayerIdentityUserId },
      (resp: any) => {
        if (!resp?.ok) return setError(resp?.error ? `Create failed: ${resp.error}` : 'Failed to create lobby.');
        setTournamentId(resp.id);
        setTournamentCode(resp.lobbyCode);
        setError('');
      },
    );
  };

  const joinLobby = () => {
    if (!socket?.connected) {
      connect();
      return setError('Connecting to server…');
    }
    const code = tournamentCode.trim().toUpperCase();
    if (!code) return setError('Enter a lobby code.');
    socket.emit(
      'tournament:join',
      code,
      { username: authProfile?.username ?? 'Guest', userId: multiplayerIdentityUserId },
      (resp: any) => {
        if (!resp?.ok) {
          return setError(resp?.error === 'already_started' ? 'Tournament already started.' : 'Join failed.');
        }
        setTournamentId(resp.id);
        setTournamentCode(resp.lobbyCode);
        setError('');
      },
    );
  };

  const start = () => {
    if (!socket?.connected) {
      connect();
      return setError('Connecting to server…');
    }
    socket.emit('tournament:start', (resp: any) => {
      if (!resp?.ok) {
        if (resp?.error === 'need_2') return setError('Need at least 2 players.');
        if (resp?.error === 'need_4') return setError('Need 4+ players.');
        return setError('Start failed.');
      }
      setError('');
    });
  };

  const spectate = () => {
    if (!socket?.connected) {
      connect();
      return setError('Connecting to server…');
    }
    if (!activeRoom) return setError('No active match yet.');
    const code = String(activeRoom).trim().toUpperCase();
    socket.emit(
      'room:spectate',
      code,
      {
        username: authProfile?.username ?? 'Guest',
        userId: multiplayerIdentityUserId,
        authToken: multiplayerAuthToken,
      },
      (resp: any) => {
        if (!resp?.ok) return setError('Spectate failed.');
        onSpectateAck?.();
        setJoinedRoom(code);
        setRoomCode(code);
        setAppMode('multiplayer');
        setError('');
      },
    );
  };

  // suppress unused warning — showLobbySetup is computed for future conditional use
  void showLobbySetup;

  return (
    <div className="app large-mode">
      <div className="screen lobby-screen mode-home-screen mode-subpage-screen claude-mode-screen-shell" style={{ padding: 0, overflow: 'hidden' }}>
        <ClaudeModeScreen
          accent="#fb923c"
          eyebrow="Competitive Mode"
          title={'TOURNA\nMENT'}
          description={
            tournamentId
              ? 'Finish your match, track the standings, and watch live pairings as the bracket updates.'
              : 'Round robin format. Four or more players, matches to 30, play everyone once.'
          }
          decor="T"
          backLabel={socket?.connected ? 'Disconnect' : 'Back to Home'}
          onBack={() => disconnect('user disconnect')}
          heroFooter={
            <div className="claude-mode-chip-row">
              <span className="claude-mode-chip">4+ Players</span>
              <span className="claude-mode-chip">Round Robin</span>
              <span className="claude-mode-chip">Matches to 30</span>
            </div>
          }
          panel={
            <div className="claude-mode-panel-stack">
              {error ? (
                <div className="claude-mode-card">
                  <ClaudeSectionLabel color="#fb923c">Tournament Error</ClaudeSectionLabel>
                  <div style={{ display: 'grid', gap: 10 }}>
                    <div style={{ color: 'rgba(255,255,255,0.86)', fontSize: '1rem', lineHeight: 1.45 }}>{error}</div>
                    <ClaudeSecondaryAction title="Dismiss" onClick={() => setError('')} />
                  </div>
                </div>
              ) : null}

              {!tournamentId && (
                <>
                  <div className="claude-mode-card" style={{ display: 'grid', gap: 12 }}>
                    <ClaudeSectionLabel color="#fb923c">Create a Lobby</ClaudeSectionLabel>
                    <div style={{ color: '#fff', fontFamily: 'Barlow Condensed, system-ui, sans-serif', fontSize: '1.9rem', fontWeight: 800, letterSpacing: '0.02em', textTransform: 'uppercase', lineHeight: 1 }}>
                      Start a tournament lobby and share the code.
                    </div>
                    <div style={{ color: 'rgba(255,255,255,0.46)', fontFamily: 'Space Grotesk, system-ui, sans-serif', fontSize: '0.92rem', lineHeight: 1.55 }}>
                      Create a room first, then bring everyone into the bracket from the same full-screen hub.
                    </div>
                    <ClaudePrimaryAction
                      accent="#fb923c"
                      title="Create Lobby"
                      meta="Start a new tournament room"
                      onClick={createLobby}
                    />
                  </div>

                  <div className="claude-mode-card" style={{ display: 'grid', gap: 12 }}>
                    <ClaudeSectionLabel color="#fb923c">Join with Code</ClaudeSectionLabel>
                    <div className="claude-mode-join-box">
                      <input
                        type="text"
                        placeholder="LOBBY CODE"
                        value={tournamentCode}
                        onChange={(e) => setTournamentCode(e.target.value.toUpperCase())}
                        maxLength={6}
                      />
                      <button onClick={joinLobby} disabled={!tournamentCode.trim()}>
                        Join
                      </button>
                    </div>
                  </div>

                  <ClaudeSecondaryAction
                    title={socket?.connected ? 'Disconnect' : 'Back to Home'}
                    meta={socket?.connected ? 'Leave the live tournament connection' : 'Return to the main mode selector'}
                    onClick={() => disconnect('user disconnect')}
                  />
                </>
              )}

              {tournamentId && tournamentState?.status !== 'running' && (
                <>
                  <div className="claude-mode-card" style={{ display: 'grid', gap: 12 }}>
                    <ClaudeSectionLabel color="#fb923c">Lobby Code</ClaudeSectionLabel>
                    <div style={{ color: '#fff', fontFamily: 'Outfit, system-ui, sans-serif', fontSize: 'clamp(3.2rem, 5vw, 4.6rem)', fontWeight: 900, letterSpacing: '0.12em', lineHeight: 0.92 }}>
                      {tournamentCode || '------'}
                    </div>
                    <div style={{ color: 'rgba(255,255,255,0.46)', fontFamily: 'Space Grotesk, system-ui, sans-serif', fontSize: '0.92rem', lineHeight: 1.55 }}>
                      Share this code to invite players into the tournament lobby.
                    </div>
                    <ClaudePrimaryAction
                      accent="#fb923c"
                      title="Copy Lobby Code"
                      meta="Share the invite instantly"
                      onClick={() => tournamentCode && navigator.clipboard?.writeText(String(tournamentCode))}
                      disabled={!tournamentCode}
                    />
                  </div>

                  <div className="claude-mode-card" style={{ display: 'grid', gap: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                      <ClaudeSectionLabel color="#fb923c">Players</ClaudeSectionLabel>
                      <span style={{ color: 'rgba(255,255,255,0.32)', fontFamily: 'Outfit, system-ui, sans-serif', fontSize: '2rem', fontWeight: 900, lineHeight: 1 }}>
                        {players.length}/4
                      </span>
                    </div>
                    <div style={{ display: 'grid', gap: 8 }}>
                      {players.map((p) => (
                        <div key={p.socketId} className={`claude-mode-player-card ${mySocketId && p.socketId === mySocketId ? 'is-host' : ''}`}>
                          <div>
                            <div className="claude-mode-player-card__title">{p.username ?? 'Player'}</div>
                            <div className="claude-mode-player-card__meta">
                              {mySocketId && p.socketId === mySocketId ? 'You are in this lobby' : 'Joined and waiting'}
                            </div>
                          </div>
                          {mySocketId && p.socketId === mySocketId ? <span className="claude-mode-pill">You</span> : null}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="claude-mode-card" style={{ display: 'grid', gap: 12 }}>
                    <ClaudeSectionLabel color="#fb923c">Join with Code</ClaudeSectionLabel>
                    <div className="claude-mode-join-box">
                      <input
                        type="text"
                        placeholder="LOBBY CODE"
                        value={tournamentCode}
                        onChange={(e) => setTournamentCode(e.target.value.toUpperCase())}
                        maxLength={6}
                      />
                      <button onClick={joinLobby} disabled={!tournamentCode.trim()}>
                        Join
                      </button>
                    </div>
                  </div>

                  {isHost ? (
                    <ClaudePrimaryAction
                      accent="#fb923c"
                      title="Start Tournament"
                      meta={players.length < 2 ? 'Need at least 2 players to start' : 'Generate schedule and begin the first match'}
                      onClick={start}
                      disabled={players.length < 2}
                    />
                  ) : null}

                  <div className="claude-mode-info-card">
                    <ClaudeSectionLabel color="#fb923c">Status</ClaudeSectionLabel>
                    <div style={{ color: '#fff', fontFamily: 'Barlow Condensed, system-ui, sans-serif', fontSize: '1.55rem', fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                      {yourStatus}
                    </div>
                    <ClaudeStatLine label="Now Playing" value={activeMatch ? `${nameFor(activeMatch.a)} vs ${nameFor(activeMatch.b)}` : 'Waiting…'} />
                    <ClaudeStatLine label="Progress" value={totalMatches ? `${doneCount}/${totalMatches} complete` : 'Schedule pending'} />
                  </div>
                </>
              )}

              {tournamentId && tournamentState?.status === 'running' && (
                <>
                  <div className="claude-mode-card" style={{ display: 'grid', gap: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                      <ClaudeSectionLabel color="#fb923c">Standings</ClaudeSectionLabel>
                      <span style={{ color: 'rgba(255,255,255,0.32)', fontFamily: 'Outfit, system-ui, sans-serif', fontSize: '2rem', fontWeight: 900, lineHeight: 1 }}>
                        {doneCount}/{totalMatches || 0}
                      </span>
                    </div>
                    <div style={{ display: 'grid', gap: 8, maxHeight: 280, overflowY: 'auto' }}>
                      {standings.map((st: any, idx: number) => {
                        const diff = (st.pointsFor ?? 0) - (st.pointsAgainst ?? 0);
                        const me = Boolean(mySocketId && st.socketId === mySocketId);
                        return (
                          <div key={st.socketId} className={`claude-mode-player-card ${me ? 'is-host' : ''}`}>
                            <div>
                              <div className="claude-mode-player-card__title">
                                {idx + 1}. {st.username ?? 'Player'}
                              </div>
                              <div className="claude-mode-player-card__meta">
                                {st.wins ?? 0} wins · {diff >= 0 ? '+' : ''}{diff} diff
                              </div>
                            </div>
                            {me ? <span className="claude-mode-pill">You</span> : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="claude-mode-card" style={{ display: 'grid', gap: 10 }}>
                    <ClaudeSectionLabel color="#fb923c">Bracket</ClaudeSectionLabel>
                    <div style={{ display: 'grid', gap: 8, maxHeight: 220, overflowY: 'auto' }}>
                      {matches.map((m: any, i: number) => {
                        const isActive = Boolean(activeMatch && m.id === activeMatch.id);
                        const label = m.status === 'active' ? 'Playing' : m.status === 'done' ? 'Done' : 'Queued';
                        return (
                          <div key={m.id} className={`claude-mode-player-card ${isActive ? 'is-host' : ''}`}>
                            <div>
                              <div className="claude-mode-player-card__title">Match {i + 1}</div>
                              <div className="claude-mode-player-card__meta">{nameFor(m.a)} vs {nameFor(m.b)}</div>
                            </div>
                            <span className="claude-mode-pill">{label}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="claude-mode-info-card">
                    <ClaudeSectionLabel color="#fb923c">Tournament Status</ClaudeSectionLabel>
                    <ClaudeStatLine label="Lobby Code" value={tournamentCode || '------'} accent="#fb923c" />
                    <ClaudeStatLine label="Now Playing" value={activeMatch ? `${nameFor(activeMatch.a)} vs ${nameFor(activeMatch.b)}` : 'Waiting…'} />
                    <ClaudeStatLine
                      label="Up Next"
                      value={nextForYou ? (nextForYou.a === mySocketId ? nameFor(nextForYou.b) : nameFor(nextForYou.a)) : 'Waiting…'}
                    />
                    {activeRoom && !youArePlaying ? (
                      <ClaudePrimaryAction
                        accent="#fb923c"
                        title="Watch Match"
                        meta="Spectate the currently active table"
                        onClick={spectate}
                        disabled={!activeRoom}
                      />
                    ) : null}
                  </div>
                </>
              )}
            </div>
          }
        />
      </div>
    </div>
  );
}
