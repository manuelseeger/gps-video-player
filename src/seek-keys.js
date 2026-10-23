export const SEEK_STEPS = [
  {shift: false, ctrl: false, seconds: 10},
  {shift: true, ctrl: false, seconds: 60},
  {shift: true, ctrl: true, seconds: 600},
];

const RESERVED = 'input,select,textarea,[contenteditable]:not([contenteditable="false"]),#map,#inset-handle';

/** @param {KeyboardEvent} event @returns {number|null} signed seek step in seconds */
export function seekDeltaForEvent(event) {
  const direction = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
  if (!direction || event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.altKey || event.metaKey) return null;
  const target = event.target;
  if (target?.isContentEditable || target?.closest?.(RESERVED)) return null;
  const step = SEEK_STEPS.find(({shift, ctrl}) => shift === !!event.shiftKey && ctrl === !!event.ctrlKey);
  return step ? direction * step.seconds : null;
}
