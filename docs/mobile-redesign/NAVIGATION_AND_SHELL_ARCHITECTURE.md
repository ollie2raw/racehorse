# Navigation and shell architecture

## Existing information architecture

Five major areas in `client/src/components/nav/appPrimaryTabs.ts`:

| Primary area | Current mode/route | Related destinations |
|---|---|---|
| Multiplayer | `multiplayer`, `/multiplayer` | quick/private lobbies, room/match, invite/challenge |
| Single Player | `singlePlayerHub`, `/solo` | Fritz `/solo/fritz`, Ghost `/solo/ghost`, Journey `/journey`, Daily Fritz `/daily-fritz`, Puzzle Rush |
| Tournament | `tournament`, `/tournament` | bracket `/tournament/:id`, result `/tournament/:id/result`, match attach |
| Social | `feed`, `/social` | friends, activity, leaderboard, profile, stats, rating history |
| Learn | `learn`, `/learn` | How to Play, lessons, guided match, Lab, authoring/admin |

Home `/` remains the command center outside those five primary areas. It may display the phone five-item bottom bar with **no selected tab**. Multiplayer remains tab 1 on phone and wide desktop. The Racehorse brand/logo provides the Home affordance where shell context allows; Home is not a sixth tab. Settings/auth/account are utilities. `APP_PRIMARY_TABS` remains the five-area source of truth; surface metadata decides whether a tab is selected or the bar is hidden.

Current tab accents (`appPrimaryTabs.ts`): Multiplayer blue, Single Player purple, Tournament amber, Social blue, Learn green. This doesn't fully match the requested hierarchy (Solo should derive competitive gold/Ghost blue from destination, Social secondary/cool neutral, Daily Puzzle blue, Learn green); active area treatment should be standardized separately from per-feature accent. Journey purple remains a special mode and should not tint all Single Player navigation.

## Frozen navigation decision

- **Phone hub-level destinations:** Multiplayer, Single Player, Tournament, Social and Learn, in that order, with brand/account header and one bottom bar. A primary-area hub selects its tab using `aria-current="page"`; Home displays the same bar with none selected. Multiplayer hub/lobby follows existing route hierarchy; a focused Multiplayer sub-flow uses contextual chrome only when its task requires it.
- **Wide desktop:** retain top horizontal links and account cluster; no bottom tabs. Tablet and landscape phones should be resolved by available layout dimensions, not the `width > 768` shortcut alone.
- **Context/detail:** contextual title and explicit back control; bottom tabs hidden on Daily Fritz, tournament bracket/result, lesson, profile/detail, Fritz/Ghost task setup and focused Multiplayer sub-flows. The owning context gets an explicit parent destination. Direct-loaded detail uses that fallback; in-app Back follows actual history where valid.
- **Gameplay:** no global nav. Fixed in-game Home/exit action (44px target) opens a confirmation containing “Stay in match” and “Leave match”; leaving returns to the owning setup/hub or match result flow. Browser Back follows the same controlled escape path when a live match is active.
- **Profile access:** avatar/menu stays in top shell outside gameplay where space permits. At signed-in 844×390 Hub width show rating, Friends and avatar. Collapse Friends first and rating second; avatar persists. Signed-out shows no stat placeholders. Profile, settings and sign-in/out remain accessible from the account action.
- **Modal navigation:** modal stack owns Escape/back dismissal and focus return. On mobile, full-height sheets use safe-area inset and internal scroll; nested popovers convert to a sheet when they cannot fit the visual viewport.

## Browser history and selected state

`useAppRouteState` currently pushes state on appMode updates and observes `popstate`; route metadata must keep that canonical mapping. Tab navigation pushes an area route. Child routes should push their canonical URL and browser back should return to the actual parent. Present mode path exceptions for active matches are a native-app readiness gap: before packaging, make active match context resumable via durable session identifier/deep link or deliberately keep URL stable and intercept all back navigation. Do not solve this by adding arbitrary local-only route state.

No primary navigation should be shown in both top and bottom locations on phone. In the references, dual navigation occurs in Tournament/Social and other pages omit tabs; this is assessed as independent-mockup inconsistency. A single shell policy removes that confusion.

## Conceptual shell API (not implementation)

At route composition, each surface should declare something equivalent to:

```ts
type SurfacePresentation = {
  shell: 'hub' | 'focused' | 'gameplay' | 'utility';
  primaryArea: 'multiplayer' | 'solo' | 'tournament' | 'social' | 'learn' | null;
  chrome: 'hub-tabs' | 'contextual' | 'none';
  parentMode?: AppMode;
  scroll: 'bounded-page' | 'named-content' | 'none';
  account: 'compact' | 'avatar' | 'hidden';
};
```

This is the PR 1 contract; details and tests are in `PR_1_2_3_CONTRACTS.md`. It is presentation metadata, not a universal visual renderer. Route/domain components continue to render their own content. Home declares `primaryArea: null` and `chrome: 'hub-tabs'`; the bottom bar renders all five areas without `aria-current` on any tab. The Home header has brand left, open center space, and identity/account right. No additional Multiplayer header action is planned.
