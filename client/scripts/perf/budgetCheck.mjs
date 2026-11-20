// Two-sided budget check: `max` always, `min` when set. It catches a measure that collapsed to 0 or NaN while the thing it
// measures still ships. `!(v >= min)` style comparisons are false for NaN, so a broken measure can never pass.
export function withinBudget(v, budget) {
  return v <= budget.max && (budget.min === undefined || v >= budget.min);
}

export function describeBudget(budget) {
  return `${budget.min === undefined ? '' : `${budget.min.toLocaleString('en-US')} <= `}${budget.max.toLocaleString('en-US')}`;
}
