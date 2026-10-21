export function controlView(quality, error = null) {
  if (!quality) return {visible: false, selectable: false, options: [], value: '', status: '', retry: false};
  const options = quality.options.map(o => ({id: o.id, label: o.label + (o.availability === 'unavailable' ? ' (not available for this clip)' : '')}));
  const label = id => quality.options.find(o => o.id === id)?.label ?? 'Requested quality';
  const multiple = options.length > 1 || (options.length > 0 && !!error && !options.some(o => o.id === quality.requested));
  const auto = options.length === 1 && quality.options[0].mode === 'auto';
  let status = '';
  if (quality.pending) status = `Switching to ${label(quality.pending)}…`;
  else if (error?.reason === 'autoplay-blocked') status = error.message;
  else if (quality.outcome?.status === 'failed') status = quality.active
    ? `Could not apply ${label(quality.requested)}. Playing ${label(quality.active)}. ${quality.outcome.message}`
    : quality.outcome.message;
  else if (quality.outcome?.status === 'deferred') status = `${label(quality.requested)} selected for the next clip.`;
  else if (quality.active) {
    status = `Playing ${label(quality.active)}`;
    if (quality.rendition === 'unknown') status += ' (rendition unknown)';
    else if (quality.rendition) status += ` (${quality.rendition.label})`;
    status += '.';
    if (quality.active !== quality.requested) status += ` ${label(quality.requested)} could not be applied to this clip.`;
  } else if (error) status = error.message;
  const visible = multiple || auto;
  const requested = quality.options.find(o => o.id === quality.requested);
  return {visible, selectable: multiple, options, value: quality.requested, status,
    retry: visible && !quality.pending && !!requested && requested.availability !== 'unavailable' &&
      !(error?.reason === 'autoplay-blocked' && quality.active === quality.requested) &&
      (quality.outcome?.status === 'failed' || !!error || (!!quality.active && quality.active !== quality.requested))};
}

export function createQualityControl({row, label, select, status, retry, onSelect, onRetry}) {
  let key = '';
  select.addEventListener('change', () => onSelect(select.value));
  retry.addEventListener('click', onRetry);
  return state => {
    const view = controlView(state?.quality, state?.error);
    row.hidden = !view.visible;
    label.hidden = !view.selectable;
    retry.hidden = !view.retry;
    const next = JSON.stringify([view.options, view.value]);
    if (next !== key) {
      key = next;
      select.replaceChildren();
      if (!view.options.some(o => o.id === view.value)) {
        const option = document.createElement('option');
        option.value = ''; option.textContent = 'Choose quality'; option.disabled = true;
        select.append(option);
      }
      for (const item of view.options) {
        const option = document.createElement('option');
        option.value = item.id; option.textContent = item.label; select.append(option);
      }
      select.value = view.value;
    }
    if (status.textContent !== view.status) status.textContent = view.status;
    return view.visible;
  };
}
