/**
 * Small helpers shared by the 2D DOM overlay's views: escaping text for
 * `innerHTML` templates, colour and date formatting, and keeping a modal's
 * scroll position across a re-render.
 */

export const PIN_COLOR_OPTIONS = [
  {label: 'Vermilion Accent', value: '#E84D2B'},
  {label: 'Charcoal Ink', value: '#1B1B19'},
  {label: 'Lotus White', value: '#FFFFFF'},
  {label: 'Electric Cyan', value: '#06B6D4'},
  {label: 'Study Amber', value: '#F59E0B'},
  {label: 'Sage Emerald', value: '#10B981'},
  {label: 'Royal Violet', value: '#8B5CF6'},
  {label: 'Rose Coral', value: '#F43F5E'},
];

/** Escapes text for use inside an HTML template, including attribute values. */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** `#RRGGBB` or `#RGB` as `"r, g, b"` for CSS `rgba(var(--x), a)`; the accent when unparsable. */
export function hexToRgbTuple(hex: string): string {
  const cleaned = (hex || '#E84D2B').replace('#', '').trim();
  if (cleaned.length === 3) {
    const r = parseInt(cleaned[0] + cleaned[0], 16) || 232;
    const g = parseInt(cleaned[1] + cleaned[1], 16) || 77;
    const b = parseInt(cleaned[2] + cleaned[2], 16) || 43;
    return `${r}, ${g}, ${b}`;
  }
  if (cleaned.length >= 6) {
    const r = parseInt(cleaned.slice(0, 2), 16);
    const g = parseInt(cleaned.slice(2, 4), 16);
    const b = parseInt(cleaned.slice(4, 6), 16);
    if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
      return `${r}, ${g}, ${b}`;
    }
  }
  return '232, 77, 43';
}

/** "Just now", "5m ago", "3h ago", then a short date. */
export function formatCreatedAgo(createdAt: number): string {
  if (!createdAt) return 'Saved';
  const diffSec = Math.max(0, Math.floor((Date.now() - createdAt) / 1000));
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const date = new Date(createdAt);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

export interface ModalScroll {
  id: string;
  top: number;
}

/**
 * Re-renders rebuild a modal through `innerHTML`, which scrolls it back to the
 * top. Capture before and restore after; only the same modal (by its
 * `data-modal-id`) gets the old position back.
 */
export function captureModalBodyScroll(layer: HTMLElement): ModalScroll | null {
  const body = layer.querySelector<HTMLElement>('.lotus-modal-body[data-modal-id]');
  if (!body?.dataset.modalId) return null;
  return {id: body.dataset.modalId, top: body.scrollTop};
}

export function restoreModalBodyScroll(layer: HTMLElement, prev: ModalScroll | null): void {
  if (!prev) return;
  const body = layer.querySelector<HTMLElement>('.lotus-modal-body[data-modal-id]');
  if (body?.dataset.modalId === prev.id) body.scrollTop = prev.top;
}
