import type { PlayerIdentityModel } from '../playerIdentityTypes';

type Props = { subject: PlayerIdentityModel['subject']; rivalry: PlayerIdentityModel['rivalry']; featuredRelationship?: boolean };

export function PlayerRelationshipCard({ subject, rivalry, featuredRelationship = false }: Props) {
  const h2h = rivalry.currentViewerHeadToHead;
  if (subject.isCurrentUser) return rivalry.closestRival && !featuredRelationship ? <section className="identity-relationship identity-relationship--self" aria-labelledby="identity-relationship-title"><p className="identity-eyebrow">Your table</p><h2 id="identity-relationship-title">Closest rival</h2><strong>{rivalry.closestRival.username}</strong><span>{rivalry.closestRival.gamesPlayed} games played</span></section> : null;
  if (!h2h && subject.friendshipStatus !== 'friends') return null;
  if (featuredRelationship && subject.friendshipStatus !== 'friends') return null;
  return <section className="identity-relationship" aria-labelledby="identity-relationship-title"><p className="identity-eyebrow">Relationship</p><h2 id="identity-relationship-title">{featuredRelationship ? 'At the table' : `Your record vs ${subject.username ?? 'this player'}`}</h2>{featuredRelationship ? <span>Friends at the table</span> : h2h ? <strong>{h2h.wins}W – {h2h.losses}L</strong> : <span>Friends at the table</span>}{subject.friendshipStatus === 'friends' && <span className="identity-relationship__friend">Friends</span>}</section>;
}
