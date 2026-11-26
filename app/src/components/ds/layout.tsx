import type { HTMLAttributes, ReactNode } from 'react';

export function Card({
  className = '',
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`ds-card${className ? ` ${className}` : ''}`} {...rest}>
      {children}
    </div>
  );
}

export function SectionHeader({
  title,
  sub,
  aside,
  level = 2,
}: {
  title: string;
  sub?: string;
  aside?: ReactNode;
  level?: 2 | 3;
}) {
  const Tag = level === 2 ? 'h2' : 'h3';
  return (
    <div className="ds-section-header">
      <div>
        <Tag>{title}</Tag>
        {sub && <div className="ds-section-sub">{sub}</div>}
      </div>
      {aside}
    </div>
  );
}

/** One headline number with a muted unit and optional signed delta. */
export function Metric({
  label,
  value,
  unit,
  delta,
  deltaTone = 'neutral',
  small = false,
}: {
  label: ReactNode;
  value: ReactNode;
  unit?: string;
  delta?: ReactNode;
  deltaTone?: 'pos' | 'neg' | 'neutral';
  small?: boolean;
}) {
  return (
    <div className="ds-metric">
      <span className="ds-metric-label">{label}</span>
      <span className={`ds-metric-value${small ? ' small' : ''}`}>
        {value}
        {unit && <span className="ds-metric-unit">{unit}</span>}
      </span>
      {delta && <span className={`ds-metric-delta ${deltaTone}`}>{delta}</span>}
    </div>
  );
}

export function MetricGrid({ children }: { children: ReactNode }) {
  return <div className="ds-metric-grid">{children}</div>;
}

export function EmptyState({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="ds-empty">
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="ds-loading" role="status">
      {label}
    </div>
  );
}
