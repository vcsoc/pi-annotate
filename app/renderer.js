import { normalizedPoint, validSelection, selectionBounds, drawMark } from './geometry.mjs';
import { placeNote } from './workflow.mjs';
import { projectLabel } from './project-label.mjs';
const api = window.annotate;
const $ = id => document.getElementById(id);
const page = new URLSearchParams(location.search).get('page');
const section = $(page); if (section) section.hidden = false;
document.documentElement.classList.toggle('transparent', page === 'mark' || page === 'desktop');
const report = error => { const target = page === 'desktop' ? $('desktop-status') : $('note-status') || $(page === 'overlay' ? 'selection-status' : page === 'portal' ? 'portal-status' : page === 'sources' ? 'sources-status' : 'notice'); if (target) target.textContent = error?.message || String(error); };
const action = (id, fn) => $(id).addEventListener('click', () => Promise.resolve().then(fn).catch(report));
window.addEventListener('unhandledrejection', event => { event.preventDefault(); report(event.reason); });

if (page === 'desktop') {
  const config = await api.desktopConfig(), canvas = $('desktop-canvas'), ctx = canvas.getContext('2d');
  if (config.background) {
    const backdrop = new Image(); backdrop.src = config.background; await backdrop.decode();
    backdrop.className = 'desktop-backdrop';
    $('desktop').prepend(backdrop);
    $('desktop-hint').firstChild.textContent = 'Screen preserved — mark the area, then add a note. ';
  }
  let drawing = false, points = [];
  function render(mark) {
    // Selection surfaces need only a lightweight outline, not Retina-sized
    // screenshot buffers on every display. Coordinate mapping stays in DIP.
    const scale = Math.min(1, 1920 / Math.max(innerWidth, innerHeight));
    canvas.width = Math.round(innerWidth * scale); canvas.height = Math.round(innerHeight * scale);
    if (mark) drawMark(ctx, mark.kind, mark.points.map(p => [(p[0] - config.bounds.x) / config.bounds.width, (p[1] - config.bounds.y) / config.bounds.height]), canvas.width, canvas.height);
  }
  const point = e => [config.bounds.x + e.clientX * config.bounds.width / innerWidth, config.bounds.y + e.clientY * config.bounds.height / innerHeight];
  const progress = () => { render({ kind: config.kind, points }); if (points.length >= 2) void api.desktopMark(points).catch(() => {}); };
  api.onDesktopProgress(render); render();
  if (config.background) requestAnimationFrame(() => requestAnimationFrame(() => { void api.desktopReady().catch(report); }));
  canvas.addEventListener('pointerdown', e => { if (e.button !== 0) return; drawing = true; points = [point(e)]; canvas.setPointerCapture(e.pointerId); progress(); });
  canvas.addEventListener('pointermove', e => {
    if (!drawing) return;
    if (config.kind === 'rectangle') points[1] = point(e);
    else if (points.length < 999 && Math.hypot(...point(e).map((n, i) => n - points.at(-1)[i])) >= 2) points.push(point(e));
    progress();
  });
  canvas.addEventListener('pointerup', e => {
    if (!drawing) return; drawing = false;
    if (config.kind === 'rectangle') points[1] = point(e); else points.push(point(e));
    canvas.releasePointerCapture(e.pointerId);
    void api.desktopMark(points, true).catch(report);
  });
  canvas.addEventListener('pointercancel', () => { drawing = false; points = []; render(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') void api.cancel().catch(report); });
}
if (page === 'mark') {
  const capture = await api.frozen(), canvas = $('mark-canvas'), ctx = canvas.getContext('2d');
  const render = () => { const scale = Math.min(1, 1920 / Math.max(innerWidth, innerHeight)); canvas.width = Math.round(innerWidth * scale); canvas.height = Math.round(innerHeight * scale); drawMark(ctx, capture.kind, capture.liveMarkPoints || [[0, 0], [1, 1]], canvas.width, canvas.height); };
  new ResizeObserver(render).observe(document.body); render();
}

if (page === 'toolbar') {
  let state, selectedId, refreshing = false, again = false, changingTarget = false, settingsSaving = false, appliedDefault;
  const selected = () => state?.drafts.find(item => item.id === selectedId);
  function select(id) {
    selectedId = id; const item = selected();
    $('empty').hidden = Boolean(item); $('detail').hidden = !item;
    for (const row of $('drafts').children) {
      row.dataset.selected = String(row.dataset.id === id);
      row.querySelector('.entry').setAttribute('aria-pressed', String(row.dataset.id === id));
    }
    if (!item) return;
    $('entry-image').src = item.preview; $('entry-image').title = item.source;
    $('entry-comment').value = item.comment;
    $('entry-count').textContent = `${state.drafts.length}/${state.settings.maxAnnotations}`;
    void api.select(id).catch(report);
  }
  async function refresh() {
    if (refreshing) { again = true; return; } refreshing = true;
    try {
      state = await api.state(); const disabled = state.sending || state.capturing || changingTarget;
      const seconds = state.settings?.countdownSeconds ?? 1;
      $('capture').textContent = seconds ? `＋ Capture (${seconds}s)` : '＋ Capture';
      const mode = state.preservedCaptureAvailable && state.settings.captureMode === 'preserved' ? 'Preserved frame' : 'Live marking';
      $('capture').title = `${mode}. Hides the Console, then waits ${seconds} seconds. Reopen any menu before marking. The shortcut has no countdown.`;
      $('save-settings').disabled = $('cancel-settings').disabled = disabled || settingsSaving;
      $('toggle-settings').disabled = disabled || settingsSaving;
      $('capture-mode').disabled = disabled || settingsSaving || !state.preservedCaptureAvailable;
      for (const id of ['capture-countdown', 'max-annotations', 'default-delivery']) $(id).disabled = disabled || settingsSaving;
      $('delivery-mode').disabled = disabled || settingsSaving;
      if (appliedDefault !== state.settings.defaultDeliverAs) {
        $('delivery-mode').value = state.settings.defaultDeliverAs;
        appliedDefault = state.settings.defaultDeliverAs;
      }
      if (state.notice) $('notice').textContent = state.notice;
      const targets = [...state.destinations];
      if (!targets.some(target => target.id === state.destinationId)) targets.unshift({ id: state.destinationId, project: state.project, session: '', name: 'offline' });
      const optionsKey = JSON.stringify([targets, state.destinationId, state.destinationAvailable]);
      if ($('project').dataset.options !== optionsKey) {
        $('project').replaceChildren(...targets.map(target => {
          const option = document.createElement('option'); option.value = target.id;
          const duplicate = targets.filter(other => other.project === target.project).length > 1;
          const detail = duplicate ? ` — ${target.name || target.session.slice(0, 8)} [${target.id.slice(0, 6)}]` : target.name === 'offline' ? ' — offline' : '';
          option.textContent = projectLabel(target.project) + detail;
          option.selected = target.id === state.destinationId;
          return option;
        }));
        $('project').dataset.options = optionsKey;
      }
      $('project').value = state.destinationId;
      $('project').title = state.project; $('project').disabled = disabled;
      $('shortcut').textContent = state.shortcutReady ? state.shortcut.replace('CommandOrControl', /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl') : 'Use Capture';
      $('send').disabled = disabled || !state.destinationAvailable || !state.drafts.length || state.drafts.some(d => !d.comment.trim());
      $('send-count').textContent = String(state.drafts.length);
      $('send').title = state.sending ? 'Sending annotations…' : `Send all ${state.drafts.length} annotations to ${state.project}`;
      $('send').setAttribute('aria-label', $('send').title);
      $('clear').disabled = disabled || !state.drafts.length;
      $('capture').disabled = disabled || state.drafts.length >= state.settings.maxAnnotations;
      $('capture-kind').disabled = disabled;
      $('entry-comment').disabled = disabled;
      $('drafts').replaceChildren();
      for (const [index, item] of state.drafts.entries()) {
        const row = document.createElement('div'); row.className = 'entry-row'; row.dataset.id = item.id;
        const button = document.createElement('button'); button.className = 'entry'; button.disabled = disabled;
        const preview = document.createElement('img'); preview.src = item.preview; preview.alt = `Full app and highlighted mark ${index + 1}`;
        const text = document.createElement('span'); text.textContent = `${index + 1}. ${item.comment || '(Add annotation text)'}`;
        button.title = item.source; button.append(preview, text); button.onclick = () => select(item.id);
        const controls = document.createElement('div'); controls.className = 'entry-actions';
        for (const [icon, label, callback, full] of [
          ['↻', 'Retake and replace this annotation', () => api.capture({ replaceId: item.id, kind: $('capture-kind').value }), false],
          ['⊕', 'Capture a new annotation using this note', () => api.capture({ copyId: item.id, kind: $('capture-kind').value }), state.drafts.length >= state.settings.maxAnnotations],
          ['🗑', 'Delete this annotation', () => api.remove(item.id), false],
        ]) {
          const control = document.createElement('button'); control.className = 'action-icon'; control.textContent = icon;
          control.title = label; control.setAttribute('aria-label', label); control.disabled = disabled || full;
          control.onclick = () => Promise.resolve().then(callback).catch(report); controls.append(control);
        }
        row.append(button, controls); $('drafts').append(row);
      }
      select(state.selectedId || (state.drafts.some(d => d.id === selectedId) ? selectedId : state.drafts[0]?.id));
    } finally { refreshing = false; if (again) { again = false; void refresh().catch(report); } }
  }
  api.onChange(() => refresh().catch(report)); api.onNotice(report);
  $('project').addEventListener('change', async () => {
    const id = $('project').value; changingTarget = true;
    $('project').disabled = true; $('send').disabled = true;
    try { await api.target(id); }
    catch (error) { report(error); }
    finally { changingTarget = false; await refresh().catch(report); }
  });
  const closeSettings = () => {
    $('settings').hidden = true;
    $('toolbar').classList.toggle('settings-open', false);
    $('toggle-settings').setAttribute('aria-expanded', 'false'); $('toggle-settings').focus();
  };
  action('toggle-settings', () => {
    if (settingsSaving || state.sending || state.capturing || changingTarget) return;
    if (!$('settings').hidden) { closeSettings(); return; }
    $('capture-countdown').value = state.settings.countdownSeconds;
    $('capture-mode').value = state.settings.captureMode;
    $('max-annotations').value = state.settings.maxAnnotations;
    $('default-delivery').value = state.settings.defaultDeliverAs;
    $('settings-status').textContent = '';
    $('settings').hidden = false;
    $('toolbar').classList.toggle('settings-open', true);
    $('toggle-settings').setAttribute('aria-expanded', 'true'); $('capture-countdown').focus();
  });
  action('cancel-settings', closeSettings);
  action('save-settings', async () => {
    if (settingsSaving || state.sending || state.capturing || changingTarget) return;
    for (const id of ['capture-countdown', 'max-annotations']) if (!$(id).value || !$(id).reportValidity()) return;
    settingsSaving = true; $('save-settings').disabled = $('cancel-settings').disabled = true;
    try {
      await api.settings({ countdownSeconds: Number($('capture-countdown').value), captureMode: $('capture-mode').value, maxAnnotations: Number($('max-annotations').value), defaultDeliverAs: $('default-delivery').value });
      await refresh(); closeSettings();
    } catch (error) { $('settings-status').textContent = error.message || String(error); }
    finally { settingsSaving = false; await refresh().catch(report); }
  });
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !$('settings').hidden && !settingsSaving) { event.preventDefault(); closeSettings(); }
  });
  $('developer-link').addEventListener('click', event => { event.preventDefault(); void api.developerPage().catch(report); });
  action('capture', () => api.capture({ kind: $('capture-kind').value }));
  action('clear', () => api.clear());
  action('close-console', () => api.quit());
  $('entry-comment').addEventListener('input', () => {
    const item = selected(); if (!item) return;
    item.comment = $('entry-comment').value;
    const index = state.drafts.indexOf(item), button = [...$('drafts').children].find(b => b.dataset.id === item.id);
    if (button) button.querySelector('span').textContent = `${index + 1}. ${item.comment || '(Add annotation text)'}`;
    $('send').disabled = changingTarget || state.sending || state.capturing || !state.destinationAvailable || state.drafts.some(d => !d.comment.trim());
    // Input IPC is issued before any later Retake/Send click, preserving edits.
    void api.comment(item.id, item.comment).catch(report);
  });
  // The persistent footer warns before Send; main closes only after delivery succeeds.
  action('send', () => api.send(state.destinationId, $('delivery-mode').value));
  await refresh();
}

// Both the adjacent desktop note and the portable in-image callout use the same
// expanding multiline form and the same full-frame PNG compositor. The note itself is never
// painted into the image; only the original app and highlighted mark are included.
function installNote(container, getCapture) {
  container.replaceChildren($('note-template').content.cloneNode(true));
  const initial = getCapture();
  $('note-title').textContent = initial.replaceId ? 'Retake annotation' : 'Note for marked area';
  $('note-source').textContent = initial.source;
  $('note-comment').value = initial.comment || '';
  let saving = false;
  const update = () => { $('save-note').disabled = saving || !$('note-comment').value.trim(); };
  $('note-comment').addEventListener('input', update); update();
  action('cancel-note', () => api.cancel());
  async function save() {
    if (saving || !$('note-comment').value.trim()) return;
    saving = true; update();
    try {
      const capture = getCapture(), image = new Image(); image.src = capture.image; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      drawMark(ctx, capture.kind, capture.points, canvas.width, canvas.height);
      await api.add({ image: canvas.toDataURL('image/png').split(',')[1], comment: $('note-comment').value.trim() });
    } catch (error) { saving = false; update(); report(error); }
  }
  action('save-note', save);
  $('note-comment').addEventListener('keydown', event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void save(); } });
  requestAnimationFrame(() => $('note-comment')?.focus());
}
if (page === 'note') {
  const capture = await api.frozen(); if (!capture?.points) throw new Error('No marked application');
  installNote($('note'), () => capture);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') void api.cancel().catch(report); });
}

