# What only a real iPhone can verify

One page. Everything here needs a human holding a device (TestFlight build unless it says Safari), because headless WebKit cannot show it: the hardware mute switch, real audio routing, the real app lifecycle, real thermals. Mark each **pass / fail** and write what you saw. Anything marked *Safari* works in Mobile Safari too (no TestFlight needed).

Setup: one iPhone (note model and iOS version), the TestFlight build, the same account on a second device for multiplayer, and a Mac with the phone attached for Safari Web Inspector (Develop menu) when a row says *inspector*.

## A. First tap and cold start
| # | Do | Pass when | Fail when |
|---|---|---|---|
| A1 | Force-quit, launch, and as soon as the home screen is drawn tap **Single Player** (count "one-one-thousand" first, then not) | the tap works first time, every time (5 of 5), including the very first tap after install | any tap in the first second does nothing, or the first tap pauses the screen for about a quarter second |
| A2 | Airplane mode on, force-quit, launch | the app opens to a usable home screen (the web files are inside the app) | white screen or a spinner that never ends |
| A3 | Launch five times in a row, cold | first paint feels under about 1.5 s on your phone (video at 60 fps: count frames from icon tap to home drawn) | any launch over 3 s |

## B. Audio (the open "static" complaint is decided here)
| # | Do | Pass when | Fail when |
|---|---|---|---|
| B1 | Play a hand on the phone speaker, listen for the end of every tile click and score ping | no crackle or static at the end of any sound | any audible static (note: tile, score or round end) |
| B2 | Listen blind to `scoring_A..D` and `roundend_A..D` (the WAVs), phone speaker then headphones, **before** opening `key/KEY.txt` | you can name which letters have static, and the key shows which variant fixes it | you hear static in all four |
| B3 | Ringer **switch on silent**, play a tile | decision for you: do you want the game silent too? (Web Audio follows the switch on iOS; a game that must play on silent needs a native audio-session setting) | the app behaves differently from what you decided |
| B4 | Ringer on, play with a Bluetooth headset connected, then disconnect mid-hand | sound moves to the speaker within a second, no stuck silence | silence until a restart |
| B5 | Lock the phone for 60 s mid-hand, unlock, tap a tile | sound plays on the first tap | the first sounds after unlock are missing |
| B6 | Phone call or Siri interrupts, then return | sound resumes on the next tap | silence until restart |
| B7 | First tile after launch | the first clack plays with the tile (not late) | the first sound is missing or delayed |

## C. Lifecycle and saves (inspector: watch the console)
| # | Do | Pass when | Fail when |
|---|---|---|---|
| C1 | Daily Fritz, play 5 moves, swipe to the home screen, then kill the app from the switcher, reopen, resume | you are at most about one move behind (the save window is 12 s; the hide flush should make it exact) | the run is lost, or older than 12 s |
| C2 | Same, but kill within 2 s of your last move | at most that one move is missing, the run is intact and playable | corrupted run or an error |
| C3 | *inspector:* swipe to the home screen / open the app switcher | `visibilitychange` (hidden) logs, then `pagehide` on kill | no `visibilitychange` on app switch (then saves and the speed beacon rely on `pagehide` only) |
| C4 | Airplane mode for 20 s in the middle of a Daily hand, then off | play continues, and the latest state reaches the server (check Settings > the Daily screen after a reload) | progress lost |

## D. Multiplayer (two devices)
| # | Do | Pass when | Fail when |
|---|---|---|---|
| D1 | Play to a hand end, lock the phone for 40 s, unlock | it rejoins on its own and you can press Continue; the next hand deals once | stuck on "waiting" or a duplicate hand |
| D2 | Hand end: both players press Continue within a second | next hand within about a second of the second tap on your connection | over 2 s, or a flash of the old board |
| D3 | Move between Wi-Fi and cellular mid-hand | reconnects in under 10 s with the same board | lost room |

## E. Feel (use a stopwatch or 240 fps slow-mo)
| # | Do | Pass when | Fail when |
|---|---|---|---|
| E1 | Tap a tile then a drop zone, 20 times | the tile starts moving the frame after your finger lifts, no hitch | visible stall on more than 2 of 20 |
| E2 | Hand-over dialog: tap Continue | the next hand's board is there with no extra pause beyond the dialog | a pause of over half a second |
| E3 | 20-minute session | the phone is warm, not hot; no slowdown in the last 5 minutes | the game gets visibly choppier, or iOS warns about temperature |
| E4 | Rotate the phone during a match | stays landscape; layout never overlaps the notch or the home bar | overlap or a layout jump |

## F. Report back
Phone model, iOS version, TestFlight build number, and for each failed row: what you saw, and a screen recording if you can. For B2, send the letters with static before opening the key.
