# Shotwise glossary

Vocabulary for shot data and assessment. See `docs/adr/0001-shot-assessment-precedence.md`
for the precedence policy these terms rely on.

- **Recorded club** — the club label exactly as exported by Inrange. Immutable.
- **Effective club** — the club used by manual-only views: the manual
  correction if present, otherwise the recorded club (`effectiveClub()`).
- **Inferred club** — a provisional club proposed by the automatic classifier
  (e.g. from sequence context). Never overwrites the recorded label; always
  shown as provisional.
- **Shot intent** — `full` / `partial` / `unknown`; whether the golfer meant a
  full swing. Independent of contact quality.
- **Contact** — `typical` / `mishit` / `uncertain`; strike quality.
  Independent of intent and club.
- **Exclusion** — whether a shot is included in analytics, with a reason.
  Independent of the other dimensions.
- **Full-swing candidate** — a shot eligible for full-swing benchmarks:
  explicitly reviewed `full`, or unreviewed on a non-wedge club (PW counts as
  iron-style since #58; higher wedges need explicit `full`).
- **Measurement basis** — which Inrange columns are read (range/premium ×
  flat/raw); see `BASES` in `app/src/domain/model.ts`.
- **Assessment provenance** — `recorded` (Inrange), `manual` (user review),
  or `automatic` (versioned classifier). Manual > automatic > recorded.
- **Classifier version** — version string stamped on automatic assessments so
  algorithms can be compared and manual decisions stay stable across upgrades.
