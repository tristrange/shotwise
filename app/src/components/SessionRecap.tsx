import type { Basis, MetricKey, Session } from '../domain/model';
import type { sessionRecap } from '../domain/recap';
import { BasisButton } from './AnalysisControls';

type Recap = NonNullable<ReturnType<typeof sessionRecap>>;
type ClubRecap = Recap['clubs'][number];
type Carry = ClubRecap['potential']['broader'];
type Comparison = ClubRecap['flight']['speed'] | ClubRecap['flight']['curve'];
type Observation = Comparison['current'];
type Finding = Carry['finding'];
type Metric = {
  id: string;
  label: string;
  unit: string;
  comparison: Comparison & { finding?: Finding };
};

const reasons: Record<
  Extract<Finding, { kind: 'withheld' }>['reasons'][number],
  string
> = {
  'small-current-sample': 'Too few measured shots this session',
  'no-matching-history':
    'No matching earlier sessions in the comparison window',
  'small-prior-sample': 'Too few prior measurements',
  'too-few-prior-dates': 'Fewer than two baseline dates',
  'unresolved-chronology': 'Same-day session order is unclear',
  'different-venue': 'Venues differ',
  'different-shot-mix': 'The mix of shots changed',
  'different-measurement-coverage': 'Measurement coverage changed',
};

function metricGroups({
  potential,
  reliability,
  flight,
}: ClubRecap): { label: string; metrics: Metric[] }[] {
  return [
    {
      label: 'Potential',
      metrics: [
        {
          id: 'reviewed',
          label: 'Median carry · reviewed full swings with typical contact',
          unit: 'm',
          comparison: potential.reviewed,
        },
        {
          id: 'broader',
          label: 'Median carry · broader estimate',
          unit: 'm',
          comparison: potential.broader,
        },
      ],
    },
    {
      label: 'Reliability',
      metrics: [
        {
          id: 'spread',
          label: 'Carry spread · middle half (IQR)',
          unit: 'm',
          comparison: reliability.spread,
        },
        {
          id: 'lower-tail',
          label: 'Lower carry tail · 10th percentile',
          unit: 'm',
          comparison: reliability.p10,
        },
      ],
    },
    {
      label: 'Ball flight',
      metrics: [
        {
          id: 'speed',
          label: 'Median ball speed',
          unit: 'kph',
          comparison: flight.speed,
        },
        {
          id: 'launch',
          label: 'Median launch angle',
          unit: '°',
          comparison: flight.launch,
        },
        {
          id: 'apex',
          label: 'Median apex',
          unit: 'm',
          comparison: flight.apex,
        },
        {
          id: 'start',
          label: 'Start direction',
          unit: '',
          comparison: flight.launchDirection,
        },
        { id: 'curve', label: 'Curve', unit: '', comparison: flight.curve },
        {
          id: 'lateral',
          label: 'Lateral offset',
          unit: '',
          comparison: flight.lateral,
        },
      ],
    },
  ];
}

type RecapEvidence = {
  sessionId: string;
  shotIds: string[];
  key: MetricKey;
  context: string;
};

export function sessionHref(sessionId: string) {
  return `#sessions/${sessionId}`;
}

function evidenceHref(
  sessionId: string,
  club: string,
  metric: string,
  sampleId: string,
) {
  return `${sessionHref(sessionId)}?${new URLSearchParams({ club, metric, sample: sampleId })}`;
}

export function recapEvidence(
  recap: Recap,
  query: string,
): RecapEvidence | undefined {
  if (!query) return;
  const params = new URLSearchParams(query);
  const club = recap.clubs.find((item) => item.club === params.get('club'));
  if (!club) return;
  const metric = metricGroups(club)
    .flatMap((group) => group.metrics)
    .find((item) => item.id === params.get('metric'));
  if (!metric) return;
  const { comparison } = metric;
  const sample = [comparison.current, ...comparison.baseline.sessions].find(
    (item) => item.session.id === params.get('sample'),
  );
  if (!sample) return;
  return {
    sessionId: sample.session.id,
    shotIds: sample.shotIds,
    key: comparison.key,
    context: `${club.club} · ${metric.label} · ${visitLabel(sample.session)} · ${recap.basisLabel}`,
  };
}

