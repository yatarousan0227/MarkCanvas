type EditIntentTrackerOptions = {
  prepareTableOperation: (target: Element) => void;
};

export type EditIntentTracker = {
  mark(): void;
  clear(): void;
  consume(): boolean;
  install(root: HTMLElement | null): void;
};

export function createEditIntentTracker(options: EditIntentTrackerOptions): EditIntentTracker {
  let pendingUserEditIntent = false;

  const mark = (): void => {
    pendingUserEditIntent = true;
  };

  const clear = (): void => {
    pendingUserEditIntent = false;
  };

  const consume = (): boolean => {
    const shouldApply = pendingUserEditIntent;
    pendingUserEditIntent = false;
    return shouldApply;
  };

  const install = (root: HTMLElement | null): void => {
    if (!root) {
      return;
    }

    const markStructuredEditIntent = (eventTarget: EventTarget | null, prepareTableOperation = false): void => {
      if (!(eventTarget instanceof HTMLInputElement)) {
        if (!(eventTarget instanceof Element)) {
          return;
        }

        if (eventTarget.closest('.milkdown-list-item-block .label-wrapper')) {
          mark();
        }

        if (eventTarget.closest('.milkdown-table-block button')) {
          mark();
          if (prepareTableOperation) {
            options.prepareTableOperation(eventTarget);
          }
        }

        return;
      }

      if (eventTarget.type !== 'checkbox') {
        return;
      }

      mark();
    };

    root.addEventListener('beforeinput', () => {
      mark();
    }, true);
    root.addEventListener('paste', () => {
      mark();
    }, true);
    root.addEventListener('cut', () => {
      mark();
    }, true);
    root.addEventListener('drop', () => {
      mark();
    }, true);
    root.addEventListener('pointerdown', (event) => {
      markStructuredEditIntent(event.target, true);
    }, true);
    root.addEventListener('click', (event) => {
      markStructuredEditIntent(event.target);
    }, true);
    root.addEventListener('change', (event) => {
      markStructuredEditIntent(event.target);
    }, true);
    root.addEventListener('keydown', (event) => {
      if (shouldTreatKeydownAsEditIntent(event)) {
        mark();
      }
    }, true);
  };

  return {
    mark,
    clear,
    consume,
    install,
  };
}

function shouldTreatKeydownAsEditIntent(event: KeyboardEvent): boolean {
  if (event.isComposing) {
    return true;
  }

  if (event.key === 'Enter' || event.key === 'Backspace' || event.key === 'Delete' || event.key === 'Tab') {
    return true;
  }

  if ((event.metaKey || event.ctrlKey) && /^[a-z0-9]$/i.test(event.key)) {
    return true;
  }

  return false;
}