if (page === 'overlay') {
  let capture = await api.frozen(); if (!capture) throw new Error('Capture expired. Return to the Console.');
  const canvas = $('canvas'), ctx = canvas.getContext('2d'), image = new Image();
  image.src = capture.image; await image.decode(); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  let kind = capture.kind, points = [], drawing = false, saving = false, zoom = 1, draftComment = capture.comment || '';
  function closeNote() {
    if ($('note-comment')) draftComment = $('note-comment').value;
    $('inline-note').hidden = true; $('inline-note').replaceChildren();
  }
  function positionNote() {
    if ($('inline-note').hidden || !validSelection(points)) return;
    const stage = $('stage'), frame = stage.getBoundingClientRect(), rect = canvas.getBoundingClientRect(), b = selectionBounds(points);
    const mark = { x: rect.left - frame.left + stage.scrollLeft + b.left * rect.width, y: rect.top - frame.top + stage.scrollTop + b.top * rect.height, width: (b.right - b.left) * rect.width, height: (b.bottom - b.top) * rect.height };
    const bounds = placeNote(mark, [{ x: stage.scrollLeft + 6, y: stage.scrollTop + 6, width: stage.clientWidth - 12, height: stage.clientHeight - 12 }]);
    Object.assign($('inline-note').style, { left: `${bounds.x}px`, top: `${bounds.y}px`, width: `${bounds.width}px`, height: `${bounds.height}px` });
  }
  function fit() {
    const stage = $('stage'), scale = Math.min((stage.clientWidth - 12) / canvas.width, (stage.clientHeight - 12) / canvas.height) * zoom;
    canvas.style.width = `${Math.max(1, Math.floor(canvas.width * scale))}px`; canvas.style.height = `${Math.max(1, Math.floor(canvas.height * scale))}px`; positionNote();
  }
  new ResizeObserver(fit).observe($('stage')); fit();
  action('zoom-in', () => { zoom = Math.min(8, zoom * 1.5); fit(); });
  action('zoom-out', () => { zoom = Math.max(1, zoom / 1.5); fit(); });
  action('zoom-fit', () => { zoom = 1; fit(); });
  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0);
    drawMark(ctx, capture.needsAppBounds ? 'rectangle' : kind, points, canvas.width, canvas.height);
    $('editor-title').textContent = capture.needsAppBounds ? 'First outline the ENTIRE application window' : 'Mark an area · complete app retained';
    $('crop-app').hidden = !capture.needsAppBounds; $('crop-app').disabled = saving || !validSelection(points);
    for (const tool of ['rectangle', 'freehand']) { $(tool).disabled = capture.needsAppBounds; $(tool).setAttribute('aria-pressed', String(tool === kind)); }
  }
  action('crop-app', async () => {
    if (saving || !validSelection(points)) return; saving = true; render();
    try {
      capture = await api.cropApp(points); image.src = capture.image; await image.decode();
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; points = []; zoom = 1; fit();
      $('selection-status').textContent = 'Whole app identified. Now mark the specific area; the full app stays in the saved image.';
    } finally { saving = false; render(); }
  });
  const point = event => normalizedPoint(event.clientX, event.clientY, canvas.getBoundingClientRect());
  canvas.addEventListener('pointerdown', event => { if (event.button !== 0 || saving) return; closeNote(); drawing = true; points = [point(event)]; canvas.setPointerCapture(event.pointerId); render(); });
  canvas.addEventListener('pointermove', event => {
    if (!drawing) return; const p = point(event);
    if (kind === 'rectangle' || capture.needsAppBounds) points[1] = p;
    else { const last = points.at(-1); if (Math.hypot(p[0] - last[0], p[1] - last[1]) > .002 && points.length < 1000) points.push(p); }
    render();
  });
  canvas.addEventListener('pointerup', async event => {
    if (!drawing) return; drawing = false;
    if (kind === 'rectangle' || capture.needsAppBounds) points[1] = point(event); else if (points.length < 1000) points.push(point(event));
    canvas.releasePointerCapture(event.pointerId); render();
    if (!validSelection(points)) { $('selection-status').textContent = 'Draw a larger marked area.'; return; }
    if (capture.needsAppBounds) { $('selection-status').textContent = 'Include the entire app (not only the area you want to comment on), then click Use this whole app.'; return; }
    saving = true;
    try {
      capture = { ...await api.mark(kind, points), comment: draftComment };
      $('inline-note').hidden = false; installNote($('inline-note'), () => capture); positionNote();
      $('selection-status').textContent = 'Enter your note beside the mark, then ✓ to save into Annotate Console.';
    } catch (error) { report(error); } finally { saving = false; }
  });
  canvas.addEventListener('pointercancel', () => { drawing = false; points = []; render(); });
  for (const tool of ['rectangle', 'freehand']) action(tool, () => { closeNote(); kind = tool; points = []; render(); });
  action('reset', () => { closeNote(); points = []; render(); });
  action('back', () => api.cancel());
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); void api.cancel().catch(report); } });
  render();
}

