/**
 * The long-form How to Play article.
 *
 * Plain data in .mjs so the React page and scripts/prerender.mjs render the
 * same words. The served HTML and the hydrated page must agree — content that
 * only crawlers see is cloaking, and content only users see is invisible to
 * search, which is the whole point of writing this (growth assessment,
 * Phase 1 item 1).
 *
 * Every rule below is taken from the engine, not from generic dominoes:
 *   scoring.ts   computePlayScore, computeGoOutBonusPoints
 *   types.ts     DEFAULT_CONFIG
 *   engine.ts    blocked-hand resolution
 *   docs/daily-fritz-skunk-source-of-truth.md
 */

export const HOW_TO_PLAY_ARTICLE = {
  title: 'How to Play Racehorse Dominoes',
  standfirst:
    'Racehorse is a scoring variant of dominoes built around a race to 60. If you have played Fives before, you already know most of it — but the forced play, the chained turns and the skunk rule make it a different game to sit down to.',
  sections: [
    {
      id: 'what-makes-it-different',
      heading: 'What makes Racehorse different',
      paragraphs: [
        'Most dominoes you meet online is a blocking game: play out your hand, and whoever runs out first wins. Racehorse is a scoring game. You are not really racing to empty your hand — you are racing to 60 points, and points come from the shape of the board rather than from going out.',
        'Three rules do most of the work in making it feel unlike standard dominoes. You are never allowed to pass when you have a legal play. Scoring does not end your turn — it extends it. And a heavy enough loss counts double in a Daily Fritz set, which means a game can end before it looks finished.',
        'The effect is a game with real momentum. One player can chain three or four scoring plays in a row and take a game from level to won in a single turn. That is the part regular players get hooked on, and the part new players usually miss on their first few hands.',
      ],
    },
    {
      id: 'setup',
      heading: 'Setting up',
      paragraphs: [
        'Racehorse uses the standard double-six set: 28 tiles, from the blank-blank up to the six-six. Each player draws seven tiles. The rest form the boneyard.',
        'Two tiles in the boneyard are dead. They are never dealt and never drawn, which means the pile can lock while tiles are still sitting in it. That matters more than it sounds — it is what stops a blocked player drawing forever, and it is why some hands end with both players still holding tiles.',
      ],
    },
    {
      id: 'taking-a-turn',
      heading: 'Taking a turn',
      paragraphs: [
        'A turn has the same shape every time, and it is worth learning that shape before anything else.',
        'First: if you can play, you must play. There is no passing to keep a good tile back, and no holding a double for a better moment. If a legal placement exists, you are making one. This single rule removes most of the stalling that slows down casual dominoes, and it means the board moves fast.',
        'Second: if that play scores, or if it was a double, your turn continues. You play again. This is where games are won. A well-set-up board can let you score, play again, score again, and keep going while your opponent watches.',
        'Third: if you cannot play, Racehorse draws for you automatically. You keep drawing until you find a tile you can place, or until the pile locks down to its two dead tiles. If you are still stuck when it locks, your turn passes automatically. You never have to decide whether to draw or pass — the game handles both.',
      ],
    },
    {
      id: 'scoring',
      heading: 'How scoring works',
      paragraphs: [
        'Points come from the open count: the total of every exposed end currently active on the board. Add those ends together, and if the total is a multiple of five — and not zero — you score.',
        'The points you receive are that total divided by five. An open count of 20 is worth 4 points. A count of 35 is worth 7. Since a game runs to 60, a single strong count is a meaningful chunk of it, and two or three chained together can decide a game.',
        'This is why Racehorse rewards reading the board before you commit. The question on every turn is not "which tile do I want to get rid of" but "what does the board total become after I place this, and can I land it on a five".',
      ],
    },
    {
      id: 'doubles',
      heading: 'Doubles, branches and the open count',
      paragraphs: [
        'Doubles are the most misread part of the game, and they behave in two distinct stages.',
        'While a double is open, it counts its full value toward the open count. An open six-six adds 12, not 6. That makes doubles enormously powerful for setting up a score, and it is the fastest way for a new player to find their first big count.',
        'Once a double has been crossed on both sides, it drops out of the count entirely and opens new branches instead. Play onto a branch and that new end joins the total. So the same double is first a large contributor, then nothing, then the root of two new ends you can build from. Tracking which stage each double is in is most of what separates a strong Racehorse player from a beginner.',
      ],
    },
    {
      id: 'ending-a-hand',
      heading: 'Ending a hand',
      paragraphs: [
        'To go out, you play your last tile — but it has to be a dead play. Your final tile cannot be a double, and it cannot score. If your last tile would score, you cannot use it to finish, and the hand continues.',
        'This catches people out constantly, and it is a deliberate piece of design: it stops games ending on a flourish, and it means holding a scoring tile too long can trap you with a hand you cannot close.',
        'When you do go out, you score for the tiles left in your opponent’s hand — their remaining pips, divided by five and rounded. A hand full of heavy tiles is a serious swing.',
        'If the pile locks and nobody can play, the hand ends anyway. The player holding the fewest pips wins it and takes the bonus. If both players hold the same total, nobody scores.',
      ],
    },
    {
      id: 'winning',
      heading: 'Winning a game, and a Daily Fritz set',
      paragraphs: [
        'A single game runs to 60 points. First there wins.',
        'Daily Fritz — the daily challenge everyone plays on the same deal — is a best-of-three set against the Fritz bot. Win two games and you take the set. Every player in the world gets the identical tiles that day, so the leaderboard measures decisions rather than luck.',
        'The skunk rule is the twist. Win a game while your opponent is still under 30 points, and it counts as two game wins. A skunk in game one or game two therefore ends the set on the spot: skunk Fritz in the opener and you have won 2–0 without playing a second game. It cuts both ways — Fritz can skunk you just as fast.',
        'A skunk in game three is recorded and shown, but it cannot change the result: the set is already going to a single deciding game, and winning it wins the set 2–1 regardless of the margin.',
      ],
    },
    {
      id: 'strategy',
      heading: 'Strategy for your first games',
      paragraphs: [
        'Count before you place, not after. The open count is the whole game, and the difference between a good player and a new one is usually just that the good player knows what the total will be before the tile lands.',
        'Treat doubles as tempo, not as liabilities. In blocking dominoes you want doubles gone early because they are hard to shed. In Racehorse an open double is a scoring engine, and playing one keeps your turn alive regardless.',
        'Think in chains. Because scoring extends your turn, the strongest plays are not the ones that score most now but the ones that leave you able to score again immediately. Ask what the board looks like for your next tile, not just this one.',
        'Watch what your opponent cannot play. The forced-play rule means every draw they take tells you something: they had nothing for those ends. That is real information, and it is free.',
        'Do not hoard your closing tile. Because a final tile cannot score and cannot be a double, the tile you plan to finish on is specific. If you leave yourself holding only doubles and scoring tiles, you cannot go out at all.',
      ],
    },
  ],
};
