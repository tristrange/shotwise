/**
 * Presentation helper: a readable club name for a recorded/effective club
 * label, shown next to the abbreviated badge (reference: club-cards
 * screenshot — "5 iron" next to the "5i" badge). The recorded label itself is
 * never rewritten; this only expands it for display. Matching mirrors
 * `clubOrder` in domain/model.ts so the name agrees with the bag ordering.
 */
export function clubDisplayName(club: string): string {
  const value = club.trim();
  const lower = value.toLowerCase();
  if (/^(d|dr|driver|1w)$/.test(lower)) return 'Driver';
  const namedWedges: Record<string, string> = {
    pw: 'Pitching wedge',
    gw: 'Gap wedge',
    aw: 'Approach wedge',
    sw: 'Sand wedge',
    lw: 'Lob wedge',
    uw: 'Utility wedge',
    w: 'Wedge',
  };
  if (namedWedges[lower]) return namedWedges[lower];
  const loft = lower.match(/^(\d{2})°?$/);
  if (loft) return `${loft[1]}° wedge`;
  const match = lower.match(/^(\d+)(w|h|i)?$/);
  if (match) {
    const n = match[1];
    const family = match[2];
    if (family === 'w') return `${n} wood`;
    if (family === 'h') return `${n} hybrid`;
    return `${n} iron`;
  }
  return value;
}
