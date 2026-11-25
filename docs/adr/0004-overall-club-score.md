# ADR-0004: No composite overall club score — within-bag category standings instead

Status: accepted
Date: 2026-11-26
Related: `docs/ROADMAP.md` §8.3, `app/src/domain/standings.ts`, ADR-0003

## Context

Roadmap §8.3 asks whether an overall club score should exist, and under what
conditions: it must say what the score represents, how categories are
normalized, which reference populations and weights are used, how uncertainty
and insufficient data are handled — and it must not arbitrarily combine
unrelated numbers into a rating out of 100.

## Decision

**No composite 0–100 overall club score is introduced.** Instead, each club
gets a within-bag standing per category (`bagStandings()` in
`app/src/domain/standings.ts`): its rank among the golfer's own clubs that
have sufficient data for that category on the same basis and window, with
ties sharing a rank. The profile UI shows e.g. "2nd of 7 clubs" next to each
category.

Answers to the §8.3 checklist:

- **What the score represents:** not a single number — the standing represents
  "how this club compares to your other clubs on this category right now".
  A composite would have no physical meaning: it would mix metres, degrees and
  a mishit share.
- **Normalization / reference population:** the only defensible reference
  population is the golfer's own bag — external benchmark datasets are
  link-only (ADR/research in `docs/external-benchmark-sources.md`, PR 15), so
  there is no embeddable population to normalize against. Within-bag ranks
  need no cross-unit normalization at all; each category is compared only in
  its own unit.
- **Weights / club-type differences:** none, because there is no composite.
  Weighting incommensurable units would be exactly the arbitrary combination
  §8.3 prohibits.
- **Uncertainty:** per-category sample sizes stay visible next to each score;
  a composite would have hidden them behind one number.
- **Insufficient data:** a category below its sample minimum yields no value
  and no standing (null) — never a guessed rank.
- **Historical improvement:** standings follow the active Recent/All window
  like the underlying scores, so they reflect current form; Progress remains
  the place for trend.
- **Not universally better:** higher carry is not treated as better across
  clubs — standings are per category, and "most reliable" is not conflated
  with "longest".

## Consequences

- PR 20 ships the decision, `bagStandings()` + tests, and the per-category
  standing line in the club profile.
- If a licensed external dataset is ever embedded (written license), an
  absolute normalization could be revisited as a new ADR; the within-bag
  standing remains valid regardless.
- Revisit only with a new ADR if a composite is ever proposed again — it must
  answer the §8.3 checklist with evidence, not weights chosen for a nicer
  number.
