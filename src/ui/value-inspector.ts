import { Literal } from '../core/model';
import { Preview, formatLiteral } from './preview-model';

export interface InspectionPage {
  key: string;
  label: string;
  value?: Literal;
  summary?: string;
  aliases: { field: string; name: string; key?: string; group?: string }[];
}
export interface ValueInspection {
  key: string;
  name: string;
  group: string;
  pages: InspectionPage[];
}

/** Read the same planned values used for sync; never resolve aliases independently. */
export function inspectValue(
  preview: Preview | undefined,
  key: string,
): ValueInspection | undefined {
  if (!preview) return;
  const alias = (field: string, targetKey: string) => {
    const target = preview.variables.find((row) => row.key === targetKey);
    return { field, key: target?.key, name: target?.name ?? targetKey, group: target?.group };
  };
  const variable = preview.variables.find((row) => row.key === key);
  if (variable) {
    const modes =
      preview.collections.find((row) => row.name === variable.group)?.modes ??
      Object.keys(variable.values).map((mode) => ({ key: mode, name: mode }));
    return {
      key,
      name: variable.name,
      group: variable.group,
      pages: modes.map((mode) => ({
        key: mode.key,
        label: mode.name,
        value: variable.values[mode.key]?.literal,
        aliases: variable.values[mode.key]?.alias
          ? [alias('Value', variable.values[mode.key].alias!)]
          : [],
      })),
    };
  }
  const style = preview.styles.find((row) => row.key === key);
  if (style)
    return {
      key,
      name: style.name,
      group: style.group,
      pages: [
        {
          key: 'style',
          label: style.theme,
          value: style.swatch,
          summary: style.summary,
          aliases: style.bindings.map((binding) => alias(binding.field, binding.variable)),
        },
      ],
    };
}

type Rect = { left: number; top: number; right: number; bottom: number };
export function inspectorPosition(anchor: Rect, bounds: Rect, width: number, height: number) {
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));
  const anchorMiddle = (anchor.top + anchor.bottom) / 2;
  const listMiddle = (bounds.top + bounds.bottom) / 2;
  return {
    left: bounds.left + 8,
    top: clamp(
      anchorMiddle < listMiddle ? bounds.bottom - height - 8 : bounds.top + 8,
      bounds.top + 8,
      bounds.bottom - height - 8,
    ),
  };
}

const escape = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );
const literal = (value: Literal | undefined, summary?: string) => {
  if (value === undefined) return `<span>${escape(summary ?? 'No planned value')}</span>`;
  const text = formatLiteral(value);
  return `${typeof value === 'object' ? `<span class="swatch" style="--swatch:${text}" aria-hidden="true"></span>` : ''}<span>${escape(text || '""')}</span>`;
};

