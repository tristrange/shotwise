import { z } from 'zod';
import {
  practiceInsights,
  type AnalysisSettings,
  type PracticeEvidence,
  type PracticeInsight,
} from '../domain/analytics';
import {
  BASES,
  basisSchema,
  localToday,
  reviewSchema,
  type Dataset,
} from '../domain/model';
import { sessionHref } from './SessionRecap';

const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const linkSettings = z.object({
  basis: basisSchema,
  mode: z.enum(['recent', 'all']),
  intent: reviewSchema.shape.intent.or(z.literal('all')),
  contact: z.enum(['all', 'typical']),
  hide: z.enum(['true', 'false']),
});

function practiceHref(
  id: string,
  sessionId: string,
  settings: AnalysisSettings,
) {
  const { basis, mode, intent, contact, hideLikelyMishits } = settings;
  const query = new URLSearchParams({
    practice: id,
    basis,
    mode,
    intent,
    contact,
    hide: String(hideLikelyMishits ?? false),
  });
  return `${sessionHref(sessionId)}?${query}`;
}

export function resolvePracticeEvidence(
  data: Dataset,
  sessionId: string,
  params: URLSearchParams,
) {
  const parsed = linkSettings.safeParse(Object.fromEntries(params));
  if (!parsed.success) return;
  const { basis, hide, ...filters } = parsed.data;
  const insight = practiceInsights(data, basis, {
    ...filters,
    hideLikelyMishits: hide === 'true',
    today: localToday(),
  }).find(({ id }) => id === params.get('practice'));
  const sample = insight?.evidence.find(
    ({ session }) => session.id === sessionId,
  );
  if (!sample) return;
  return {
    sessionId,
    shotIds: sample.shotIds,
    key: sample.key,
    context: `${title(sample)} · ${visitLabel(sample)} · ${sample.kind === 'direction' ? 'Recorded curve' : BASES[basis].label}`,
  };
}

function title(sample: PracticeEvidence) {
  switch (sample.kind) {
    case 'gapping':
      return `${sample.longer.club} and ${sample.shorter.club} · ${sample.gap < 0 ? 'Reversed median gap' : 'Small median gap'}`;
    case 'inconsistency':
      return `${sample.carry.club} · Wide carry spread`;
    case 'direction':
      return `${sample.club} · Repeated ${sample.side} curve`;
  }
}

function task(sample: PracticeEvidence) {
  switch (sample.kind) {
    case 'gapping':
      return `Alternate ${sample.longer.club} and ${sample.shorter.club} at the same aim line and compare their median carries.`;
    case 'inconsistency':
      return `Hit a set of ${sample.carry.club} shots to one target with the same setup and record the carry spread.`;
    case 'direction':
      return `Hit a set of ${sample.club} shots along one aim line and tally how many bend ${sample.side}.`;
  }
}

function coverage({
  shotIds,
  missing,
}: {
  shotIds: string[];
  missing: number;
}) {
  return missing
    ? `${shotIds.length} measured, ${missing} missing`
    : `${shotIds.length} measured`;
}

function measurements(sample: PracticeEvidence) {
  switch (sample.kind) {
    case 'gapping': {
      const { longer, shorter } = sample;
      return `${longer.club} median ${number.format(longer.median)} m (${coverage(longer)}), ${shorter.club} median ${number.format(shorter.median)} m (${coverage(shorter)})`;
    }
    case 'inconsistency':
      return `Middle half spans ${number.format(sample.carry.iqr)} m around a median of ${number.format(sample.carry.median)} m (${coverage(sample.carry)})`;
    case 'direction':
      return `${sample.count} of ${sample.shotIds.length} measured curves bend ${sample.side}${sample.missing ? ` (${sample.missing} missing)` : ''}`;
  }
}

function visitLabel({ session }: PracticeEvidence) {
  return session.time
    ? `${session.date} at ${session.time.slice(0, 5)}`
    : session.date;
}

function PracticeAction({
  insight,
  settings,
}: {
  insight: PracticeInsight;
  settings: AnalysisSettings;
}) {
  const [latest, ...others] = insight.evidence;
  return (
    <li className="insight">
      <h3>{title(latest)}</h3>
      <p>{task(latest)}</p>
      <p className="insight-context">
        {insight.dates} dates · {insight.shots} measured shots
        {latest.session.venue && ` · ${latest.session.venue}`}
      </p>
      <p>
        {visitLabel(latest)} · {measurements(latest)}.
      </p>
      {insight.improving && (
        <p>Two newer comparable dates cleared this threshold.</p>
      )}
      <a href={practiceHref(insight.id, latest.session.id, settings)}>
        View latest supporting shots
      </a>
      <details>
        <summary>Other supporting visits</summary>
        <ul>
          {others.map((sample) => (
            <li key={sample.session.id}>
              {visitLabel(sample)} · {measurements(sample)}.{' '}
              <a href={practiceHref(insight.id, sample.session.id, settings)}>
                View supporting shots
              </a>
            </li>
          ))}
        </ul>
      </details>
    </li>
  );
}

export function PracticeInsights({
  data,
  settings,
  overview = false,
}: {
  data: Dataset;
  settings: AnalysisSettings;
  overview?: boolean;
}) {
  const { basis, ...filters } = settings;
  const insights = practiceInsights(data, basis, {
    ...filters,
    today: localToday(),
  });
  const shown = overview ? insights.slice(0, 3) : insights;
  return (
    <section
      className="panel practice-insights"
      aria-labelledby="practice-insights"
    >
      <div className="panel-heading">
        <div>
          <h2 id="practice-insights">
            {overview ? 'Next practice' : 'Practice insights'}
          </h2>
          <p className="context">
            {settings.mode === 'recent' ? 'Last 60 days' : 'All-time'} ·{' '}
            {BASES[basis].label}
            {settings.hideLikelyMishits && ' · Unusual-shot filter on'}
          </p>
        </div>
        {overview && insights.length > shown.length && (
          <a href="#gapping">See all in Gapping</a>
        )}
      </div>
      {shown.length ? (
        <ol className="insight-list">
          {shown.map((insight) => (
            <PracticeAction
              key={insight.id}
              insight={insight}
              settings={settings}
            />
          ))}
        </ol>
      ) : (
        <p>
          No recurring practice patterns yet. Each recommendation needs
          comparable measurements on at least two dates.
        </p>
      )}
    </section>
  );
}
