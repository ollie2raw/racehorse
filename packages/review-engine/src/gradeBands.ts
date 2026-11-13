import { LOSS_BAND_BOUNDARIES } from './accuracyModelCalibration';

/**
 * True when both ends of a loss interval fall in the same grade band (Best / Inaccuracy / Mistake / Blunder; a band edge belongs to the better band, as lossBandLabel does).
 * Lives in its own module so both the bounded exact path (#502) and the cut-result honesty rule can use it without importing each other.
 */
export function intervalInsideOneBand(
  interval: readonly [number, number],
  boundaries: { readonly bestTolerance: number; readonly inaccuracyToMistake: number; readonly mistakeToBlunder: number } = LOSS_BAND_BOUNDARIES,
): boolean {
  const band = (value: number) => (value <= boundaries.bestTolerance ? 0 : value <= boundaries.inaccuracyToMistake ? 1 : value <= boundaries.mistakeToBlunder ? 2 : 3);
  return band(interval[0]) === band(interval[1]);
}
