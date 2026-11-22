import { TimeClass } from '@prisma/client';

/** Categories every account starts with. `timeClass` decides how analytics and leakage detection treat the time. */
export const DEFAULT_CATEGORIES: { key: string; name: string; color: string; timeClass: TimeClass; isCommitment: boolean }[] = [
  { key: 'work', name: 'Work', color: '#B5F34D', timeClass: 'PRODUCTIVE', isCommitment: false },
  { key: 'learning', name: 'Learning', color: '#8B7CF8', timeClass: 'PRODUCTIVE', isCommitment: false },
  { key: 'meetings', name: 'Meetings', color: '#FF7A45', timeClass: 'PRODUCTIVE', isCommitment: true },
  { key: 'personal', name: 'Personal', color: '#4CC9F0', timeClass: 'NEUTRAL', isCommitment: false },
  { key: 'exercise', name: 'Exercise', color: '#2DD4BF', timeClass: 'NEUTRAL', isCommitment: false },
  { key: 'rest', name: 'Rest', color: '#9AA5B1', timeClass: 'REST', isCommitment: false },
  { key: 'entertainment', name: 'Entertainment', color: '#F472B6', timeClass: 'LEISURE', isCommitment: false },
  { key: 'other', name: 'Other', color: '#E9C46A', timeClass: 'NEUTRAL', isCommitment: false },
];

