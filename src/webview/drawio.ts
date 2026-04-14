import type { ResourceDescriptor, WebviewToExtensionMessage } from '../types';

type DrawioDecoratorOptions = {
  resourceCache: Map<string, ResourceDescriptor>;
  resolvedResourceCache: Map<string, ResourceDescriptor>;
  postMessage: (message: WebviewToExtensionMessage) => void;
};

export function decorateDrawioImages(options: DrawioDecoratorOptions): void {
  for (const image of Array.from(document.querySelectorAll('img'))) {
    const rawSource = image.getAttribute('src');
    if (!rawSource) {
      continue;
    }

    const resource = options.resourceCache.get(rawSource) ?? options.resolvedResourceCache.get(rawSource);
    if (!resource) {
      continue;
    }

    if (resource.resolved) {
      image.src = resource.resolved;
    }

    if (!resource.isDrawio || !resource.openTarget) {
      continue;
    }

    const host = (image.closest('.milkdown-image-block') ?? image.closest('figure') ?? image.parentElement) as HTMLElement | null;
    if (!host || host.dataset.drawioEnhanced === 'true') {
      continue;
    }

    host.dataset.drawioEnhanced = 'true';
    const openButton = document.createElement('button');
    openButton.type = 'button';
    openButton.className = 'operation-item drawio-open-action';
    openButton.title = 'Open draw.io file';
    openButton.setAttribute('aria-label', 'Open draw.io file');
    openButton.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M14 5h5v5h-2V8.41l-6.29 6.3-1.42-1.42 6.3-6.29H14V5Zm-3 3v2H7v7h7v-4h2v6H5V8h6Z" fill="currentColor"></path>
      </svg>
    `;
    openButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      options.postMessage({
        type: 'openDrawioFile',
        target: resource.openTarget!,
      });
    });

    const operation = host.querySelector<HTMLElement>('.operation');
    if (operation) {
      operation.append(openButton);
      continue;
    }

    openButton.classList.add('drawio-inline-action');
    openButton.textContent = 'Open draw.io file';
    host.append(openButton);
  }
}

