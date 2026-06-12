import { describe, expect, it } from 'vitest';
import { createInitialState, startNewHand } from '../game/engine';
import { createReservedRoom } from '../rooms';
import {
  applyQaTournamentRoomFixture,
  QA_FIXTURE_LIVE_QF,
  QA_FIXTURE_NEAR_30_QF,
  QA_FIXTURE_OVERLAY_QF_WIN,
} from './qaSeedRoomFixture';

describe('applyQaTournamentRoomFixture', () => {
  const env = { NODE_ENV: 'test', ENABLE_QA_TOURNAMENT_SEED: '1' } as NodeJS.ProcessEnv;

  function makeStartedRoom() {
    const room = createReservedRoom('QAFIX1', { winningScore: 30 });
    const humanSeat = 'human-qa';
    const botSeat = 'bot:fritz:t1:1';
    room.players = [humanSeat, botSeat];
    room.state = startNewHand(createInitialState([humanSeat, botSeat], { winningScore: 30 }));
    return { room, humanSeat, botSeat };
  }

  it('does nothing when QA seed flag is disabled', () => {
    const { room, humanSeat } = makeStartedRoom();
    const before = room.state?.players[humanSeat].score;
    const applied = applyQaTournamentRoomFixture({
      room,
      match: { status_reason: QA_FIXTURE_LIVE_QF },
      humanSeatId: humanSeat,
      env: { NODE_ENV: 'test' },
    });
    expect(applied).toBe(false);
    expect(room.state?.players[humanSeat].score).toBe(before);
  });

  it('applies live_qf mid-game scores', () => {
    const { room, humanSeat, botSeat } = makeStartedRoom();
    const applied = applyQaTournamentRoomFixture({
      room,
      match: { status_reason: QA_FIXTURE_LIVE_QF },
      humanSeatId: humanSeat,
      env,
    });
    expect(applied).toBe(true);
    expect(room.state?.players[humanSeat].score).toBe(12);
    expect(room.state?.players[botSeat].score).toBe(10);
    expect(room.state?.gameOver).toBe(false);
  });

  it('applies near_30_qf scores without game over', () => {
    const { room, humanSeat, botSeat } = makeStartedRoom();
    applyQaTournamentRoomFixture({
      room,
      match: { status_reason: QA_FIXTURE_NEAR_30_QF },
      humanSeatId: humanSeat,
      env,
    });
    expect(room.state?.players[humanSeat].score).toBe(29);
    expect(room.state?.players[botSeat].score).toBe(18);
    expect(room.state?.gameOver).toBe(false);
  });

  it('applies overlay_qf_win terminal snapshot', () => {
    const { room, humanSeat } = makeStartedRoom();
    applyQaTournamentRoomFixture({
      room,
      match: { status_reason: QA_FIXTURE_OVERLAY_QF_WIN },
      humanSeatId: humanSeat,
      env,
    });
    expect(room.state?.players[humanSeat].score).toBe(30);
    expect(room.state?.gameOver).toBe(true);
    expect(room.state?.winnerId).toBe(humanSeat);
  });
});
