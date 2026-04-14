import type { ResourceDescriptor } from '../types';

const BLOCK_TAG_NAMES = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'details',
  'dialog',
  'div',
  'dl',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'summary',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
]);

const DISALLOWED_TAG_NAMES = new Set([
  'base',
  'button',
  'canvas',
  'embed',
  'form',
  'iframe',
  'input',
  'link',
  'meta',
  'object',
  'script',
  'select',
  'style',
  'textarea',
]);

const GLOBAL_ATTRIBUTE_NAMES = new Set([
  'class',
  'dir',
  'hidden',
  'id',
  'lang',
  'role',
  'tabindex',
  'title',
]);

const ALLOWED_ATTRIBUTES_BY_TAG = new Map<string, Set<string>>([
  ['a', new Set(['href', 'target', 'rel', 'download'])],
  ['col', new Set(['span', 'width'])],
  ['colgroup', new Set(['span', 'width'])],
  ['details', new Set(['open'])],
  ['img', new Set(['src', 'alt', 'width', 'height'])],
  ['ol', new Set(['start', 'reversed'])],
  ['source', new Set(['src', 'type'])],
  ['table', new Set(['align'])],
  ['td', new Set(['colspan', 'rowspan', 'align'])],
  ['th', new Set(['colspan', 'rowspan', 'align', 'scope'])],
]);

type HtmlPreviewOptions = {
  resourceCache: Map<string, ResourceDescriptor>;
  resolvedResourceCache: Map<string, ResourceDescriptor>;
};

function isSafeUrl(value: string, allowDataImages = false): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  if (trimmed.startsWith('#')) {
    return true;
  }

  if (allowDataImages && /^data:image\/[a-z0-9.+-]+;base64,/i.test(trimmed)) {
    return true;
  }

  if (/^(https?:|mailto:|tel:)/i.test(trimmed)) {
    return true;
  }

  if (trimmed.startsWith('//')) {
    return false;
  }

  return !/^[a-z][a-z0-9+.-]*:/i.test(trimmed);
}

function isAllowedAttribute(tagName: string, attributeName: string): boolean {
  if (GLOBAL_ATTRIBUTE_NAMES.has(attributeName)) {
    return true;
  }

  if (attributeName.startsWith('aria-') || attributeName.startsWith('data-')) {
    return true;
  }

  return ALLOWED_ATTRIBUTES_BY_TAG.get(tagName)?.has(attributeName) ?? false;
}

function cloneSanitizedNode(
  node: Node,
  document: Document,
  resolveResourceUrl: (value: string) => string | null,
): Node | null {
  if (node.nodeType === Node.TEXT_NODE) {
    return document.createTextNode(node.textContent ?? '');
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }

  const sourceElement = node as HTMLElement;
  const tagName = sourceElement.tagName.toLowerCase();
  if (DISALLOWED_TAG_NAMES.has(tagName)) {
    return null;
  }

  const element = document.createElement(tagName);

  for (const attribute of Array.from(sourceElement.attributes)) {
    const attributeName = attribute.name.toLowerCase();
    if (attributeName.startsWith('on') || !isAllowedAttribute(tagName, attributeName)) {
      continue;
    }

    let value = attribute.value;
    if (attributeName === 'href') {
      if (!isSafeUrl(value)) {
        continue;
      }

      if (sourceElement.getAttribute('target') === '_blank') {
        element.setAttribute('rel', 'noopener noreferrer');
      }
    }

    if (attributeName === 'src') {
      const allowDataImages = tagName === 'img' || tagName === 'source';
      if (!isSafeUrl(value, allowDataImages)) {
        continue;
      }

      const resolved = resolveResourceUrl(value);
      if (!resolved) {
        continue;
      }
      value = resolved;
    }

    element.setAttribute(attribute.name, value);
  }

  for (const child of Array.from(sourceElement.childNodes)) {
    const sanitizedChild = cloneSanitizedNode(child, document, resolveResourceUrl);
    if (sanitizedChild) {
      element.appendChild(sanitizedChild);
    }
  }

  return element;
}

function sanitizeHtmlFragment(
  html: string,
  document: Document,
  resolveResourceUrl: (value: string) => string | null,
): DocumentFragment {
  const parser = new DOMParser();
  const parsed = parser.parseFromString(html, 'text/html');
  const fragment = document.createDocumentFragment();

  for (const node of Array.from(parsed.body.childNodes)) {
    const sanitizedNode = cloneSanitizedNode(node, document, resolveResourceUrl);
    if (sanitizedNode) {
      fragment.appendChild(sanitizedNode);
    }
  }

  return fragment;
}

function isBlockLike(fragment: DocumentFragment): boolean {
  const elementChildren = Array.from(fragment.childNodes).filter(
    (node): node is HTMLElement => node.nodeType === Node.ELEMENT_NODE,
  );

  if (elementChildren.some((element) => BLOCK_TAG_NAMES.has(element.tagName.toLowerCase()))) {
    return true;
  }

  return elementChildren.length > 1;
}

export function renderHtmlPreviews(options: HtmlPreviewOptions): void {
  const htmlNodes = document.querySelectorAll<HTMLElement>('.milkdown .ProseMirror span[data-type="html"]');

  const resolveResourceUrl = (value: string): string | null => {
    const resolved = options.resourceCache.get(value)?.resolved
      ?? options.resolvedResourceCache.get(value)?.resolved
      ?? resolveResourceWithSuffix(value, options);
    if (resolved) {
      return resolved;
    }

    if (value.startsWith('#') || /^(https?:|mailto:|tel:|data:image\/)/i.test(value)) {
      return value;
    }

    return null;
  };

  for (const node of Array.from(htmlNodes)) {
    const rawHtml = node.dataset.value ?? '';
    if (!rawHtml) {
      continue;
    }

    const fragment = sanitizeHtmlFragment(rawHtml, document, resolveResourceUrl);
    const preview = document.createElement('span');
    const blockLike = isBlockLike(fragment);
    preview.className = blockLike ? 'markcanvas-html-preview is-block' : 'markcanvas-html-preview';
    preview.contentEditable = 'false';
    preview.appendChild(fragment);

    if (!preview.childNodes.length) {
      preview.textContent = rawHtml;
      preview.classList.add('is-fallback');
    }

    node.replaceChildren(preview);
    node.classList.add('markcanvas-html-node');
    node.dataset.markcanvasHtmlRendered = 'true';
  }
}

function resolveResourceWithSuffix(value: string, options: HtmlPreviewOptions): string | null {
  const [path, suffix] = splitResourceReference(value);
  if (path === value) {
    return null;
  }

  const resolved = options.resourceCache.get(path)?.resolved
    ?? options.resolvedResourceCache.get(path)?.resolved;
  return resolved ? `${resolved}${suffix}` : null;
}

function splitResourceReference(value: string): [string, string] {
  const hashIndex = value.indexOf('#');
  const queryIndex = value.indexOf('?');
  const cutIndex = [hashIndex, queryIndex]
    .filter((index) => index >= 0)
    .reduce((min, index) => Math.min(min, index), value.length);

  return [value.slice(0, cutIndex), value.slice(cutIndex)];
}
