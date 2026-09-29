
interface TileRackProps {
  count: number;
  isActive?: boolean;
  variant?: 'default' | 'ghost';
}

/**
 * Tiles past this count get an overflow badge. The web draws every tile (it
 * has room); the native app's short HUD hides the extras in CSS and shows
 * the "+N" badge instead (native-landscape.css).
 */
const RACK_OVERFLOW_AFTER = 9;

export default function TileRack({
  count,
  isActive = false,
  variant = 'default',
}: TileRackProps) {
  const visibleCount = count;
  const overflow = Math.max(0, count - RACK_OVERFLOW_AFTER);

  return (
    <div
      className={`rh-tile-rack${isActive ? ' is-active' : ''}${variant === 'ghost' ? ' is-ghost' : ''}`}
      role="img"
      aria-label={`${count} tile${count === 1 ? '' : 's'} in hand`}
    >
      {Array.from({ length: visibleCount }).map((_, i) => (
        <div key={i} className="rh-tile-rack__tile" aria-hidden />
      ))}
      {overflow > 0 ? (
        <span className="rh-tile-rack__more" aria-hidden>
          +{overflow}
        </span>
      ) : null}
    </div>
  );
}
