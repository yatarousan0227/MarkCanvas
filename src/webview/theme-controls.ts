import { chevronDownIcon } from './icons';
import type { PreviewTheme } from './view-types';

const previewThemeLabels: Record<PreviewTheme, string> = {
  system: 'VS Code',
  light: 'Light',
  dark: 'Dark',
};

type ThemeControlsManagerOptions = {
  getPreviewTheme: () => PreviewTheme;
  setPreviewTheme: (theme: PreviewTheme) => void;
};

export function createThemeControlsManager(options: ThemeControlsManagerOptions) {
  function updateControls(): void {
    const label = document.querySelector<HTMLElement>('[data-preview-theme-label]');
    if (label) {
      label.textContent = previewThemeLabels[options.getPreviewTheme()];
    }

    for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-preview-theme-option]'))) {
      const selected = button.dataset.previewThemeOption === options.getPreviewTheme();
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
    }
  }

  function ensureControls(): void {
    if (document.getElementById('top-bar-theme-controls')) {
      updateControls();
      return;
    }

    const topBar = document.querySelector<HTMLElement>('.milkdown-top-bar');
    if (!topBar) {
      return;
    }

    const slot = document.createElement('div');
    slot.className = 'preview-theme-slot';

    const divider = document.createElement('div');
    divider.className = 'top-bar-divider preview-theme-divider';

    const controls = document.createElement('div');
    controls.id = 'top-bar-theme-controls';
    controls.className = 'top-bar-heading-selector preview-theme-selector';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'top-bar-heading-button';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');

    const label = document.createElement('span');
    label.className = 'top-bar-heading-label';
    label.dataset.previewThemeLabel = 'true';

    const chevron = document.createElement('span');
    chevron.className = 'top-bar-chevron';
    chevron.innerHTML = chevronDownIcon;

    trigger.append(label, chevron);

    const dropdown = document.createElement('div');
    dropdown.className = 'top-bar-heading-dropdown';
    dropdown.hidden = true;
    dropdown.setAttribute('role', 'listbox');
    dropdown.setAttribute('aria-label', 'Preview theme');

    const themes: PreviewTheme[] = ['system', 'light', 'dark'];
    for (const theme of themes) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'top-bar-heading-option';
      button.dataset.previewThemeOption = theme;
      button.textContent = previewThemeLabels[theme];
      button.addEventListener('click', () => {
        dropdown.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        options.setPreviewTheme(theme);
      });
      dropdown.append(button);
    }

    trigger.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const isOpen = !dropdown.hidden;
      dropdown.hidden = isOpen;
      trigger.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
    });

    document.addEventListener('pointerdown', (event) => {
      if (!controls.contains(event.target as Node)) {
        dropdown.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
      }
    });

    controls.append(trigger, dropdown);
    slot.append(divider, controls);
    topBar.append(slot);
    updateControls();
  }

  return {
    ensureControls,
    updateControls,
  };
}

