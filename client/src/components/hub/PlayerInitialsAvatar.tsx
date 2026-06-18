import type { CSSProperties } from 'react';
import { avatarHue, getInitials } from './playerInitialsAvatarUtils';
import './playerInitialsAvatar.css';

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
