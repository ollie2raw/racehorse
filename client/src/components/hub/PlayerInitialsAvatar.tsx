import type { CSSProperties } from 'react';
import './playerInitialsAvatar.css';

export function getInitials(username: string): string {
  const parts = username.replace(/[^a-zA-Z0-9]/g, ' ').split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return username.slice(0, 2).toUpperCase();
}

export function avatarHue(username: string): number {
  let hash = 0;
  for (let i = 0; i < username.length; i += 1) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 360;
}

interface PlayerInitialsAvatarProps {
  username: string;
  size?: 'sm' | 'md' | 'lg';
  ring?: 'gold' | 'silver' | 'bronze' | 'none';
  online?: boolean;
  className?: string;
}

export default function PlayerInitialsAvatar({
  username,
  size = 'md',
  ring = 'none',
  online = false,
  className,
}: PlayerInitialsAvatarProps) {
  const hue = avatarHue(username);
  const style: CSSProperties = {
    background: `linear-gradient(145deg, hsl(${hue} 42% 38%), hsl(${(hue + 48) % 360} 48% 24%))`,
  };

  return (
    <span
      className={`rh-hub-avatar rh-hub-avatar--${size} rh-hub-avatar--ring-${ring}${online ? ' rh-hub-avatar--online' : ''}${className ? ` ${className}` : ''}`}
    >
      <span className="rh-hub-avatar-inner" style={style}>
        {getInitials(username)}
      </span>
      {online ? <span className="rh-hub-avatar-dot" aria-hidden="true" /> : null}
    </span>
  );
}
