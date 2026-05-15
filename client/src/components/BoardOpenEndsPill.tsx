/** Open-end sum pill — board top-left, mirrors boneyard pill styling. */

export interface BoardOpenEndsPillProps {
  openEndsSum: number;
  visible?: boolean;
}

export function BoardOpenEndsPill({ openEndsSum, visible = true }: BoardOpenEndsPillProps) {
  if (!visible) return null;

  return (
    <div className="open-ends-pill board-corner-pill board-corner-pill--tl" aria-label={`${openEndsSum} open ends`}>
      <span className="open-ends-pill__label">Count</span>
      <span className="open-ends-count">{openEndsSum}</span>
    </div>
  );
}
