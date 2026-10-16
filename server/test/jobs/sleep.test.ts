import { getEventListeners } from 'node:events';
import { expect, it } from 'vitest';
import { abortableSleep } from '../../src/jobs/sleep.js';

it('leaves no abort listener after a normal timeout', async () => {
  const ac = new AbortController();
  await abortableSleep(5, ac.signal);
  expect(getEventListeners(ac.signal, 'abort')).toHaveLength(0);
});

it('resolves early on abort and leaves no listener', async () => {
  const ac = new AbortController();
  const t0 = Date.now();
  const p = abortableSleep(10_000, ac.signal);
  ac.abort();
  await p;
  expect(Date.now() - t0).toBeLessThan(2000);
  expect(getEventListeners(ac.signal, 'abort')).toHaveLength(0);
});

it('resolves immediately when already aborted', async () => {
  const ac = new AbortController();
  ac.abort();
  await abortableSleep(10_000, ac.signal);
});
