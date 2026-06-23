
interface TileRackProps {
  count: number;
  isActive?: boolean;
  variant?: 'default' | 'ghost';
}

export default function TileRack({
  count,
  isActive = false,
  variant = 'default',
}: TileRackProps) {
  const visibleCount = count;

  return (
    <div
      className={`rh-tile-rack${isActive ? ' is-active' : ''}${variant === 'ghost' ? ' is-ghost' : ''}`}
    >
      {Array.from({ length: visibleCount }).map((_, i) => (
        <div key={i} className="rh-tile-rack__tile" aria-hidden />
      ))}
    </div>
  );
}
