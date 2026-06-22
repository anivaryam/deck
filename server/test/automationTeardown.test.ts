import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { registerTicketAutomation } from '../src/ticketAutomation.ts';
import { registerGoalAutomation } from '../src/goalRunner.ts';
import { registerWs } from '../src/wsHub.ts';

// These automations + the WS hub attach long-lived listeners to the SessionManager
// EventEmitter. Each register* now returns a disposer (the WS hub via .dispose())
// so server shutdown can detach them and they don't leak across reinstantiation.

describe('automation listener teardown', () => {
  it('registerTicketAutomation disposer removes its task listener', () => {
    const em = new EventEmitter();
    expect(em.listenerCount('task')).toBe(0);
    const dispose = registerTicketAutomation(em as any, {} as any);
    expect(em.listenerCount('task')).toBe(1);
    dispose();
    expect(em.listenerCount('task')).toBe(0);
  });

  it('registerGoalAutomation disposer removes its task listener', () => {
    const em = new EventEmitter();
    const verifier = { start() {}, startVerification() {}, startNextVerifier() {} };
    const dispose = registerGoalAutomation(em as any, {} as any, verifier);
    expect(em.listenerCount('task')).toBe(1);
    dispose();
    expect(em.listenerCount('task')).toBe(0);
  });

  it('registerWs dispose() removes both the event and task listeners', () => {
    const em = new EventEmitter();
    const app = { get() {} }; // registerWs only touches app.get for route registration
    const { dispose } = registerWs(app as any, {
      store: {} as any,
      manager: em as any,
      config: {} as any,
      auth: {} as any,
    });
    expect(em.listenerCount('event')).toBe(1);
    expect(em.listenerCount('task')).toBe(1);
    dispose();
    expect(em.listenerCount('event')).toBe(0);
    expect(em.listenerCount('task')).toBe(0);
  });
});
