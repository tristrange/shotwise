import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { HelpCircle } from 'lucide-react';
import { Button } from './primitives';

/**
 * Contextual help: an icon button that opens a small popover with methodology
 * or sample details on demand — keeps dense evidence out of the main view.
 * Closes on outside click and Escape; the button carries aria-expanded.
 * The popover is clamped to the viewport on open so left-edge triggers (e.g.
 * next to a withheld composite on a phone) never push it off-screen.
 */
export function HelpPopover({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<CSSProperties>({});
  const rootRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverId = useId();
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const width = Math.min(300, window.innerWidth - 16);
    const left = Math.min(
      Math.max(8, rect.right - width),
      Math.max(8, window.innerWidth - width - 8),
    );
    setPlacement({ top: rect.bottom + 8, left, width });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node))
        setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);
  return (
    <span className="ds-help" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="ds-icon-button small ds-help-button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <HelpCircle size={15} aria-hidden="true" />
      </button>
      {open && (
        <span
          id={popoverId}
          role="region"
          aria-label={label}
          className="ds-help-popover"
          style={placement}
        >
          {children}
        </span>
      )}
    </span>
  );
}

/** Styled <details> — progressive disclosure for methodology and long text. */
export function Disclosure({
  summary,
  children,
  className = '',
}: {
  summary: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details className={`ds-disclosure${className ? ` ${className}` : ''}`}>
      <summary>{summary}</summary>
      <div>{children}</div>
    </details>
  );
}

/**
 * Modal dialog on the native <dialog> element: focus trap, Escape and
 * backdrop click come from the platform. `open` is controlled by the parent.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="ds-dialog"
      aria-labelledby={titleId}
      onClose={onClose}
    >
      <h3 id={titleId}>{title}</h3>
      <div>{children}</div>
      {actions ?? (
        <div className="ds-dialog-actions">
          <Button variant="secondary" small onClick={onClose}>
            Close
          </Button>
        </div>
      )}
    </dialog>
  );
}
