import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWindowResizer } from '../src/ui/window-resizer';

test('corner drag coalesces host requests and persists final dimensions on release', async () => {
  const events = new Map<string, (event: any) => void>();
  let captured = false;
  const root = {
    addEventListener: (name: string, fn: any) => events.set(name, fn),
    setPointerCapture: () => {
      captured = true;
    },
    hasPointerCapture: () => captured,
    releasePointerCapture: () => {
      captured = false;
    },
  } as unknown as HTMLElement;
  const sent: unknown[] = [];
  let release!: () => void;
  createWindowResizer(
    root,
    () => ({ width: 440, height: 720 }),
    async (size, persist) => {
      sent.push({ ...size, persist });
      if (sent.length === 1)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
    },
    (cause) => {
      throw cause;
    },
  );
  events.get('pointerdown')!({
    button: 0,
    pointerId: 1,
    screenX: 400,
    screenY: 700,
    target: { closest: () => ({}) },
    preventDefault: () => {},
  });
  events.get('pointermove')!({ pointerId: 1, screenX: 450, screenY: 750 });
  events.get('pointermove')!({ pointerId: 1, screenX: 500, screenY: 780 });
  events.get('pointermove')!({ pointerId: 1, screenX: 550, screenY: 800 });
  events.get('pointerup')!({ type: 'pointerup', pointerId: 1, screenX: 580, screenY: 810 });
  assert.equal(captured, false);
  assert.equal(sent.length, 1);
  release();
  await new Promise(setImmediate);
  assert.deepEqual(sent, [
    { width: 490, height: 770, persist: false },
    { width: 620, height: 830, persist: true },
  ]);
  events.get('pointermove')!({ pointerId: 1, screenX: 700, screenY: 900 });
  assert.equal(sent.length, 2);
});
