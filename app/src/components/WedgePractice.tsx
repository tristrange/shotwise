import type { AnalysisQuery } from '../domain/analytics';
import { BASES, type Basis, type Dataset } from '../domain/model';
import { wedgePractice } from '../domain/wedgePractice';
import { sessionHref } from './SessionRecap';

type WedgeGroup = ReturnType<typeof wedgePractice>['groups'][number];
const decimal = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const exact = new Intl.NumberFormat(undefined, {
  maximumSignificantDigits: 21,
});
const intentLabels = { full: 'Full', partial: 'Partial', unknown: 'Unknown' };

function metres(value: number | null) {
  return value === null ? 'Missing' : `${decimal.format(value)} m`;
}

function WedgeGroupSummary({
  group,
  basis,
  sessions,
}: {
  group: WedgeGroup;
  basis: Basis;
  sessions: ReadonlyMap<string, Dataset['sessions'][number]>;
}) {
  const { carry, speed, launch, apex, shots, direction, intentCounts } = group;
  const name =
    group.kind === 'target'
      ? `${group.club} · ${exact.format(group.target)} m target`
      : `${group.club} · ${intentLabels[group.intent]} intent`;
  const flight = [
    { label: 'Median launch', metric: launch, unit: '°' },
    { label: 'Median ball speed', metric: speed, unit: ' kph' },
    { label: 'Median apex', metric: apex, unit: ' m' },
  ];
  const directions = [
    { label: 'Launch direction', metric: direction.launch },
    { label: 'Curve', metric: direction.curve },
    { label: 'From Centre', metric: direction.lateral },
  ];

  return (
    <article className="wedge-group" aria-label={name}>
      <h4>{name}</h4>
      <p>
        {shots.length} {shots.length === 1 ? 'shot' : 'shots'} · {group.visits}{' '}
        {group.visits === 1 ? 'session' : 'sessions'}
        {group.kind === 'target' &&
          ` · ${intentCounts.full} full, ${intentCounts.partial} partial, ${intentCounts.unknown} unknown intent`}
      </p>
      <p>
        <strong>
          Median carry{' '}
          {carry.median === null ? 'unavailable' : metres(carry.median)}
        </strong>
        {' · '}
        {carry.n} of {shots.length} measured
        {carry.iqr === null
          ? ' · Carry spread needs 4 measured shots'
          : ` · Middle half spans ${metres(carry.iqr)}`}
      </p>
      {flight.some(({ metric }) => metric.median !== null) && (
        <ul className="wedge-metrics">
          {flight.map(
            ({ label, metric, unit }) =>
              metric.median !== null && (
                <li key={label}>
                  {label} {decimal.format(metric.median)}
                  {unit} · {metric.n} of {shots.length} measured
                </li>
              ),
          )}
        </ul>
      )}
      {directions.some(({ metric }) => metric.n > 0) && (
        <>
          <p>
            Recorded direction · {group.aimed} target{' '}
            {group.aimed === 1 ? 'shot' : 'shots'} with proximity
          </p>
          <ul className="wedge-metrics">
            {directions.map(
              ({ label, metric }) =>
                metric.n > 0 && (
                  <li key={label}>
                    {label} · {metric.left} left, {metric.straight} centred,{' '}
                    {metric.right} right · {metric.n} of {group.aimed} measured
                  </li>
                ),
            )}
          </ul>
        </>
      )}
      <details>
        <summary>
          View {shots.length} shot {shots.length === 1 ? 'row' : 'rows'}
        </summary>
        <div
          className="table-wrap"
          role="region"
          aria-label={`${name} shot rows`}
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard focus enables horizontal scrolling.
          tabIndex={0}
        >
          <table aria-label={`${name} shots`}>
            <thead>
              <tr>
                <th scope="col">Session</th>
                <th scope="col">Source row</th>
                <th scope="col">Intent</th>
                <th scope="col">Recorded target</th>
                <th scope="col">Carry</th>
              </tr>
            </thead>
            <tbody>
              {shots.map((shot) => {
                const session = sessions.get(shot.sessionId);
                const target = shot.measurements.target;
                return (
                  <tr key={shot.id}>
                    <td>
                      {session && (
                        <a
                          href={sessionHref(session.id)}
                          title={session.filename}
                        >
                          {session.date}
                          {session.time && ` · ${session.time.slice(0, 5)}`}
                        </a>
                      )}
                    </td>
                    <td>{shot.rowIndex}</td>
                    <td>{intentLabels[shot.review.intent]}</td>
                    <td>
                      {target === null || target < 0
                        ? 'Missing'
                        : `${exact.format(target)} m`}
                    </td>
                    <td>{metres(shot.measurements[BASES[basis].carry])}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </article>
  );
}

export function WedgePractice({
  data,
  basis,
  query,
}: {
  data: Dataset;
  basis: Basis;
  query: AnalysisQuery;
}) {
  const { total, targeted, missingTarget, zeroTarget, groups } = wedgePractice(
    data,
    basis,
    query,
  );
  const sessions = new Map(
    data.sessions.map((session) => [session.id, session]),
  );
  return (
    <section className="panel wedge-practice" aria-labelledby="wedge-practice">
      <div className="panel-heading">
        <div>
          <h2 id="wedge-practice">Wedge practice</h2>
          <p className="context">
            {query.mode === 'recent' ? 'Recent' : 'All-time'} ·{' '}
            {BASES[basis].label}
          </p>
        </div>
      </div>
      {total === 0 ? (
        <p>No wedge shots in this view.</p>
      ) : (
        <>
          <p>
            <strong>
              {targeted} of {total} wedge shots have a recorded target
            </strong>
          </p>
          <p>
            {missingTarget} missing target · {zeroTarget} recorded as 0 m. Both
            are grouped by shot intent.
          </p>
          {targeted > 0 && (
            <p>
              Target distance and carry are shown side by side. The carry
              reference for calculating target error is unverified.
            </p>
          )}
          <h3>Recorded targets</h3>
          {targeted === 0 && (
            <p>No positive target distances in these shots.</p>
          )}
          {groups
            .filter((group) => group.kind === 'target')
            .map((group) => (
              <WedgeGroupSummary
                key={JSON.stringify([group.club, group.target])}
                group={group}
                basis={basis}
                sessions={sessions}
              />
            ))}
          <h3>Shots without a target</h3>
          {targeted === total && (
            <p>Every wedge shot in this view has a positive target.</p>
          )}
          {groups
            .filter((group) => group.kind === 'intent')
            .map((group) => (
              <WedgeGroupSummary
                key={JSON.stringify([group.club, group.intent])}
                group={group}
                basis={basis}
                sessions={sessions}
              />
            ))}
        </>
      )}
    </section>
  );
}
