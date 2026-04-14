import type { ResourceDescriptor, WebviewToExtensionMessage } from '../types';

type DrawioOverlayRenderOptions = {
  resourceCache: Map<string, ResourceDescriptor>;
  resolvedResourceCache: Map<string, ResourceDescriptor>;
};

type DrawioOverlayManagerOptions = {
  postMessage: (message: WebviewToExtensionMessage) => void;
};

type DrawioOverlayEntry = {
  button: HTMLButtonElement;
  image: HTMLImageElement;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getVisibleAreaRatio(rect: DOMRect): number {
  const visibleWidth = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
  const visibleHeight = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
  const visibleArea = visibleWidth * visibleHeight;
  const totalArea = rect.width * rect.height;

  if (totalArea <= 0) {
    return 0;
  }

  return visibleArea / totalArea;
}

function createOverlayButton(
  target: string,
  postMessage: (message: WebviewToExtensionMessage) => void,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'markcanvas-drawio-overlay-button';
  button.title = 'Open draw.io file';
  button.setAttribute('aria-label', 'Open draw.io file');
  button.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M14 5h5v5h-2V8.41l-6.29 6.3-1.42-1.42 6.3-6.29H14V5Zm-3 3v2H7v7h7v-4h2v6H5V8h6Z" fill="currentColor"></path>
    </svg>
  `;
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    postMessage({
      type: 'openDrawioFile',
      target,
    });
  });

  return button;
}

export function createDrawioOverlayManager(options: DrawioOverlayManagerOptions) {
  const layer = document.createElement('div');
  layer.className = 'markcanvas-drawio-overlay-layer';
  document.body.append(layer);

  const entries: DrawioOverlayEntry[] = [];
  let rafId = 0;

  const clear = (): void => {
    while (entries.length > 0) {
      const entry = entries.pop();
      entry?.button.remove();
    }
  };

  const syncPositions = (): void => {
    rafId = 0;
    const viewportMargin = 8;

    for (const entry of entries) {
      if (!entry.image.isConnected) {
        entry.button.hidden = true;
        continue;
      }

      const rect = entry.image.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        entry.button.hidden = true;
        continue;
      }

      if (getVisibleAreaRatio(rect) < 0.5) {
        entry.button.hidden = true;
        continue;
      }

      entry.button.hidden = false;
      const buttonWidth = entry.button.offsetWidth || 30;
      const buttonHeight = entry.button.offsetHeight || 30;
      const anchorLeft = rect.right - buttonWidth - viewportMargin;
      const anchorTop = rect.top + viewportMargin;

      const left = clamp(
        anchorLeft,
        viewportMargin,
        Math.max(viewportMargin, window.innerWidth - buttonWidth - viewportMargin),
      );
      const top = clamp(
        anchorTop,
        viewportMargin,
        Math.max(viewportMargin, window.innerHeight - buttonHeight - viewportMargin),
      );
      entry.button.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    }
  };

  const scheduleSync = (): void => {
    if (rafId !== 0) {
      return;
    }

    rafId = window.requestAnimationFrame(syncPositions);
  };

  const handleViewportChange = (): void => {
    scheduleSync();
  };

  window.addEventListener('scroll', handleViewportChange, true);
  window.addEventListener('resize', handleViewportChange);

  return {
    render(renderOptions: DrawioOverlayRenderOptions): void {
      clear();

      for (const image of Array.from(document.querySelectorAll<HTMLImageElement>('.milkdown img'))) {
        const rawSource = image.getAttribute('src');
        if (!rawSource) {
          continue;
        }

        const resource = renderOptions.resourceCache.get(rawSource)
          ?? renderOptions.resolvedResourceCache.get(rawSource);
        if (!resource) {
          continue;
        }

        if (resource.resolved) {
          image.src = resource.resolved;
        }

        if (!resource.isDrawio || !resource.openTarget) {
          continue;
        }

        const button = createOverlayButton(resource.openTarget, options.postMessage);
        layer.append(button);
        entries.push({ button, image });

        image.addEventListener('load', scheduleSync, { once: true });
      }

      scheduleSync();
    },
    destroy(): void {
      if (rafId !== 0) {
        window.cancelAnimationFrame(rafId);
        rafId = 0;
      }

      clear();
      window.removeEventListener('scroll', handleViewportChange, true);
      window.removeEventListener('resize', handleViewportChange);
      layer.remove();
    },
  };
}
