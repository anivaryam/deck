import type { Store, SessionOrigin } from './store.ts';
import type { SessionManager } from './sessionManager.ts';

export class TaskRunner {
  private active = 0;

  constructor(
    private store: Store,
    private manager: Pick<SessionManager, 'send'>,
    private maxConcurrent = 6,
  ) {}

  /** Create a task session and fire its single prompt in the background. Returns the
   *  session id immediately. A global concurrency cap bounds resource/quota use
   *  (denial-of-wallet protection); over the cap the task is recorded as errored
   *  instead of started. */
  run(input: { projectPath: string; prompt: string; origin: SessionOrigin; title?: string; model?: string }): string {
    const task = this.store.createTask(input);

    if (this.active >= this.maxConcurrent) {
      this.store.appendEvent(task.id, {
        sdkUuid: null,
        type: 'error',
        payload: { message: `task queue full (max ${this.maxConcurrent} concurrent) — not started` },
      });
      this.store.setStatus(task.id, 'errored');
      return task.id;
    }

    this.active += 1;
    // Fire-and-forget: SessionManager records success/error + status itself. We log
    // any failure that escapes that path (e.g. a throw before recording) so it isn't
    // swallowed silently, and always release the concurrency slot.
    void this.manager
      .send(task.id, input.prompt)
      .catch((e) => {
        console.error(`[taskRunner] task ${task.id} failed:`, e instanceof Error ? e.message : e);
      })
      .finally(() => {
        this.active -= 1;
      });
    return task.id;
  }
}
