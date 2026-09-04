import { BlockList, isIP } from 'net';

/**
 * Cloudflare edge ranges — https://www.cloudflare.com/ips/ (synced 2026-09-04).
 * Render routes every request to this app through its platform Cloudflare before
 * its own internal load balancer, so in production the request's immediate
 * upstream is always one of these and the `CF-Connecting-IP` header it sets is
 * authoritative (Cloudflare strips any client-supplied value). Kept in sync by
 * hand; a stale entry only degrades that PoP's requests to `req.ip` keying — it
 * cannot open a spoof.
 */
const CLOUDFLARE_V4 = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
  '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
  '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
];
const CLOUDFLARE_V6 = [
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32',
  '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32',
];

/**
 * `trust proxy` value for `app.set()`.
 *
 * AU-3 (HARDENING_PLAN §6.3) — corrected 2026-09-04. The original fix set
 * `trust proxy: 1`, on the assumption of a single Render load-balancer hop.
 * Prod logs proved the real chain is two hops — `X-Forwarded-For` arrives as
 * `<real client>, <Cloudflare edge>, <Render internal>` — so `req.ip` resolved
 * to a shared Render-internal `10.x` address and distinct users collided onto
 * ~2 rate-limit keys (cross-user false 429s, observed live).
 *
 * This list is range-based, not a hop count: trusting Cloudflare + every
 * private / link-local range makes Express walk `X-Forwarded-For` from the right
 * past all infrastructure and return the left-most entry that is a real client.
 * A client cannot forge it — anything they prepend sits to the *left* of the
 * address Cloudflare appends, so Express never selects it.
 */
export const TRUSTED_PROXY: string[] = [
  'loopback', 'linklocal', 'uniquelocal', ...CLOUDFLARE_V4, ...CLOUDFLARE_V6,
];

const infraRanges = new BlockList();
infraRanges.addSubnet('10.0.0.0', 8, 'ipv4');
infraRanges.addSubnet('172.16.0.0', 12, 'ipv4');
infraRanges.addSubnet('192.168.0.0', 16, 'ipv4');
infraRanges.addSubnet('127.0.0.0', 8, 'ipv4');
infraRanges.addSubnet('169.254.0.0', 16, 'ipv4');
infraRanges.addAddress('::1', 'ipv6');
infraRanges.addSubnet('fc00::', 7, 'ipv6');
infraRanges.addSubnet('fe80::', 10, 'ipv6');
for (const cidr of CLOUDFLARE_V4) {
  const [net, prefix] = cidr.split('/');
  infraRanges.addSubnet(net, Number(prefix), 'ipv4');
}
for (const cidr of CLOUDFLARE_V6) {
  const [net, prefix] = cidr.split('/');
  infraRanges.addSubnet(net, Number(prefix), 'ipv6');
}

/**
 * True when `ip` is a Cloudflare edge or a private Render hop — i.e. the request
 * reached us through trusted infrastructure, so a header that infrastructure
 * appends (`CF-Connecting-IP`) can be believed. A raw request straight to the
 * origin has a public, non-Cloudflare peer and fails this check, so its
 * self-declared `CF-Connecting-IP` is ignored.
 */
export function isTrustedInfraPeer(ip: string | null | undefined): boolean {
  if (!ip) return false;
  const unwrapped = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  const version = isIP(unwrapped);
  if (version === 0) return false;
  return infraRanges.check(unwrapped, version === 4 ? 'ipv4' : 'ipv6');
}
