import { describe, it, expect, beforeEach } from 'vitest';
import { Store } from '../src/store.ts';
import { deckToolNames, goalReportHandler } from '../src/deckTools.ts';

let store: Store;
beforeEach(() => { store = new Store(':memory:'); });

describe('goal_report tool', () => {
  it('exposes goal_report only when a goalId is present', () => {
    expect(deckToolNames(undefined, undefined)).not.toContain('goal_report');
    expect(deckToolNames(undefined, 'g1')).toContain('goal_report');
  });

  it('persists the report payload to the goal row', async () => {
    const g = store.createGoal({ projectPath: '/p', title: 'T', expectedOutput: 'x' });
    const res = await goalReportHandler(store, g.id, {
      summary: 'built it', goal_met: true, files_changed: ['a.ts'],
      commands_run: [{ cmd: 'npm test', exit_code: 0, output_tail: 'ok' }], incomplete: [],
    });
    expect(res.content[0].text).toMatch(/recorded/i);
    const report = JSON.parse(store.getGoal(g.id)!.report!);
    expect(report.goal_met).toBe(true);
    expect(report.files_changed).toEqual(['a.ts']);
  });
});