if (page === 'sources') {
  for (const source of await api.sources()) {
    const button = document.createElement('button'); button.className = 'source'; button.dataset.sourceId = source.id;
    const image = document.createElement('img'); image.src = source.preview; image.alt = source.name;
    const label = document.createElement('span'); label.textContent = `${source.type === 'window' ? 'App' : 'Display fallback'} · ${source.name}`;
    button.append(image, label); button.onclick = () => api.chooseSource(source.id).catch(report); $('source-list').append(button);
  }
  action('source-cancel', () => api.cancel());
  document.addEventListener('keydown', event => { if (event.key === 'Escape') void api.cancel().catch(report); });
}
if (page === 'portal') {
  action('portal-cancel', () => api.cancel());
  document.addEventListener('keydown', event => { if (event.key === 'Escape') void api.cancel().catch(report); });
  action('choose', async () => {
    $('choose').disabled = true; let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 1 }, audio: false });
      const video = document.createElement('video'); video.srcObject = stream; video.muted = true; await video.play();
      await api.portalReady(); await new Promise(resolve => video.requestVideoFrameCallback(resolve));
      const canvas = document.createElement('canvas'), scale = Math.min(1, 1920 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      const surface = stream.getVideoTracks()[0]?.getSettings().displaySurface;
      stream.getTracks().forEach(track => track.stop());
      await api.portalResult({ image: canvas.toDataURL('image/png'), surface });
    } catch (error) { await api.portalResult({ error: `${error.message}. Check Screen Recording / xdg-desktop-portal permissions.` }); }
    finally { stream?.getTracks().forEach(track => track.stop()); }
  });
}
