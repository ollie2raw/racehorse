import { replayRankedMoveLog } from '../ghost/rankedDealAuthority';
import { queryVerifiedSinglePlayerMatchByLocalKey } from '../shared/verifiedSinglePlayerMatch';
import type { GameRecordInput, GameRecordVerification } from './gameRecordPayload';

/**
 * How much of a submitted record the server can check.
 *
 * When the server issued the deal (ranked Play vs Fritz keeps a `deal_snapshot` on its verified match), the actions are
 * replayed through the engine from that deal and must reproduce the submitted score. Otherwise there is nothing
 * server-owned to replay against and the record is honestly `unverified` (client-reported).
 *
 * A failed lookup throws (the caller answers 5xx and the client retries); only a definite answer is recorded.
 */
export async function verifyGameRecord(input: GameRecordInput): Promise<GameRecordVerification> {
  if (!input.localMatchId) return 'unverified';
  const match = await queryVerifiedSinglePlayerMatchByLocalKey(input.userId, input.localMatchId);
  if (!match || match.mode !== 'fritz' || !match.dealSnapshot) return 'unverified';
  try {
    const replay = replayRankedMoveLog(match.dealSnapshot, input.moves);
    if (!replay.ok) return 'replay_mismatch';
    return replay.playerScore === input.result.you && replay.opponentScore === input.result.opponent
      ? 'replay_verified'
      : 'replay_mismatch';
  } catch {
    return 'replay_mismatch';
  }
}
