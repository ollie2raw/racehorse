# Immersion programme: making a match feel like a premium game

Follows `docs/gameplay-feel-programme-results.md` (camera, drag-to-place, tile flight, Fast Fritz). That work made the
board **move** well. This programme is about everything else a match does to the senses: sound, impact, ceremony, touch.

Method, same as before: **measure first, change second, prove it with a number or a recording.** The one constraint
that shapes this programme: the author of the code cannot hear or feel it. So every layer gets a measurement harness
before it gets redesigned, and every "feel" constant is a single tunable number that the owner can adjust by ear.

## 1. What a match does today (audit, 2026-10-31)

| Layer | State |
|---|---|
| Tile sound | One sample (`thwump`) for every tile, played through an `<audio>` element. No variation, no placement, started late on iOS. Your own tile in Play vs Fritz / Ghost made **no sound at all**. |
| Other sounds | Sine-wave "arcade chimes" (score, match found, your turn) and two-note sine stingers (hand/match win/lose). The chimes read as arcade, which the identity rules out. |
| Mix | No bus, no limiter, no shared level. Sounds connected straight to the speakers. |
| Ambience / music | None. |
| Haptics | None anywhere (no Capacitor haptics, no `navigator.vibrate`). |
| Camera, flight, drag | Done (#358 to #372). |
| Landing impact | A 150 ms scale settle on the tile, nothing else. |
| Score ceremony | A `+N` chip and a ping; the race track moves. |
| Hand / match endings | Overlays and two- or three-note sine stingers. |

## 2. Pass A1: engine and mix (PR #377)

### The finding

`e2e/audio-bench.spec.ts` renders every sound offline through the real bus and measures it. The first run:

| Sound | Loudness before | Note |
|---|---|---|
| tile clack | -21.0 dB | the game's main sound was the **quietest** thing in the mix |
| score ping (10 pts) | -11.2 dB | **~10 dB louder than the clack**, so the ping drowned the hit |
| draw | -37.2 dB (peak -30.4) | ~16 dB under the clack: effectively inaudible |
| your turn / match found | -16.3 / -15.1 | louder than the clack |

Also: a tile at the centre of the screen was **3 dB louder** than the same tile anywhere else (a mono source with no
panner plays at full level in both ears).

### What changed

- `src/audio/audioEngine.ts`: one context and one mix bus (glue compressor, then a limiter). Nothing can clip.
- The tile sample is decoded once (on the first gesture) and played from a buffer, with about 1 dB of level and 4% of
  pitch variation per hit. The `<audio>` element remains only as a fallback for the instant before decoding.
- Each clack is panned to where its tile lands on screen (equal-power, spread limited to about half the field).
- The clack is held until the tile lands (`utils/tileImpact.ts`), and the score ping waits behind it.
- Your own tile now has a clack.
- Levels set from the bench (`TRIM_DB` in `utils/sound.ts`, `TILE_VOICE` for the tile).

### After (loudest 100 ms, dBFS; peak in brackets)

| Sound | Before | After |
|---|---|---|
| tile.standard | -21.0 (-4.4) | **-19.7** (-3.3) |
| tile.deal (Fritz) | -23.2 | -21.9 |
| tile at the far left / right | -23.8 (3 dB quieter than centre) | -20.8 (**within 1.1 dB** of centre; balance -0.76 / +0.76) |
| score 5 / 10 / 15 pts | -13.4 / -11.2 / -11.2 | -22.6 / -19.3 / -19.2 (behind the clack; bigger score, bigger ping) |
| draw | -37.2 (-30.4) | **-27.4** (-20.7) |
| blocked | -22.1 | -19.1 |
| your turn | -16.3 | -19.0 |
| hand win / lose | -17.0 / -19.3 | -17.0 / -19.2 (unchanged) |
| match win / lose | -13.8 / -18.5 | -13.8 / -18.3 (unchanged: still the biggest moments) |

Guard rails (asserted on every CI run): nothing clips, everything is audible, no DC offset, sane lengths, the clack
leads, pings sit behind it, endings are the biggest moments, loudness is constant across the stereo field, and the pan
goes to the correct side.

Run it yourself: `AUDIO_BENCH=1 npx playwright test e2e/audio-bench.spec.ts --project=chromium` prints the table.

### A1.1: "a beat late, and like an echo" (reported after #377 shipped)

The owner heard the clack as slightly delayed and echo-like. Measured in a real match, not guessed:

- Tap to clack was **326 ms** (the tile's flight, by design), and then the sample itself added more: **it carries about
  100 ms of slow swell and its real click is at 120 ms.** So the hit arrived ~120 ms after the tile touched, and the
  swell leading into it sounded like a reversed echo.
- The mix bus's two compressors each add ~6 ms of look-ahead delay, and **swallow a loud transient that arrives straight
  after silence** (the bench measured a tile click losing 13 dB once the sample was trimmed to start at its click). They
  also gave every sound an automatic make-up gain. A clack is exactly a transient after silence.

Fix: the sample starts at its detected onset (4 ms fade-in), and the bus is a **static soft limiter** (a waveshaper curve:
no delay, no state, transients pass exactly) instead of compressors. Levels were re-set to the same hierarchy as before.

| | before | after |
|---|---|---|
| time from playback start to the hit | ~120 ms | **9 ms** |
| bus latency | ~12 ms (two compressors) | 0 |
| tile loudness / score ping / draw | -19.7 / -19.3 / -27.4 | -19.5 / -19.3 / -28.0 (unchanged by design) |

The bench now asserts every tile sound hits within 30 ms of starting.

### Pass D1: the opening deal: built, then removed (2026-10-31)

Tried: cards flying from a heap to both hands at the start of every hand, and for the first hand a staged opening
(the pick-a-tile pile gathered, swirled, dealt into both hands, the rest swept into the boneyard counter). PRs #383,
#384 and #385; all three were reverted because, in the owner's words, it "doesn't feel very strong". It was
technically sound (presentation-only, could never hide a hand, covered by unit and real-browser tests) and it still
did not earn its place, so it is gone rather than polished further.

Worth keeping from it:
- **Look at motion, don't guess.** Freeze the page's animation clock (every card ran on WAAPI), step it in fixed
  increments, screenshot each step and lay the frames out as a filmstrip. That found real problems no test would
  (a wobble that did not read as a shuffle, straight-line "conveyor" paths) and a real bug: **Fritz played a tile
  straight through the deal** when he started, because his thinking pause is shorter than a staged deal.
- Copy the *real* tile's look, including its corner radius (the first cards were square slabs); a lone blank rectangle
  as a "deck" reads as a mistake.
- A once-per-hand presentation system belongs in its own lazily loaded chunk, not in the match screen's budget.
- Specs that start a match must wait for any staged opening to finish before measuring the hand.

If staging at the start of a match is revisited, the bar is "obviously better than the instant version": judge it by
filmstrip first, and prefer making the *existing* pick-a-tile moment stronger over adding a new sequence after it.

## 3. The plan

Each pass is its own PR, measured before and after. Order is by felt impact per risk.

| Pass | What | Needs from you |
|---|---|---|
| **A2: a premium sound palette** | Replace the sine "arcade chimes" with a warm, restrained palette (soft mallet and felt tones, no arcade arpeggios): score ping scaled by points, a distinct lead-change stinger, hand and match endings that feel earned, tile select / zone-appear ticks, an invalid-move thud. Bench measures loudness hierarchy, brightness (spectral centroid) and length for each. | A direction word or two: for example "warm wood and felt" vs "glass and brass". I will default to warm and restrained. |
| **A3: room and bed** | A very quiet room tone under the match and a short "room" reverb on the clack so tiles sit in a space, ducking under sound effects. Settings switch. | Whether ambience is on by default (I recommend **off by default**, offered in Settings) |
| **B: landing weight** | On landing: a contact shadow bloom under the tile, a tiny board response, the `+N` chip rising from the tile itself, and the race track's horse stepping on the same beat as the ping. Reduced-motion respected. Measured with the play-trace tool. | none |
| **C: haptics (native app)** | A light tap on place, a firmer tap on score, a double on a blocked hand, using the Capacitor haptics plugin. This is probably the single biggest "feels like a real game" upgrade on a phone. | **Approval to add a native plugin and rebuild the iOS app**: it changes the native project, not just the web client. |
| **D: endings** | Hand and match endings as short staged moments (the winning tile, the score count-up, the result stinger) rather than an overlay appearing. | A design review of one frame-by-frame storyboard before I build it. |
| **E: phone board size** | The match-HUD redesign for board height on phones (still the only way to fully fix the largest boards at 844x390). | Carried over from the earlier programme: a design decision. |

## 4. Rules for this programme

- **Never ship a feel number without a measurement behind it.** If it cannot be measured, it must be one named constant.
- **Never change timing and look together** in one PR; a regression has to be attributable.
- **Reduced motion and mute are contracts.** Anything new honours both, and the mute setting silences all new sounds.
- **Gameplay logic is untouched.** All of this is presentation.
- The owner's ears and hands are the final judge. Every pass ends with a short "please listen / please feel" note.
