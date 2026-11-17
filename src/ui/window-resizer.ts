import { WindowSize, windowSize } from '../core/window-size';

// Keep the app DOM intact while resizing so table focus and scroll survive.
export function createWindowResizer(
  root: HTMLElement,
  current: () => WindowSize,
  resize: (size: WindowSize, persist: boolean) => Promise<void>,
  failed: (cause: unknown) => void,
) {
  let drag: { id: number; x: number; y: number; size: WindowSize } | undefined;
  let latest = current();
  let queued: { size: WindowSize; persist: boolean } | undefined;
  let sending = false;
  async function flush() {
    if (sending) return;
    sending = true;
    try {
      while (queued) {
        const next = queued;
        queued = undefined;
        await resize(next.size, next.persist);
      }
    } catch (cause) {
      queued = undefined;
      failed(cause);
    } finally {
      sending = false;
    }
  }
  function request(size: WindowSize, persist: boolean) {
    latest = windowSize(size)!;
    queued = { size: latest, persist };
    void flush();
  }
  root.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !(event.target as HTMLElement).closest('[data-window-resize]'))
      return;
    event.preventDefault();
    latest = current();
    drag = { id: event.pointerId, x: event.screenX, y: event.screenY, size: latest };
    root.setPointerCapture(event.pointerId);
  });
  root.addEventListener('pointermove', (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    request(
      {
        width: drag.size.width + event.screenX - drag.x,
        height: drag.size.height + event.screenY - drag.y,
      },
      false,
    );
  });
  function finish(event: PointerEvent) {
    if (!drag || drag.id !== event.pointerId) return;
    const final =
      event.type === 'pointerup' && Number.isFinite(event.screenX) && Number.isFinite(event.screenY)
        ? {
            width: drag.size.width + event.screenX - drag.x,
            height: drag.size.height + event.screenY - drag.y,
          }
        : latest;
    drag = undefined;
    request(final, true);
    if (root.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId);
  }
  root.addEventListener('pointerup', finish);
  root.addEventListener('pointercancel', finish);
  root.addEventListener('lostpointercapture', finish);
  return {
    keydown(event: KeyboardEvent) {
      if (!(event.target as HTMLElement).closest('[data-window-resize]')) return false;
      const directions: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      const direction = directions[event.key];
      if (!direction) return false;
      event.preventDefault();
      if (!sending && !queued) latest = current();
      const step = event.shiftKey ? 40 : 10;
      request(
        { width: latest.width + direction[0] * step, height: latest.height + direction[1] * step },
        true,
      );
      return true;
    },
  };
}
