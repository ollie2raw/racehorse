import {
  computeBracketRevealThroughRound,
  isBracketMatchCompletedForDisplay,
} from './tournamentBracketDisplay.ts';

function assertEqual<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(
      `[tournamentBracketDisplay.behaviorTests] ${msg}: expected ${String(expected)}, got ${String(actual)}`,
    );
  }
}

const HUMAN = 'user-human';
const BOT_QF_A = 'bot:fritz:tour-1:1';
const BOT_QF_B = 'bot:fritz:tour-1:2';

function testLobbyHidesFutureRoundCompletion() {
  const ctx = {
    isBracketLobby: true,
    youUserId: HUMAN,
    matches: [
      {
        round: 1 as const,
        status: 'completed' as const,
        winner_id: HUMAN,
        player1_id: HUMAN,
        player2_id: BOT_QF_A,
      },
      {
        round: 2 as const,
        status: 'completed' as const,
        winner_id: BOT_QF_B,
        player1_id: BOT_QF_A,
        player2_id: BOT_QF_B,
      },
    ],
  };

  const sfCompleted = ctx.matches[1];
  assertEqual(
    isBracketMatchCompletedForDisplay(sfCompleted, ctx),
    false,
    'semifinal completed hidden during bracket lobby',
  );

  const otherQfBot = {
    round: 1 as const,
    status: 'completed' as const,
    winner_id: BOT_QF_B,
    player1_id: BOT_QF_A,
    player2_id: BOT_QF_B,
  };
  assertEqual(
    isBracketMatchCompletedForDisplay(otherQfBot, ctx),
    false,
    'other quarterfinal bot result hidden during lobby before human path',
  );
}

function testHumanProgressionGatesOtherQuarterfinals() {
  const beforeHumanQf = {
    isBracketLobby: false,
    youUserId: HUMAN,
    matches: [
      {
        round: 1 as const,
        status: 'ready' as const,
        winner_id: null,
        player1_id: HUMAN,
        player2_id: BOT_QF_A,
      },
      {
        round: 1 as const,
        status: 'completed' as const,
        winner_id: BOT_QF_B,
        player1_id: BOT_QF_A,
        player2_id: BOT_QF_B,
      },
    ],
  };

  assertEqual(
    isBracketMatchCompletedForDisplay(beforeHumanQf.matches[1], beforeHumanQf),
    false,
    'bot-only quarterfinal hidden before human finishes round 1',
  );

  const afterHumanQfWin = {
    isBracketLobby: false,
    youUserId: HUMAN,
    matches: [
      {
        round: 1 as const,
        status: 'completed' as const,
        winner_id: HUMAN,
        player1_id: HUMAN,
        player2_id: BOT_QF_A,
      },
      {
        round: 1 as const,
        status: 'completed' as const,
        winner_id: BOT_QF_B,
        player1_id: BOT_QF_A,
        player2_id: BOT_QF_B,
      },
      {
        round: 2 as const,
        status: 'completed' as const,
        winner_id: BOT_QF_A,
        player1_id: BOT_QF_A,
        player2_id: BOT_QF_B,
      },
    ],
  };

  assertEqual(
    isBracketMatchCompletedForDisplay(afterHumanQfWin.matches[1], afterHumanQfWin),
    true,
    'other quarterfinal visible after human completes round 1',
  );
  assertEqual(
    isBracketMatchCompletedForDisplay(afterHumanQfWin.matches[2], afterHumanQfWin),
    false,
    'semifinal bot result hidden until human completes round 2',
  );

  const gate = computeBracketRevealThroughRound(afterHumanQfWin.matches, HUMAN);
  assertEqual(gate.revealThroughRound, 1, 'reveal gate after QF win');
  assertEqual(gate.revealAll, false, 'not reveal-all after QF win');
}

function testEliminatedRevealsAll() {
  const eliminated = {
    isBracketLobby: false,
    youUserId: HUMAN,
    matches: [
      {
        round: 1 as const,
        status: 'completed' as const,
        winner_id: BOT_QF_A,
        player1_id: HUMAN,
        player2_id: BOT_QF_A,
      },
      {
        round: 2 as const,
        status: 'completed' as const,
        winner_id: BOT_QF_B,
        player1_id: BOT_QF_A,
        player2_id: BOT_QF_B,
      },
    ],
  };

  assertEqual(
    isBracketMatchCompletedForDisplay(eliminated.matches[1], eliminated),
    true,
    'full bracket visible after human elimination',
  );
}

testLobbyHidesFutureRoundCompletion();
testHumanProgressionGatesOtherQuarterfinals();
testEliminatedRevealsAll();
console.log('tournamentBracketDisplay.behaviorTests: ok');
