const chevron =
  '<svg class="icon select-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg>';
const check =
  '<svg class="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 8 3 3 7-7"/></svg>';

/** Keep native select values/events as the form boundary; provide one themed popup. */
export function createSelectMenus(app: HTMLElement, onOpen = () => {}) {
  let select: HTMLSelectElement | undefined;
  let trigger: HTMLButtonElement | undefined;
  let menu: HTMLDivElement | undefined;
  let options: HTMLOptionElement[] = [];
  let active = 0;
  let query = '';
  let typedAt = 0;
  const buttons = new Map<HTMLSelectElement, HTMLButtonElement>();

  function close(restoreFocus = false) {
    const previous = trigger;
    previous?.setAttribute('aria-expanded', 'false');
    menu?.remove();
    select = undefined;
    trigger = undefined;
    menu = undefined;
    options = [];
    query = '';
    if (restoreFocus && previous?.isConnected) previous.focus({ preventScroll: true });
  }
  function label(native: HTMLSelectElement) {
    return (
      native.getAttribute('aria-label') ??
      native.closest('label')?.querySelector('span')?.textContent?.trim() ??
      native.name ??
      'Choose an option'
    );
  }
  function refresh() {
    for (const [native, button] of buttons) {
      button.disabled = native.disabled;
      const value = button.querySelector('.select-value');
      if (value) value.textContent = native.selectedOptions[0]?.textContent ?? 'Choose…';
    }
  }
  function highlight(index: number, focus = true) {
    active = (index + options.length) % options.length;
    const items = menu?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [];
    items.forEach((item, itemIndex) => item.classList.toggle('active', itemIndex === active));
    if (focus) {
      items[active]?.focus({ preventScroll: true });
      items[active]?.scrollIntoView({ block: 'nearest' });
    }
  }
  function choose(index: number) {
    if (!select || !options[index]) return;
    const native = select;
    const previous = native.value;
    native.value = options[index].value;
    refresh();
    close(true);
    if (native.value !== previous) native.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function typeahead(key: string) {
    const now = Date.now();
    query = now - typedAt > 700 ? key : query + key;
    typedAt = now;
    const repeated = [...query].every((character) => character === query[0]);
    const prefix = (repeated ? query[0] : query).toLocaleLowerCase();
    for (let offset = 1; offset <= options.length; offset++) {
      const index = (active + offset) % options.length;
      if (options[index].textContent?.trim().toLocaleLowerCase().startsWith(prefix)) {
        highlight(index);
        break;
      }
    }
  }
  function open(native: HTMLSelectElement, button: HTMLButtonElement, initial?: number) {
    close();
    if (native.disabled) return;
    const available = [...native.options].filter(
      (option) =>
        !option.disabled &&
        !option.hidden &&
        !(option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled),
    );
    if (!available.length) return;
    onOpen();
    select = native;
    trigger = button;
    options = available;
    active =
      initial === undefined
        ? Math.max(
            0,
            options.findIndex((option) => option.selected),
          )
        : Math.min(initial, options.length - 1);
    button.setAttribute('aria-expanded', 'true');
    menu = document.createElement('div');
    menu.id = 'select-menu';
    menu.className = 'select-menu';
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', label(native));
    options.forEach((option, index) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'select-option';
      item.tabIndex = -1;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(option.selected));
      const marker = document.createElement('span');
      marker.className = 'select-check';
      marker.innerHTML = option.selected ? check : '';
      const text = document.createElement('span');
      text.className = 'select-option-label';
      text.textContent = option.textContent;
      item.append(marker, text);
      if (option.dataset.count !== undefined) {
        const metadata = document.createElement('span');
        metadata.className = 'select-option-meta';
        const dot = document.createElement('span');
        dot.className = 'select-status';
        dot.dataset.status = option.dataset.status ?? 'unchanged';
        dot.setAttribute('aria-hidden', 'true');
        const count = document.createElement('span');
        count.textContent = option.dataset.count;
        metadata.append(dot, count);
        item.append(metadata);
      }
      item.title = option.dataset.description ?? option.textContent ?? '';
      item.addEventListener('click', (event) => {
        event.stopPropagation();
        choose(index);
      });
      item.addEventListener('pointerenter', () => highlight(index, false));
      menu!.append(item);
    });
    app.append(menu);
    const bounds = app.getBoundingClientRect();
    const anchor = button.getBoundingClientRect();
    const left = Math.max(0, bounds.left) + 8;
    const right = Math.min(window.innerWidth, bounds.right) - 8;
    const top = Math.max(0, bounds.top) + 8;
    const bottom = Math.min(window.innerHeight, bounds.bottom) - 8;
    const below = bottom - anchor.bottom - 5;
    const above = anchor.top - top - 5;
    menu.style.width = `${Math.min(right - left, Math.max(180, anchor.width))}px`;
    menu.style.maxHeight = `${Math.max(36, Math.min(320, Math.max(below, above)))}px`;
    const size = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(left, Math.min(anchor.left, right - size.width))}px`;
    menu.style.top = `${Math.max(top, Math.min(below >= size.height ? anchor.bottom + 5 : anchor.top - size.height - 5, bottom - size.height))}px`;
    menu.addEventListener('keydown', (event) => {
      if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ', 'Escape'].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        if (event.key === 'ArrowDown') highlight(active + 1);
        else if (event.key === 'ArrowUp') highlight(active - 1);
        else if (event.key === 'Home') highlight(0);
        else if (event.key === 'End') highlight(options.length - 1);
        else if (event.key === 'Escape') close(true);
        else choose(active);
      } else if (event.key === 'Tab') close(true);
      else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        event.stopPropagation();
        typeahead(event.key);
      }
    });
    highlight(active);
  }
  function mount() {
    buttons.clear();
    app.querySelectorAll<HTMLSelectElement>('select').forEach((native, index) => {
      // render() replaces the complete view. Keep IDs stable so its focus memory works.
      if (!native.id) native.id = `select-${index}`;
      const button = document.createElement('button');
      button.id = `${native.id}-trigger`;
      button.type = 'button';
      button.className = 'select-trigger';
      button.setAttribute('role', 'combobox');
      button.setAttribute('aria-label', label(native));
      button.setAttribute('aria-haspopup', 'listbox');
      button.setAttribute('aria-controls', 'select-menu');
      button.setAttribute('aria-expanded', 'false');
      if (native.dataset.prefix) {
        const prefix = document.createElement('span');
        prefix.className = 'select-prefix';
        prefix.textContent = native.dataset.prefix;
        button.append(prefix);
      }
      const value = document.createElement('span');
      value.className = 'select-value';
      button.append(value);
      button.insertAdjacentHTML('beforeend', chevron);
      native.closest('label')?.setAttribute('for', button.id);
      native.hidden = true;
      native.insertAdjacentElement('afterend', button);
      buttons.set(native, button);
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        if (select === native) close(true);
        else open(native, button);
      });
      button.addEventListener('keydown', (event) => {
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          open(
            native,
            button,
            event.key === 'Home' ? 0 : event.key === 'End' ? native.options.length - 1 : undefined,
          );
        } else if (
          event.key.length === 1 &&
          event.key !== ' ' &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey
        ) {
          event.preventDefault();
          open(native, button);
          typeahead(event.key);
        }
      });
    });
    refresh();
  }
  window.addEventListener('pointerdown', (event) => {
    if (menu && !menu.contains(event.target as Node) && !trigger?.contains(event.target as Node))
      close();
  });
  app.addEventListener('focusin', (event) => {
    if (menu && !menu.contains(event.target as Node) && event.target !== trigger) close();
  });
  app.addEventListener(
    'scroll',
    (event) => {
      if (menu && event.target !== menu && !menu.contains(event.target as Node)) close();
    },
    true,
  );
  window.addEventListener('resize', () => close());
  return { mount, refresh, beforeRender: () => close(!!menu?.contains(document.activeElement)) };
}