/** A single floating inspector, outside the scrolling table and independent of app rerenders. */
export function createValueInspector(app: HTMLElement, getPreview: () => Preview | undefined) {
  let anchor: HTMLButtonElement | undefined;
  let card: HTMLDivElement | undefined;
  let inspection: ValueInspection | undefined;
  let pageIndex = 0;
  let openTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let dismissed: HTMLButtonElement | undefined;
  let hovered: HTMLButtonElement | undefined;
  let insideCard = false;
  let restoringFocus = false;

  function close(restoreFocus = false) {
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    const previous = anchor;
    previous?.setAttribute('aria-expanded', 'false');
    card?.remove();
    card = undefined;
    anchor = undefined;
    inspection = undefined;
    insideCard = false;
    if (restoreFocus && previous?.isConnected) {
      restoringFocus = true;
      previous.focus({ preventScroll: true });
      restoringFocus = false;
    }
  }
  function scheduleClose() {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      if (
        !insideCard &&
        hovered !== anchor &&
        document.activeElement !== anchor &&
        !card?.contains(document.activeElement)
      )
        close();
    }, 180);
  }
  function position() {
    if (!anchor || !card) return;
    const area = app.getBoundingClientRect();
    const footerTop = app.querySelector('.workspace-footer')?.getBoundingClientRect().top;
    const list = anchor.closest('.table-scroll')?.getBoundingClientRect() ?? area;
    const bounds = {
      left: Math.max(0, area.left, list.left),
      right: Math.min(window.innerWidth, area.right, list.right),
      top: Math.max(0, area.top, list.top),
      bottom: Math.min(window.innerHeight, footerTop ?? area.bottom, list.bottom),
    };
    card.style.width = `${Math.min(280, bounds.right - bounds.left - 16)}px`;
    card.style.maxHeight = `${Math.max(80, bounds.bottom - bounds.top - 16)}px`;
    const size = card.getBoundingClientRect();
    const point = inspectorPosition(
      anchor.getBoundingClientRect(),
      bounds,
      size.width,
      size.height,
    );
    card.style.left = `${point.left}px`;
    card.style.top = `${point.top}px`;
  }
  function draw() {
    if (!card || !inspection) return;
    const focused = card.querySelector<HTMLButtonElement>(':focus')?.dataset.inspectorAction;
    const page = inspection.pages[pageIndex];
    card.setAttribute('aria-label', `Value details for ${inspection.name}`);
    card.innerHTML = `<div class="inspector-heading"><h2 id="inspector-mode">${escape(page.label)}</h2>
      ${inspection.pages.length > 1 ? `<div class="inspector-pager"><button class="quiet icon-button" data-inspector-action="previous" aria-label="Previous mode">‹</button><span aria-label="Mode ${pageIndex + 1} of ${inspection.pages.length}">${pageIndex + 1}/${inspection.pages.length}</span><button class="quiet icon-button" data-inspector-action="next" aria-label="Next mode">›</button></div>` : ''}
      <button class="quiet icon-button inspector-close" data-inspector-action="close" aria-label="Close value details">×</button></div>
      <div class="inspector-body" aria-live="polite" aria-atomic="true"><span class="sr-only">${escape(page.label)}</span>
      ${page.aliases.map((alias) => `<div class="inspector-field"><span class="inspector-label">${escape(alias.field)}</span>${alias.key ? `<button class="inspector-alias" data-open-token="${escape(alias.key)}" data-origin-token="${escape(inspection!.key)}" title="Open ${escape(alias.name)}">→ ${escape(alias.name)}</button>` : `<span class="inspector-alias">${escape(alias.name)}</span>`}</div>`).join('')}
      <div class="inspector-field"><span class="inspector-label">${page.aliases.length ? 'Resolved' : 'Value'}</span><div class="inspector-literal">${literal(page.value, page.summary)}</div></div></div>
      <div class="inspector-context">${escape(inspection.name)} · ${escape(inspection.group)}</div>`;
    position();
    if (focused)
      card
        .querySelector<HTMLButtonElement>(`[data-inspector-action="${focused}"]`)
        ?.focus({ preventScroll: true });
  }
  function step(delta: number) {
    if (!inspection) return;
    pageIndex = (pageIndex + delta + inspection.pages.length) % inspection.pages.length;
    draw();
  }
  function open(trigger: HTMLButtonElement, focus = false) {
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    if (anchor === trigger && card) {
      if (focus) card.focus({ preventScroll: true });
      return;
    }
    const [key, mode] = JSON.parse(trigger.dataset.value!) as [string, string];
    const next = inspectValue(getPreview(), key);
    if (!next?.pages.length) return;
    close();
    anchor = trigger;
    inspection = next;
    pageIndex = Math.max(
      0,
      next.pages.findIndex((page) => page.key === mode),
    );
    anchor.setAttribute('aria-expanded', 'true');
    card = document.createElement('div');
    card.id = 'value-inspector';
    card.className = 'value-inspector';
    card.setAttribute('role', 'dialog');
    card.tabIndex = -1;
    app.append(card);
    card.addEventListener('pointerenter', () => {
      insideCard = true;
      clearTimeout(closeTimer);
    });
    card.addEventListener('pointerleave', () => {
      insideCard = false;
      scheduleClose();
    });
    card.addEventListener('click', (event) => {
      const action = (event.target as HTMLElement).closest<HTMLButtonElement>(
        '[data-inspector-action]',
      )?.dataset.inspectorAction;
      if (!action) return;
      event.stopPropagation();
      if (action === 'close') {
        dismissed = anchor;
        close(true);
      } else step(action === 'next' ? 1 : -1);
    });
    draw();
    if (focus) card.focus({ preventScroll: true });
  }
  app.addEventListener('pointerover', (event) => {
    if (event.pointerType === 'touch') return;
    const trigger = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-value]');
    if (!trigger || trigger.contains(event.relatedTarget as Node | null)) return;
    hovered = trigger;
    clearTimeout(closeTimer);
    if (dismissed === trigger || card?.contains(document.activeElement)) return;
    clearTimeout(openTimer);
    openTimer = setTimeout(() => {
      if (trigger.isConnected && hovered === trigger) open(trigger);
    }, 180);
  });
  app.addEventListener('pointerout', (event) => {
    const trigger = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-value]');
    if (!trigger || trigger.contains(event.relatedTarget as Node | null)) return;
    clearTimeout(openTimer);
    hovered = undefined;
    if (dismissed === trigger) dismissed = undefined;
    scheduleClose();
  });
  app.addEventListener('focusin', (event) => {
    const trigger = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-value]');
    if (trigger && !restoringFocus && dismissed !== trigger) open(trigger);
    else if (card && !card.contains(event.target as Node)) close();
  });
  app.addEventListener('focusout', (event) => {
    if (event.target === dismissed) dismissed = undefined;
    scheduleClose();
  });
  window.addEventListener('pointerdown', (event) => {
    if (card && !(event.target as HTMLElement).closest('[data-value], #value-inspector')) close();
  });
  app.addEventListener(
    'scroll',
    (event) => {
      if (card && event.target !== card && !card.contains(event.target as Node)) close();
    },
    true,
  );
  window.addEventListener('resize', () => close());
  return {
    close,
    open,
    beforeRender() {
      dismissed = undefined;
      hovered = undefined;
      close(!!card?.contains(document.activeElement));
    },
    keydown(event: KeyboardEvent) {
      if (!card) return false;
      if (event.key === 'Escape') {
        event.preventDefault();
        dismissed = anchor;
        close(card.contains(document.activeElement));
        return true;
      }
      if (
        ['ArrowLeft', 'ArrowRight'].includes(event.key) &&
        (event.target === anchor || card.contains(event.target as Node))
      ) {
        event.preventDefault();
        step(event.key === 'ArrowRight' ? 1 : -1);
        return true;
      }
      if (event.key === 'Tab' && !event.shiftKey && event.target === anchor) {
        event.preventDefault();
        card.querySelector<HTMLButtonElement>('button')?.focus();
        return true;
      }
      // The popup is appended after the footer; return keyboard users to the table
      // when they tab past its final control instead of jumping out of the plugin.
      const buttons = [...card.querySelectorAll<HTMLButtonElement>('button')];
      if (
        event.key === 'Tab' &&
        ((event.shiftKey && event.target === buttons[0]) ||
          (!event.shiftKey && event.target === buttons[buttons.length - 1]))
      ) {
        event.preventDefault();
        dismissed = anchor;
        close(true);
        return true;
      }
      return false;
    },
  };
}