const decimal = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat(undefined, { style: 'percent' });

export function visitLabel({ date, time }: Pick<Session, 'date' | 'time'>) {
  return time ? `${date} at ${time.slice(0, 5)}` : date;
}

function valueText(value: Observation['value'], unit: string) {
  if (value === null) return 'Unavailable';
  if (typeof value === 'number')
    return `${decimal.format(value)}${unit === '°' ? '' : ' '}${unit}`;
  return `${percent.format(value.left)} left · ${percent.format(value.straight)} straight · ${percent.format(value.right)} right`;
}

function counts({
  measured,
  missing,
}: Pick<Observation, 'measured' | 'missing'>) {
  return `${measured} measured, ${missing} missing`;
}

function findingText(metric: Metric) {
  const { comparison } = metric;
  const { finding } = comparison;
  if (!finding) return null;
  if (finding.kind === 'withheld')
    return finding.reasons.map((reason) => reasons[reason]).join('. ') + '.';
  if (finding.kind === 'mixed')
    return 'The middle half tightened while the lower carry tail fell.';
  if (finding.kind === 'not-noteworthy') {
    return finding.reason === 'within-prior-range'
      ? 'Within the range of earlier session values.'
      : 'Change below the highlight threshold.';
  }
  return null;
}

function MetricDetails({ metric, club }: { metric: Metric; club: string }) {
  const { comparison, id, label, unit } = metric;
  const { current, baseline } = comparison;
  const explanation = findingText(metric);
  return (
    <li className="recap-metric">
      <strong>{label}</strong>
      <p>
        This session · {valueText(current.value, unit)} · {counts(current)}{' '}
        {current.measured > 0 && (
          <a
            href={evidenceHref(
              current.session.id,
              club,
              id,
              current.session.id,
            )}
          >
            View supporting shots
          </a>
        )}
      </p>
      <p>
        Baseline · {valueText(baseline.value, unit)} · {counts(baseline)} ·{' '}
        {baseline.sessions.length}{' '}
        {baseline.sessions.length === 1 ? 'session' : 'sessions'} across{' '}
        {baseline.dates.length} {baseline.dates.length === 1 ? 'date' : 'dates'}
      </p>
      {baseline.sessions.length > 0 && (
        <ul className="recap-samples">
          {baseline.sessions.map((sample) => (
            <li key={sample.session.id}>
              {visitLabel(sample.session)} · {valueText(sample.value, unit)} ·{' '}
              {counts(sample)}{' '}
              <a
                href={evidenceHref(
                  current.session.id,
                  club,
                  id,
                  sample.session.id,
                )}
              >
                View supporting shots
              </a>
            </li>
          ))}
        </ul>
      )}
      {explanation && <p>{explanation}</p>}
    </li>
  );
}

