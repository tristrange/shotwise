import { useEffect } from 'react';

const reduced = () =>
  typeof matchMedia === 'function' &&
  matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Scroll-entry motion for the editorial view. Sections fade/rise once; coloured
 * chart marks sweep in left-to-right. Reduced-motion users see the static page.
 * Re-runs when `key` changes (page or dataset swap).
 */
export function useScrollReveal(key: string) {
  useEffect(() => {
    if (reduced()) return;
    const root = document.querySelector<HTMLElement>('.main-content');
    if (!root) return;

    // Reveal figure-sized blocks, not whole panels: a tall panel entering the
    // viewport would otherwise animate charts that are still far below the fold.
    const REVEAL =
      '.hero.reveal, .statstrip.reveal, .panel-heading, .gap-list, .table-wrap, .insight-list, .progress-plots, .shape-club, .shape-detail, .session-list, .shot, .suggestion-row, .notice';
    const targets = root.querySelectorAll<HTMLElement>(REVEAL);
    const teardown: (() => void)[] = [];

    targets.forEach((target) => {
      // Skip nested units (the outer one handles them) and collapsed tables.
      if (target.parentElement?.closest(REVEAL)) return;
      if (target.closest('details')) return;

      const marks = target.querySelectorAll<SVGElement>(
        '.gap-band, .gap-dot, .shape-point, .progress-plot svg rect, .hero-lanes path, .review .pill',
      );
      const options = { duration: 900, easing: 'cubic-bezier(.22,.7,.24,1)', fill: 'both' as const };
      const animations: Animation[] = [];

      const section = target.animate(
        [
          { opacity: 0, transform: 'translateY(14px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ],
        options,
      );
      section.pause();
      section.currentTime = 0;
      animations.push(section);

      marks.forEach((mark, i) => {
        const animation = mark.animate(
          [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)' }],
          { ...options, delay: Math.min(i * 35, 420) },
        );
        animation.pause();
        animation.currentTime = 0;
        animations.push(animation);
      });

      const observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          observer.disconnect();
          animations.forEach((animation) => void animation.play());
          void Promise.all(animations.map((a) => a.finished.catch(() => {}))).then(
            () => animations.forEach((a) => a.cancel()),
          );
        },
        { rootMargin: '0px 0px -6% 0px', threshold: 0.06 },
      );
      observer.observe(target);
      teardown.push(() => {
        observer.disconnect();
        animations.forEach((animation) => animation.cancel());
      });
    });

    return () => teardown.forEach((stop) => stop());
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- key is an intentional re-run trigger, not a value read in the effect.
  }, [key]);
}
