/** @typedef {{key: string, element: HTMLElement, activation: 'click'|'focus', repeat?: boolean}} Shortcut */

/** @param {KeyboardEvent} event @param {Shortcut[]} shortcuts */
export function shortcutForEvent(event, shortcuts) {
  const target = event.target;
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey ||
      target?.isContentEditable || target?.closest('input,select,textarea,a,[contenteditable]:not([contenteditable="false"]),#map')) return null;
  const key = ({' ': 'Space', '<': ',', '>': '.'})[event.key] ?? event.key.toLowerCase();
  if ((key === 'Space' || key === 'enter') && target?.closest('button,[role="button"]')) return null;
  return shortcuts.find(shortcut => shortcut.key.toLowerCase() === key.toLowerCase() &&
    (!event.repeat || shortcut.repeat) && !shortcut.element.matches(':disabled,[aria-disabled="true"]') &&
    (shortcut.activation !== 'focus' || shortcut.element.getClientRects().length > 0)) ?? null;
}