function Findings({ recap }: { recap: Recap }) {
  if (!recap.included) {
    return (
      <p>
        {recap.recorded
          ? 'No included shots in this session.'
          : 'No shots recorded in this session.'}
      </p>
    );
  }
  if (!recap.clubs.length) return <p>No shots with a known club to compare.</p>;
  if (!recap.highlights.length) {
    const findings = recap.clubs.flatMap(({ potential, reliability }) => [
      potential[potential.preferred].finding,
      reliability.spread.finding,
    ]);
    if (findings.some(({ kind }) => kind === 'not-noteworthy')) {
      return <p>No noteworthy changes in the comparable metrics.</p>;
    }
    if (
      findings.some(
        (finding) =>
          finding.kind === 'withheld' &&
          (finding.reasons.includes('small-prior-sample') ||
            finding.reasons.includes('too-few-prior-dates')),
      )
    ) {
      return (
        <p>
          Sparse comparable history. Open the club details for observed values
          and comparison limits.
        </p>
      );
    }
    return (
      <p>
        There is too little comparable evidence for a finding. Open the club
        details to see why.
      </p>
    );
  }
  return (
    <ul className="recap-highlights">
      {recap.highlights.map(({ club, metric, kind, delta }) => {
        const match = recap.clubs.find((item) => item.club === club);
        if (!match) return null;
        const carry = metric === 'carry';
        const cohort = carry ? match.potential.preferred : 'spread';
        const { current, baseline } = carry
          ? match.potential[match.potential.preferred]
          : match.reliability.spread;
        const movement = carry
          ? kind === 'higher'
            ? 'longer'
            : 'shorter'
          : kind === 'higher'
            ? 'wider'
            : 'tighter';
        return (
          <li key={`${club}-${metric}`}>
            <strong>
              {club} · {carry ? 'Median carry' : 'Carry spread'}{' '}
              {decimal.format(Math.abs(delta))} m {movement}
            </strong>
            <p>
              {carry
                ? `Potential · ${cohort === 'reviewed' ? 'reviewed full swings' : 'broader estimate'}`
                : 'Reliability'}
              {' · '}
              {valueText(current.value, 'm')} from {current.measured} measured
              shots vs {valueText(baseline.value, 'm')} from {baseline.measured}{' '}
              across {baseline.dates.length} baseline dates.
              {kind === 'mixed' && ' The lower carry tail fell.'}
            </p>
            <a
              href={evidenceHref(
                recap.session.id,
                club,
                cohort,
                recap.session.id,
              )}
            >
              View supporting shots
            </a>
          </li>
        );
      })}
    </ul>
  );
}

export function SessionRecap({
  recap,
  onBasisChange,
}: {
  recap: Recap;
  onBasisChange: (basis: Basis) => void;
}) {
  return (
    <section className="session-recap" aria-labelledby="session-recap">
      <div className="recap-heading">
        <div>
          <h3 id="session-recap">Session recap</h3>
          <p>
            {visitLabel(recap.session)}
            {recap.session.venue && ` · ${recap.session.venue}`}
          </p>
        </div>
        <BasisButton basis={recap.basis} onChange={onBasisChange} />
      </div>
      <p>
        <strong>
          {recap.recorded} recorded · {recap.included} included shots
        </strong>
      </p>
      {recap.clubs.length > 0 && (
        <p>
          Known clubs with included shots ·{' '}
          {recap.clubs.map(({ club }) => club).join(', ')}
        </p>
      )}
      <Findings recap={recap} />
      {recap.clubs.map((club) => {
        const { contact } = club.reliability;
        const unknown = club.potential.broader.current.unknownIntentShare;
        return (
          <details className="recap-club" key={club.club}>
            <summary>
              {club.club} metric details · {club.included} included shots
            </summary>
            <p>Baseline values give each session equal weight.</p>
            {metricGroups(club).map(({ label, metrics }) => (
              <section key={label}>
                <h4>{label}</h4>
                {label === 'Potential' && (
                  <p>
                    The broader estimate includes unreviewed non-wedge swings
                    and leaves out reviewed mishits. Wedges require full intent.
                    {unknown !== null &&
                      ` Unknown intent accounts for ${percent.format(unknown)} of measured current carries in this estimate.`}
                  </p>
                )}
                {label === 'Reliability' && (
                  <p>
                    Includes eligible shots with mishits and unusual-shot flags.{' '}
                    {contact.mishits} confirmed mishits from {contact.reviewed}{' '}
                    contact-reviewed full swings
                    {contact.rate !== null
                      ? ` (${percent.format(contact.rate)})`
                      : ' (rate unavailable)'}
                    . Contact reviewed for {contact.reviewed} of {contact.full}{' '}
                    full swings
                    {contact.reviewedShare !== null &&
                      ` (${percent.format(contact.reviewedShare)})`}
                    .
                  </p>
                )}
                <ul className="recap-metrics">
                  {metrics.map((metric) => (
                    <MetricDetails
                      key={metric.id}
                      metric={metric}
                      club={club.club}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </details>
        );
      })}
    </section>
  );
}
