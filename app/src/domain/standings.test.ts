import { describe, expect, it } from 'vitest';
import { CATEGORY_SCORE_ORDER, type CategoryScore, type CategoryScores } from './scores';
import { bagStandings, ordinal } from './standings';

function score(
  id: CategoryScore['id'],
  value: number | null,
  overrides: Partial<CategoryScore> = {},
): CategoryScore {
  return {
    id,
    label: id,
    value,
    unit: 'm',
    betterDirection: 'higher',
    n: 12,
    sufficient: value !== null,
    note: null,
    ...overrides,
  };
}

function scores(partial: Partial<CategoryScores>): CategoryScores {
  return {
    distancePotential: score('distancePotential', null),
    consistency: score('consistency', null, { betterDirection: 'lower' }),
    directionalControl: score('directionalControl', null, {
      betterDirection: 'lower',
      unit: 'deg',
    }),
    reliability: score('reliability', null, {
      betterDirection: 'lower',
      unit: 'share',
    }),
    ...partial,
  };
}

describe('bagStandings', () => {
  it('ranks higher-is-better categories descending', () => {
    const standings = bagStandings([
      {
        club: '7i',
        scores: scores({
          distancePotential: score('distancePotential', 150),
        }),
      },
      {
        club: '5i',
        scores: scores({
          distancePotential: score('distancePotential', 170),
        }),
      },
      {
        club: '9i',
        scores: scores({
          distancePotential: score('distancePotential', 130),
        }),
      },
    ]);
    expect(standings['5i']?.distancePotential).toEqual({ rank: 1, of: 3 });
    expect(standings['7i']?.distancePotential).toEqual({ rank: 2, of: 3 });
    expect(standings['9i']?.distancePotential).toEqual({ rank: 3, of: 3 });
  });

  it('ranks lower-is-better categories ascending', () => {
    const standings = bagStandings([
      {
        club: '7i',
        scores: scores({ consistency: score('consistency', 6, { betterDirection: 'lower' }) }),
      },
      {
        club: '5i',
        scores: scores({ consistency: score('consistency', 2, { betterDirection: 'lower' }) }),
      },
    ]);
    expect(standings['5i']?.consistency).toEqual({ rank: 1, of: 2 });
    expect(standings['7i']?.consistency).toEqual({ rank: 2, of: 2 });
  });

  it('gives tied clubs the same rank and skips the next rank', () => {
    const standings = bagStandings([
      {
        club: 'a',
        scores: scores({ reliability: score('reliability', 0.1, { betterDirection: 'lower', unit: 'share' }) }),
      },
      {
        club: 'b',
        scores: scores({ reliability: score('reliability', 0.1, { betterDirection: 'lower', unit: 'share' }) }),
      },
      {
        club: 'c',
        scores: scores({ reliability: score('reliability', 0.3, { betterDirection: 'lower', unit: 'share' }) }),
      },
    ]);
    expect(standings['a']?.reliability).toEqual({ rank: 1, of: 3 });
    expect(standings['b']?.reliability).toEqual({ rank: 1, of: 3 });
    expect(standings['c']?.reliability).toEqual({ rank: 3, of: 3 });
  });

  it('gives no standing for insufficient categories, and excludes them from "of"', () => {
    const standings = bagStandings([
      {
        club: '7i',
        scores: scores({
          distancePotential: score('distancePotential', 150),
          directionalControl: score('directionalControl', null, {
            sufficient: false,
            betterDirection: 'lower',
            unit: 'deg',
          }),
        }),
      },
      {
        club: '5i',
        scores: scores({
          distancePotential: score('distancePotential', 170),
          directionalControl: score('directionalControl', 3, {
            sufficient: true,
            betterDirection: 'lower',
            unit: 'deg',
          }),
        }),
      },
    ]);
    expect(standings['7i']?.directionalControl).toBeNull();
    expect(standings['5i']?.directionalControl).toEqual({ rank: 1, of: 1 });
    expect(standings['7i']?.distancePotential?.of).toBe(2);
  });

  it('covers every category id', () => {
    const standings = bagStandings([{ club: '7i', scores: scores({}) }]);
    expect(Object.keys(standings['7i'] ?? {}).sort()).toEqual(
      [...CATEGORY_SCORE_ORDER].sort(),
    );
  });
});

describe('ordinal', () => {
  it('formats ordinals', () => {
    expect(ordinal(1)).toBe('1st');
    expect(ordinal(2)).toBe('2nd');
    expect(ordinal(3)).toBe('3rd');
    expect(ordinal(4)).toBe('4th');
    expect(ordinal(11)).toBe('11th');
    expect(ordinal(12)).toBe('12th');
    expect(ordinal(13)).toBe('13th');
    expect(ordinal(21)).toBe('21st');
    expect(ordinal(22)).toBe('22nd');
    expect(ordinal(23)).toBe('23rd');
  });
});
