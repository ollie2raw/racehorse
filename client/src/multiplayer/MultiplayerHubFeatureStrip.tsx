import type { ReactNode } from 'react';
import './multiplayerHubFeatures.css';

function IconCrown({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconBolt({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M13 3L5 14H12L11 21L19 10H12L13 3Z" fill="currentColor" />
    </svg>
  );
}

function IconUsers({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M17 21V19C17 17.9 16.6 16.9 15.8 16.2C15.1 15.4 14.1 15 13 15H5C3.9 15 2.9 15.4 2.2 16.2C1.4 16.9 1 17.9 1 19V21M9 11C11.2 11 13 9.2 13 7C13 4.8 11.2 3 9 3C6.8 3 5 4.8 5 7C5 9.2 6.8 11 9 11ZM23 21V19C23 17 21.7 15.4 20 15M16 3.1C17.7 3.6 19 5.1 19 7S17.7 10.4 16 10.9"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export type MultiplayerHubFeatureStripVariant = 'quick' | 'private';

export type MultiplayerHubFeatureStripProps = {
  variant?: MultiplayerHubFeatureStripVariant;
};

type FeatureItem = {
  key: string;
  icon: ReactNode;
  title: string;
  description: string;
};

/* Titles mirror Quick: 1 word / 2 words / 2 words. Descriptions: 4 / 6 / 5 words (single line). */
const QUICK_FEATURES: FeatureItem[] = [
  {
    key: 'ranked',
    icon: <IconCrown />,
    title: 'Ranked',
    description: 'Affects your Glicko rating.',
  },
  {
    key: 'instant',
    icon: <IconBolt />,
    title: 'Instant Match',
    description: 'No setup. We find the opponent.',
  },
  {
    key: 'queue',
    icon: <IconUsers />,
    title: 'Real Opponents',
    description: 'Pulled from the global queue.',
  },
];

const PRIVATE_FEATURES: FeatureItem[] = [
  {
    key: 'invite',
    icon: <IconCrown />,
    title: 'Invite',
    description: 'Only invited players join.',
  },
  {
    key: 'room',
    icon: <IconBolt />,
    title: 'Room invite',
    description: 'Set format, timer, and win target.',
  },
  {
    key: 'rated',
    icon: <IconUsers />,
    title: 'Rated choice',
    description: 'Rated stays optional in lobby.',
  },
];

/** Three-up highlight strip under the 1v1 duel cards (shared Quick + Private hub layout). */
export function MultiplayerHubFeatureStrip({ variant = 'quick' }: MultiplayerHubFeatureStripProps) {
  const items = variant === 'private' ? PRIVATE_FEATURES : QUICK_FEATURES;
  const aria =
    variant === 'private' ? 'Private lobby highlights' : 'Quick match highlights';

  return (
    <div className="mm-features" role="list" aria-label={aria}>
      {items.map((item) => (
        <div className="mm-feature" key={item.key} role="listitem">
          <div className="mm-feature__header">
            {item.icon} {item.title}
          </div>
          <p className="mm-feature__desc">{item.description}</p>
        </div>
      ))}
    </div>
  );
}
