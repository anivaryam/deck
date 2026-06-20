import { describe, it, expect } from 'vitest';
import { QA_DIMENSIONS } from '../src/store.ts';
import { DIMENSION_RUBRICS } from '../src/goalRunner.ts';

describe('QA dimension consistency', () => {
  it('every allowlisted dimension has a rubric', () => {
    for (const d of QA_DIMENSIONS) expect(DIMENSION_RUBRICS[d], `missing rubric for ${d}`).toBeTruthy();
  });
  it('every rubric is an allowlisted dimension', () => {
    for (const d of Object.keys(DIMENSION_RUBRICS)) expect((QA_DIMENSIONS as readonly string[]).includes(d), `rubric ${d} not in allowlist`).toBe(true);
  });
});
