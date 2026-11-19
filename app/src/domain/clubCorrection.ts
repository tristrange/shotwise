import {
  clubDecisionSchema,
  effectiveClub,
  type Review,
  type Session,
  type Shot,
} from './model';

type PinnedCorrectionShot = {
  shotId: string;
  rowIndex: number;
  sourceNumber: string;
  expectedRevision: number;
  review: Review;
  oldLabel: string;
};

type CorrectionRowStatus =
  'eligible' | 'skipped-reviewed' | 'skipped-same-label';

export type CorrectionPreview = {
  sessionLabel: string;
  proposedClub: string;
  includeReviewed: boolean;
  shots: PinnedCorrectionShot[];
};

export function pinCorrectionShot(shot: Shot): PinnedCorrectionShot {
  return {
    shotId: shot.id,
    rowIndex: shot.rowIndex,
    sourceNumber: shot.sourceNumber,
    expectedRevision: shot.revision,
    review: shot.review,
    oldLabel: effectiveClub(shot),
  };
}

export function sessionIdentity(session: Session): string {
  return `${session.filename} · ${session.date}${session.time ? ` · ${session.time}` : ''}`;
}

export function validateCorrectedClub(
  input: string,
): { ok: true; club: string } | { ok: false; message: string } {
  const result = clubDecisionSchema.safeParse({
    kind: 'corrected',
    club: input,
  });
  if (result.success && result.data.kind === 'corrected')
    return { ok: true, club: result.data.club };
  return {
    ok: false,
    message: 'Enter a corrected club with 1 to 30 characters.',
  };
}

export function correctionRowStatus(
  pinned: PinnedCorrectionShot,
  proposedClub: string,
  includeReviewed: boolean,
): CorrectionRowStatus {
  if (!includeReviewed && pinned.review.club.kind !== 'unreviewed')
    return 'skipped-reviewed';
  if (pinned.oldLabel.trim().toLowerCase() === proposedClub.toLowerCase())
    return 'skipped-same-label';
  return 'eligible';
}
