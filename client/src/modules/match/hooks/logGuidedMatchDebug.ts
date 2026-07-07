import {
  getMatchableOpenEnds,
  getPlacementTargetsForTile,
  type BotMatchState,
} from '../runtime/botEngine.ts';
import { botMatchDebugLog, shouldLogBotMatchDebug } from '../runtime/botMatchDebug.ts';
import { toTileKey } from '../../../game/tileKeys.ts';
import type { Move } from '../../../types.ts';

export function logGuidedMatchDebug(args: {
  isGuidedMode: boolean;
  isAuthoringMode: boolean;
  match: BotMatchState;
  lessonStepIndex: number;
  userLegalMoves: Move[];
  userPlayMoves: Move[];
}): void {
  const { isGuidedMode, isAuthoringMode, match, lessonStepIndex, userLegalMoves, userPlayMoves } = args;
  if (!shouldLogBotMatchDebug() || !isGuidedMode || isAuthoringMode) return;

  botMatchDebugLog('[guided-move] rendered match player hand =', match.players.you.hand.map(toTileKey));
  botMatchDebugLog('[guided-move] rendered match board mainLine length =', match.board?.mainLine.length);
  botMatchDebugLog('[guided-move] lessonStepIndex =', lessonStepIndex);

  if (!match.board) return;

  type RenderedOpenEnd = { side: string; val: number; isDouble: boolean };
  const rawRenderedEnds: RenderedOpenEnd[] = [
    { side: 'left', val: match.board.leftEnd, isDouble: match.board.leftEndIsDouble },
    { side: 'right', val: match.board.rightEnd, isDouble: match.board.rightEndIsDouble },
    ...match.board.hubDoubles.flatMap((h, hi) =>
      h.isCrossed
        ? (h.branches ?? []).map((b, bi) =>
            b ? { side: `hub${hi}-arm${bi}`, val: b.openEnd, isDouble: b.openEndIsDouble } : null,
          )
        : [],
    ).filter((e): e is RenderedOpenEnd => e != null),
  ];
  botMatchDebugLog('[guided-legal] visible rendered open ends =', rawRenderedEnds);

  const legalityEnds = getMatchableOpenEnds(match.board).map((e) => ({
    position: e.position,
    val: e.matchValue,
  }));
  botMatchDebugLog('[guided-legal] legality source open ends =', legalityEnds);

  const perTileTargets = match.players.you.hand.map((tile) => ({
    tile: toTileKey(tile),
    targets: getPlacementTargetsForTile(match.board, tile),
  }));
  botMatchDebugLog('[guided-legal] placement targets for each tile in hand =', perTileTargets);

  const visibleSet = new Set(rawRenderedEnds.map((e) => `${e.val}`));
  const legalityExtras = legalityEnds.filter((e) => !visibleSet.has(`${e.val}`));
  const mismatchReason =
    legalityExtras.length > 0
      ? `legality has values not visible: ${legalityExtras.map((e) => `${e.position}=${e.val}`).join(', ')}`
      : 'none';
  botMatchDebugLog('[guided-legal] mismatch reason =', mismatchReason);
  botMatchDebugLog('[GUIDED-CURRENT-SCREEN]', {
    lessonStepIndex,
    renderedHand: match.players.you.hand.map(toTileKey),
    renderedMainLineLen: match.board?.mainLine?.length ?? 0,
    renderedLeftEnd: match.board?.leftEnd,
    renderedRightEnd: match.board?.rightEnd,
    handOpen: match.handOpen,
    userLegalMoves: userLegalMoves.map((m) => ({
      type: m.type,
      tile: m.tile ? toTileKey(m.tile) : null,
      position: m.position ?? null,
    })),
    legalMoves: userPlayMoves.map((m) => ({
      tile: m.tile ? toTileKey(m.tile) : null,
      position: m.position ?? null,
    })),
  });
}