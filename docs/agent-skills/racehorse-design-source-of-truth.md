# Racehorse Design Source of Truth

Use this before any UI, visual design, layout, CSS, component styling, page redesign, modal design, card design, board design, Learn mode design, multiplayer design, tournament design, or navigation/header work.

## Non-negotiable rule

The canonical Racehorse visual direction is the Play vs Fritz matte/neon panel system.

The Play vs Fritz setup screen, especially the right-side control panel, is the strongest source of truth for:

- surface treatment
- spacing
- typography hierarchy
- selected states
- button weight
- panel structure
- border restraint
- neon accent usage
- premium product feel

Every new Racehorse screen should feel like it belongs beside Play vs Fritz.

## Current Racehorse identity

Racehorse should feel:

- premium
- matte
- intentional
- competitive
- modern
- readable
- elegant
- slightly futuristic
- product-grade, not template-like

Core visual language:

- obsidian / near-black shell
- deep navy-black matte surfaces
- restrained neon accents
- thin subtle borders
- soft depth
- strong spacing discipline
- large readable typography
- minimal internal borders
- clear hierarchy
- premium rounded panels

Accent system:

- gold: Fritz, elite, primary action, high-value competitive moments
- electric blue: Standard, Ghost, secondary energy, active technical states
- green: Learn, coaching, education, progress
- purple: Lab, advanced/specialty modes only
- red: errors/destructive states only

## Deprecated visual direction

Do not use these as design guidance:

- walnut theme
- brown table theme
- casino table styling
- old warm board direction
- generic sci-fi dashboards
- loud neon overload
- heavy glassmorphism
- cluttered nested panels
- random decorative borders
- tiny low-contrast copy
- dense dashboard-like cards

## Legacy naming warning

Some existing files/classes may still use names like:

- walnut-live
- walnut-preview
- walnut
- match-board-architecture

These names are legacy implementation artifacts.

Do not infer visual direction from them.
Do not make new UI more brown/walnut because a class name says walnut.
If touching these files, preserve behavior unless intentionally migrating, but follow the Play vs Fritz matte/neon identity.

## UI quality bar

Before reporting done, verify:

1. Does this look like it belongs beside Play vs Fritz?
2. Is typography large and readable?
3. Are surfaces matte and premium?
4. Are borders restrained?
5. Is spacing intentional?
6. Are accent colors used according to the mode?
7. Is anything accidentally using old walnut/brown/casino language?
8. Does the screen avoid tiny low-contrast text?
9. Does it feel like a product UI, not a mockup or generic template?
10. Would this make sense to a first-time Racehorse user?

## Implementation rule

Do not do a skin pass only.

For UI work, perform:

1. Structure/layout pass
2. Typography/readability pass
3. Polish pass

If a screen still feels like a bordered dashboard, dense help doc, or old walnut theme, it is not done.
