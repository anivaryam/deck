import { Cron } from 'croner';
import type { Store } from './store.ts';
import type { TaskRunner } from './taskRunner.ts';

export class Scheduler {
  private jobs = new Map<string, Cron>();
  constructor(private store: Store, private runner: Pick<TaskRunner, 'run'>) {}

  static isValid(expr: string): boolean {
    try { new Cron(expr, { paused: true }); return true; } catch { return false; }
  }

  /** (Re)register all enabled cron rows. Call on boot and after any cron CRUD. */
  reload(): void {
    for (const job of this.jobs.values()) job.stop();
    this.jobs.clear();
    for (const c of this.store.listEnabledCron()) {
      try { this.jobs.set(c.id, new Cron(c.schedule, () => this.fireCron(c.id))); } catch { /* skip bad expr */ }
    }
  }

  /** Run one cron now (used by the scheduled callback and by tests). No-op if disabled/missing. */
  fireCron(id: string): void {
    const c = this.store.getCron(id);
    if (!c || c.enabled !== 1) return;
    const sessionId = this.runner.run({ projectPath: c.project_path, prompt: c.prompt, origin: 'cron', sourceKind: 'cron', sourceId: c.id });
    this.store.recordCronRun(id, sessionId);
  }

  stop(): void { for (const job of this.jobs.values()) job.stop(); this.jobs.clear(); }
}
