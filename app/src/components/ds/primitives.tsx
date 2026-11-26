import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost';

/** Styled native button. Keeps a real <button> for keyboard/screen-reader semantics. */
export function Button({
  variant = 'primary',
  small = false,
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  small?: boolean;
}) {
  return (
    <button
      type="button"
      className={`ds-button${variant !== 'primary' ? ` ${variant}` : ''}${small ? ' small' : ''}${className ? ` ${className}` : ''}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Icon-only button — aria-label is required so the control has an accessible name. */
export function IconButton({
  label,
  small = false,
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  small?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`ds-icon-button${small ? ' small' : ''}${className ? ` ${className}` : ''}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export type BadgeTone = 'neutral' | 'brand' | 'pos' | 'warn' | 'neg';

/**
 * Compact status label. `provisional` (dashed) and `early` (dotted) outlines
 * mirror the score-ring semantics so status is never communicated by colour
 * alone.
 */
export function Badge({
  tone = 'neutral',
  provisional = false,
  early = false,
  children,
}: {
  tone?: BadgeTone;
  provisional?: boolean;
  early?: boolean;
  children: ReactNode;
}) {
  // Tone classes are prefixed (tone-*) so they can never collide with legacy
  // app classes such as the `.brand` wordmark.
  return (
    <span
      className={`ds-badge${tone !== 'neutral' ? ` tone-${tone}` : ''}${provisional ? ' provisional' : ''}${early ? ' early' : ''}`}
    >
      {children}
    </span>
  );
}

export function Divider() {
  return <hr className="ds-divider" />;
}

export function SrOnly({ children }: { children: ReactNode }) {
  return <span className="sr-only">{children}</span>;
}

export type DivProps = HTMLAttributes<HTMLDivElement>;
