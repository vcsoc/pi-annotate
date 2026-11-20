import { normalizedPoint, validSelection, selectionBounds, drawMark, drawMarks } from './geometry.mjs';
import { placeNote } from './workflow.mjs';
import { projectLabel } from './project-label.mjs';
import { recordShortcut, matchesShortcut } from './shortcut-keys.mjs';
const api = window.annotate;
const $ = id => document.getElementById(id);
const page = new URLSearchParams(location.search).get('page');
const section = $(page); if (section) section.hidden = false;
document.documentElement.classList.toggle('transparent', page === 'mark' || page === 'desktop');
const report = error => { const target = page === 'desktop' ? $('desktop-status') : $('note-status') || $(page === 'overlay' ? 'selection-status' : page === 'portal' ? 'portal-status' : page === 'sources' ? 'sources-status' : page === 'popup' ? 'detail-status' : 'notice'); if (target) target.textContent = error?.message || String(error); };
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
  // Area/Freehand can be switched while marking; every display follows the choice.
  const showKind = kind => {
    config.kind = kind; drawing = false; points = []; render();
    for (const tool of ['rectangle', 'freehand']) $(`desktop-${tool}`).setAttribute('aria-pressed', String(tool === kind));
  };
  api.onDesktopKind(showKind); showKind(config.kind);
  for (const tool of ['rectangle', 'freehand']) {
    $(`desktop-${tool}`).addEventListener('pointerdown', e => e.stopPropagation());
    action(`desktop-${tool}`, () => api.desktopKind(tool));
  }
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') void api.cancel().catch(report);
    else if (!drawing && (e.key === 'a' || e.key === 'f')) void api.desktopKind(e.key === 'a' ? 'rectangle' : 'freehand').catch(report);
  });
}
if (page === 'mark') {
  const capture = await api.frozen(), canvas = $('mark-canvas'), ctx = canvas.getContext('2d');
  const render = () => { const scale = Math.min(1, 1920 / Math.max(innerWidth, innerHeight)); canvas.width = Math.round(innerWidth * scale); canvas.height = Math.round(innerHeight * scale); drawMark(ctx, capture.kind, capture.liveMarkPoints || [[0, 0], [1, 1]], canvas.width, canvas.height); };
  new ResizeObserver(render).observe(document.body); render();
}

if (page === 'toolbar') {
  let state, selectedId, refreshing = false, again = false, changingTarget = false, settingsSaving = false, appliedDefault, appliedKind, layout, trayOpen = false;
  const ready = d => d.ready ?? Boolean(d.comment.trim());
  const numbered = d => (d.marks?.length || 0) > 1;
  const selected = () => state?.drafts.find(item => item.id === selectedId);
  const pill = () => layout === 'pill';
  // Timeline feed is the default design; the command pill is a compact bar whose
  // tray (annotations) and settings grow the window to fixed sizes.
  const pillSize = () => !$('settings').hidden ? 'settings' : trayOpen ? 'expanded' : 'collapsed';
  // Compact badge: ⌘⇧A on macOS, Ctrl+Shift+A elsewhere.
  function shortcutLabel(value) {
    const macOS = /Mac/.test(navigator.platform);
    const parts = value.split('+'), key = parts.pop();
    const names = macOS ? { commandorcontrol: '⌘', cmdorctrl: '⌘', command: '⌘', cmd: '⌘', meta: '⌘', super: '⌘', shift: '⇧', alt: '⌥', option: '⌥', control: '⌃', ctrl: '⌃' } : { commandorcontrol: 'Ctrl', cmdorctrl: 'Ctrl', control: 'Ctrl', ctrl: 'Ctrl', command: 'Super', cmd: 'Super', meta: 'Super', super: 'Super', shift: 'Shift', alt: 'Alt', option: 'Alt' };
    const mods = parts.map(part => names[part.toLowerCase()] || part);
    return macOS ? mods.join('') + key : [...mods, key].join('+');
  }
  function applyLayout(next) {
    if (layout === next) return;
    layout = next; trayOpen = false;
    $('toolbar').classList.toggle('layout-timeline', !pill());
    $('toolbar').classList.toggle('layout-pill', pill());
    $('toolbar').classList.toggle('tray-open', false);
    $('tray-toggle').setAttribute('aria-expanded', 'false');
  }
  function setTray(open) {
    trayOpen = open;
    $('toolbar').classList.toggle('tray-open', open);
    $('tray-toggle').setAttribute('aria-expanded', String(open));
    $('tray-toggle').title = open ? 'Hide annotations' : 'Show annotations';
    if (pill()) void api.consoleSize(pillSize()).catch(report);
  }
  function select(id) {
    const changedSelection = selectedId !== id;
    selectedId = id; const item = selected();
    $('empty').hidden = Boolean(state?.drafts.length); $('detail').hidden = !item;
    let host = $('console-body');
    for (const row of $('drafts').children) {
      if (!row.dataset.id) continue;
      row.dataset.selected = String(row.dataset.id === id);
      row.querySelector('.entry').setAttribute('aria-pressed', String(row.dataset.id === id));
      if (row.dataset.id === id && !pill()) host = row;
    }
    // Timeline expands the selected entry in place; the pill shows it below its cards.
    if ($('detail').parentNode !== host) host.append($('detail'));
    if (!item) return;
    if (changedSelection && host !== $('console-body')) host.scrollIntoView?.({ block: 'nearest' });
    $('entry-image').src = item.preview; $('entry-image').title = `${item.source} — double-click to open beside the Console`;
    if (document.activeElement !== $('entry-comment') || changedSelection) $('entry-comment').value = item.comment;
    // Several numbered marks are edited one comment at a time in the popup.
    $('entry-comment').readOnly = numbered(item);
    $('entry-comment').title = numbered(item) ? 'This annotation has numbered marks — double-click the screenshot or use ＋ Mark to edit them.' : '';
    $('entry-count').textContent = `${state.drafts.length}/${state.settings.maxAnnotations}`;
    void api.select(id).catch(report);
  }
  async function refresh() {
    if (refreshing) { again = true; return; } refreshing = true;
    try {
      state = await api.state(); const disabled = state.sending || state.capturing || state.updatingShortcut || changingTarget;
      applyLayout(state.settings.consoleLayout === 'pill' ? 'pill' : 'timeline');
      if (state.captureKind && appliedKind !== state.captureKind) { $('capture-kind').value = appliedKind = state.captureKind; }
      const seconds = state.settings?.countdownSeconds ?? 1;
      $('capture').textContent = seconds ? `＋ Capture (${seconds}s)` : '＋ Capture';
      const mode = state.preservedCaptureAvailable && state.settings.captureMode === 'preserved' ? 'Preserved frame' : 'Live marking';
      $('capture').title = `${mode}. Hides the Console, then waits ${seconds} seconds. Reopen any menu before marking. The shortcut has no countdown.`;
      $('save-settings').disabled = $('cancel-settings').disabled = disabled || settingsSaving;
      $('toggle-settings').disabled = disabled || settingsSaving;
      $('capture-mode').disabled = disabled || settingsSaving || !state.preservedCaptureAvailable;
      for (const id of ['capture-shortcut', 'global-shortcut', 'console-layout', 'mark-tool', 'mark-overflow', 'capture-countdown', 'max-annotations', 'default-delivery']) $(id).disabled = disabled || settingsSaving;
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
      $('shortcut').textContent = state.shortcutReady ? shortcutLabel(state.shortcut) : 'Use Capture';
      $('shortcut').title = state.shortcutReady ? (state.shortcutGlobal ? 'Start capture immediately from any app' : 'Start capture immediately while the Console is focused') : `Capture shortcut unavailable: ${state.shortcut}`;
      $('send').disabled = disabled || !state.destinationAvailable || !state.drafts.length || state.drafts.some(d => !ready(d));
      $('send-count').textContent = String(state.drafts.length);
      $('send').title = state.sending ? 'Sending annotations…' : `Send all ${state.drafts.length} annotations to ${state.project}`;
      $('send').setAttribute('aria-label', $('send').title);
      $('clear').disabled = disabled || !state.drafts.length;
      $('capture').disabled = disabled || state.drafts.length >= state.settings.maxAnnotations;
      $('capture-kind').disabled = disabled;
      const full = state.drafts.length >= state.settings.maxAnnotations;
      $('entry-comment').disabled = disabled;
      $('entry-retake').disabled = $('entry-remove').disabled = $('entry-marks').disabled = disabled;
      $('entry-reuse').disabled = disabled || full;
      // Pill batch meter: one dot per allowed annotation.
      $('meter-dots').textContent = '●'.repeat(state.drafts.length) + '○'.repeat(Math.max(0, state.settings.maxAnnotations - state.drafts.length));
      $('meter-count').textContent = `${state.drafts.length}/${state.settings.maxAnnotations}`;
      const typing = document.activeElement === $('entry-comment');
      $('console-body').append($('detail'));
      $('drafts').replaceChildren();
      for (const [index, item] of state.drafts.entries()) {
        const row = document.createElement('div'); row.className = 'entry-row'; row.dataset.id = item.id;
        row.dataset.popup = String(item.id === state.detailId);
        const head = document.createElement('div'); head.className = 'entry-head';
        const number = document.createElement('b'); number.textContent = `#${index + 1}`;
        const source = document.createElement('span'); source.className = 'entry-source'; source.textContent = item.source;
        head.append(number, source);
        const button = document.createElement('button'); button.className = 'entry'; button.disabled = disabled;
        const preview = document.createElement('img'); preview.src = item.preview; preview.alt = `Full app and highlighted mark ${index + 1}`;
        const text = document.createElement('span'); text.className = 'entry-text'; text.textContent = numbered(item) ? `${item.marks.length} marks · ${item.comment}` : item.comment || '(Add annotation text)';
        button.title = `${item.source} — double-click to open and add numbered marks`;
        button.append(preview, text); button.onclick = () => select(item.id);
        row.append(head, button); $('drafts').append(row);
      }
      if (pill() && !full) {
        const slot = document.createElement('button'); slot.className = 'slot-card'; slot.disabled = disabled;
        const free = state.settings.maxAnnotations - state.drafts.length;
        slot.textContent = `＋ ${free} slot${free === 1 ? '' : 's'} free`; slot.title = 'Capture a new annotation';
        slot.onclick = () => Promise.resolve().then(() => api.capture({ kind: $('capture-kind').value })).catch(report);
        $('drafts').append(slot);
      }
      select(state.selectedId || (state.drafts.some(d => d.id === selectedId) ? selectedId : state.drafts[0]?.id));
      if (typing) $('entry-comment').focus();
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
    if (pill()) void api.consoleSize(pillSize()).catch(report);
  };
  action('toggle-settings', () => {
    if (settingsSaving || state.sending || state.capturing || changingTarget) return;
    if (!$('settings').hidden) { closeSettings(); return; }
    $('capture-shortcut').value = state.settings.captureShortcut;
    $('capture-shortcut').placeholder = state.defaultShortcut;
    $('global-shortcut').checked = state.settings.globalShortcut !== false;
    $('console-layout').value = state.settings.consoleLayout || 'timeline';
    $('mark-tool').value = state.settings.markTool || 'freehand';
    $('mark-overflow').value = state.settings.markOverflow || 'clip';
    $('shortcut-status').textContent = '';
    $('capture-countdown').value = state.settings.countdownSeconds;
    $('capture-mode').value = state.settings.captureMode;
    $('max-annotations').value = state.settings.maxAnnotations;
    $('default-delivery').value = state.settings.defaultDeliverAs;
    $('settings-status').textContent = '';
    $('settings').hidden = false;
    $('toolbar').classList.toggle('settings-open', true);
    $('toggle-settings').setAttribute('aria-expanded', 'true'); $('capture-shortcut').focus();
    if (pill()) void api.consoleSize('settings').catch(report);
  });
  action('cancel-settings', closeSettings);
  action('save-settings', async () => {
    if (settingsSaving || state.sending || state.capturing || changingTarget) return;
    for (const id of ['capture-countdown', 'max-annotations']) if (!$(id).value || !$(id).reportValidity()) return;
    settingsSaving = true; $('save-settings').disabled = $('cancel-settings').disabled = true;
    $('settings-status').textContent = 'Saving settings…';
    try {
      await api.settings({ captureShortcut: $('capture-shortcut').value, globalShortcut: $('global-shortcut').checked, consoleLayout: $('console-layout').value, markTool: $('mark-tool').value, markOverflow: $('mark-overflow').value, countdownSeconds: Number($('capture-countdown').value), captureMode: $('capture-mode').value, maxAnnotations: Number($('max-annotations').value), defaultDeliverAs: $('default-delivery').value });
      await refresh(); closeSettings();
    } catch (error) { $('settings-status').textContent = error.message || String(error); }
    finally { settingsSaving = false; await refresh().catch(report); }
  });
  // The shortcut field records the pressed combination instead of accepting typed text.
  // The shortcut and the Global switch are saved and applied as soon as they change.
  const mac = /Mac/.test(navigator.platform), field = $('capture-shortcut');
  let recording = false, recorded = '', applying = Promise.resolve();
  function applyShortcut(change) {
    const note = $('shortcut-status');
    note.classList.toggle('error', false); note.textContent = 'Saving…';
    applying = applying.then(async () => {
      try {
        await api.settings(change);
        state = await api.state();
        const label = shortcutLabel(state.shortcut);
        note.textContent = `Saved. ${label} now starts a capture ${state.shortcutGlobal ? 'from any app' : 'while the Console is focused'}.`;
      } catch (error) {
        note.classList.toggle('error', true); note.textContent = error.message || String(error);
        // Show what is actually in effect.
        field.value = recorded = state.settings.captureShortcut;
        $('global-shortcut').checked = state.settings.globalShortcut !== false;
      }
    });
    return applying;
  }
  $('global-shortcut').addEventListener('change', () => { void applyShortcut({ globalShortcut: $('global-shortcut').checked }); });
  const plain = event => !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey;
  const restorePreview = () => { if (field.value.endsWith('…')) field.value = recorded; };
  field.addEventListener('focus', () => {
    recording = true; recorded = field.value; field.classList.toggle('recording', true);
    $('shortcut-status').classList.toggle('error', false); $('shortcut-status').textContent = 'Press the new key combination…';
    // Pause the active shortcut so pressing it records instead of capturing.
    void api.shortcutRecording(true).catch(report);
  });
  field.addEventListener('blur', () => {
    recording = false; restorePreview(); field.classList.toggle('recording', false);
    if ($('shortcut-status').textContent === 'Press the new key combination…') $('shortcut-status').textContent = '';
    void api.shortcutRecording(false).catch(report);
  });
  field.addEventListener('input', () => { recorded = field.value; });
  field.addEventListener('keyup', event => { if (plain(event)) restorePreview(); });
  field.addEventListener('keydown', event => {
    if (plain(event) && (event.key === 'Tab' || event.key === 'Escape')) { restorePreview(); return; }
    event.preventDefault(); event.stopPropagation();
    if (plain(event) && (event.key === 'Backspace' || event.key === 'Delete')) {
      if (!recorded) return;
      field.value = recorded = '';
      void applyShortcut({ captureShortcut: '' });
      return;
    }
    const result = recordShortcut(event, mac);
    if (result.accelerator) {
      if (result.accelerator === recorded) return;
      field.value = recorded = result.accelerator;
      void applyShortcut({ captureShortcut: result.accelerator });
    } else if (result.error) { $('shortcut-status').classList.toggle('error', true); $('shortcut-status').textContent = result.error; }
    else field.value = result.pending || recorded;
  });
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !$('settings').hidden && !settingsSaving) { event.preventDefault(); closeSettings(); return; }
    // Console-only mode: the shortcut works while this window has keyboard focus.
    if (!recording && state?.shortcutReady && !state.shortcutGlobal && matchesShortcut(event, state.shortcut, mac)) {
      event.preventDefault(); void api.shortcutCapture().catch(report);
    }
  });
  $('developer-link').addEventListener('click', event => { event.preventDefault(); void api.developerPage().catch(report); });
  action('capture', () => api.capture({ kind: $('capture-kind').value }));
  action('clear', () => api.clear());
  action('close-console', () => api.quit());
  action('tray-toggle', () => setTray(!trayOpen));
  action('entry-retake', () => { const item = selected(); if (item) return api.capture({ replaceId: item.id, kind: $('capture-kind').value }); });
  action('entry-reuse', () => { const item = selected(); if (item) return api.capture({ copyId: item.id, kind: $('capture-kind').value }); });
  action('entry-remove', () => { const item = selected(); if (item) return api.remove(item.id); });
  // Timeline: double-click an annotation's thumbnail (or its expanded screenshot)
  // to open it in a popup beside the Console, level with that entry.
  action('entry-marks', () => {
    const item = selected(); if (!item) return;
    const row = [...$('drafts').children].find(r => r.dataset.id === item.id);
    return api.detailOpen(item.id, Math.round(row?.getBoundingClientRect?.().top || 0));
  });
  $('capture-kind').addEventListener('change', () => { appliedKind = $('capture-kind').value; void api.captureKind(appliedKind).catch(report); });
  $('console-body').addEventListener('dblclick', event => {
    if (!event.target.closest?.('img, .entry')) return;
    const row = event.target.closest('.entry-row'), id = row?.dataset.id || (event.target.closest('#detail') && selectedId);
    if (!id) return;
    event.preventDefault();
    void api.detailOpen(id, Math.round((row || event.target).getBoundingClientRect().top)).catch(report);
  });
  $('entry-comment').addEventListener('input', () => {
    const item = selected(); if (!item) return;
    item.comment = $('entry-comment').value;
    const row = [...$('drafts').children].find(b => b.dataset.id === item.id);
    if (item.marks?.length === 1) { item.marks[0].comment = item.comment; item.ready = Boolean(item.comment.trim()); }
    if (row) row.querySelector('.entry-text').textContent = item.comment || '(Add annotation text)';
    $('send').disabled = changingTarget || state.sending || state.capturing || !state.destinationAvailable || state.drafts.some(d => !ready(d));
    // Input IPC is issued before any later Retake/Send click, preserving edits.
    void api.comment(item.id, item.comment).catch(report);
  });
  // The persistent footer warns before Send; main closes only after delivery succeeds.
  action('send', () => api.send(state.destinationId, $('delivery-mode').value));
  await refresh();
}

if (page === 'popup') {
  // Annotation popup: the full screenshot with numbered marks. Draw on it to add
  // another mark; each mark has its own comment. Marks are numbered in the saved
  // image once there is more than one.
  let state, id, edit, marks = [], kind = 'rectangle', active = 0, drawing = false, points = [], saveTimer, saving = Promise.resolve(), dirty = 0;
  const canvas = $('detail-canvas'), ctx = canvas.getContext('2d'), base = new Image();
  const current = () => state?.drafts.findIndex(d => d.id === id) ?? -1;
  const busy = () => state?.sending || state?.capturing;
  function paint(target, showActive) {
    const c = target.getContext('2d');
    c.clearRect(0, 0, target.width, target.height); c.drawImage(base, 0, 0, target.width, target.height);
    drawMarks(c, marks, target.width, target.height);
    if (showActive && marks[active] && marks.length > 1) {
      c.save(); c.globalAlpha = .9; drawMark(c, marks[active].kind, marks[active].points, target.width, target.height);
      c.restore(); c.save(); c.strokeStyle = '#ffd45e'; c.lineWidth = Math.max(2, target.width / 600); c.setLineDash([8, 6]);
      const b = selectionBounds(marks[active].points); c.strokeRect(b.left * target.width - 6, b.top * target.height - 6, (b.right - b.left) * target.width + 12, (b.bottom - b.top) * target.height + 12); c.restore();
    }
    if (showActive && points.length >= 2) drawMark(c, kind, points, target.width, target.height);
  }
  const render = () => { if (base.naturalWidth) paint(canvas, true); };
  function fit() {
    if (!base.naturalWidth) return;
    const stage = $('popup-stage'), scale = Math.min(stage.clientWidth / base.naturalWidth, stage.clientHeight / base.naturalHeight);
    canvas.style.width = `${Math.floor(base.naturalWidth * scale)}px`; canvas.style.height = `${Math.floor(base.naturalHeight * scale)}px`;
  }
  new ResizeObserver(fit).observe($('popup-stage'));
  function composite() {
    const out = document.createElement('canvas'); out.width = base.naturalWidth; out.height = base.naturalHeight;
    paint(out, false); return out.toDataURL('image/png').split(',')[1];
  }
  // Comments save quietly; adding/removing marks also saves the recomposited image.
  function save(withImage) {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = undefined; dirty--; }
    dirty++;
    const target = id, value = () => ({ marks: marks.map(mark => ({ ...mark })), ...(withImage && { image: composite() }) });
    const run = () => {
      saveTimer = undefined;
      const payload = value();
      saving = saving.then(() => api.detailSave(target, payload)).then(() => { $('detail-status').textContent = withImage ? `Saved ${marks.length} mark${marks.length === 1 ? '' : 's'}.` : ''; }).catch(report).finally(() => { dirty--; });
      return saving;
    };
    if (withImage) return run();
    saveTimer = setTimeout(run, 300);
  }
  function listMarks(focusIndex) {
    $('mark-list').replaceChildren(...marks.map((mark, index) => {
      const row = document.createElement('li'); row.className = 'mark-row'; row.dataset.active = String(index === active);
      const badge = document.createElement('span'); badge.className = 'mark-badge'; badge.textContent = String(index + 1);
      const text = document.createElement('textarea'); text.rows = 2; text.maxLength = 8000; text.value = mark.comment; text.disabled = busy();
      text.placeholder = `Comment for mark ${index + 1}`; text.setAttribute('aria-label', `Comment for mark ${index + 1}`);
      text.addEventListener('focus', () => { active = index; for (const r of $('mark-list').children) r.dataset.active = String(r === row); render(); });
      text.addEventListener('input', () => { mark.comment = text.value; save(false); });
      const remove = document.createElement('button'); remove.className = 'mark-remove'; remove.textContent = '×';
      remove.title = `Remove mark ${index + 1}`; remove.setAttribute('aria-label', remove.title); remove.disabled = busy() || marks.length === 1;
      remove.onclick = () => { marks.splice(index, 1); active = Math.min(active, marks.length - 1); listMarks(); render(); void save(true); };
      row.append(badge, text, remove); return row;
    }));
    $('mark-hint').textContent = edit?.base ? `Draw on the screenshot to add mark ${marks.length + 1}.` : 'Retake this annotation to add marks.';
    if (focusIndex !== undefined) $('mark-list').children[focusIndex]?.querySelector('textarea').focus();
  }
  async function load() {
    edit = await api.detailEdit();
    marks = edit.marks.map(mark => ({ ...mark, points: mark.points.map(p => [...p]) })); active = 0; points = [];
    const item = state.drafts[current()];
    base.src = edit.base || item.preview; await base.decode();
    canvas.width = base.naturalWidth; canvas.height = base.naturalHeight; fit(); render(); listMarks();
  }
  async function draw() {
    let detail;
    [state, detail] = await Promise.all([api.state(), api.detail()]);
    const changedItem = detail.id !== id; id = detail.id;
    const index = current();
    if (index < 0) { await api.detailClose(); return; }
    const item = state.drafts[index];
    $('detail-title').textContent = `Annotation ${index + 1}`;
    $('detail-meta').textContent = `· ${item.source} · ${state.drafts.length}/${state.settings.maxAnnotations}`;
    $('detail-prev').disabled = busy() || index === 0;
    $('detail-next').disabled = busy() || index === state.drafts.length - 1;
    $('detail-retake').disabled = $('detail-remove').disabled = busy();
    $('detail-reuse').disabled = busy() || state.drafts.length >= state.settings.maxAnnotations;
    for (const tool of ['rectangle', 'freehand']) $(`mark-${tool}`).disabled = busy();
    // Reload marks when another annotation is shown or it was edited elsewhere (e.g. its Console note).
    // Never reload over unsaved local edits.
    const outside = !dirty && !$('mark-list').contains(document.activeElement) && JSON.stringify(item.marks?.map(m => [m.kind, m.comment])) !== JSON.stringify(marks.map(m => [m.kind, m.comment]));
    if (changedItem || outside || (!dirty && item.marks?.length !== marks.length)) await load();
  }
  const point = event => normalizedPoint(event.clientX, event.clientY, canvas.getBoundingClientRect());
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 || busy() || !edit?.base || marks.length >= 20) return;
    drawing = true; points = [point(event)]; canvas.setPointerCapture(event.pointerId); render();
  });
  canvas.addEventListener('pointermove', event => {
    if (!drawing) return; const p = point(event);
    if (kind === 'rectangle') points[1] = p;
    else { const last = points.at(-1); if (Math.hypot(p[0] - last[0], p[1] - last[1]) > .002 && points.length < 1000) points.push(p); }
    render();
  });
  canvas.addEventListener('pointerup', event => {
    if (!drawing) return; drawing = false; canvas.releasePointerCapture(event.pointerId);
    if (kind === 'rectangle') points[1] = point(event); else if (points.length < 1000) points.push(point(event));
    const added = validSelection(points) && { kind, points, comment: '' };
    points = [];
    if (!added) { render(); $('detail-status').textContent = 'Draw a larger mark.'; return; }
    marks.push(added); active = marks.length - 1; render(); listMarks(active); void save(true);
    $('detail-status').textContent = `Mark ${marks.length} added — type its comment.`;
  });
  canvas.addEventListener('pointercancel', () => { drawing = false; points = []; render(); });
  for (const tool of ['rectangle', 'freehand']) action(`mark-${tool}`, () => {
    kind = tool; for (const t of ['rectangle', 'freehand']) $(`mark-${t}`).setAttribute('aria-pressed', String(t === kind));
  });
  // Flush a pending comment save before leaving this annotation.
  const flush = () => { if (saveTimer) { clearTimeout(saveTimer); saveTimer = undefined; dirty--; return save(true); } return saving; };
  const step = delta => { const next = state?.drafts[current() + delta]; if (next) return flush().then(() => api.detailShow(next.id)); };
  const kindOf = () => state?.drafts[current()]?.kind === 'freehand' ? 'freehand' : 'rectangle';
  const close = () => flush().then(() => api.detailClose());
  action('detail-prev', () => step(-1));
  action('detail-next', () => step(1));
  action('detail-close', close);
  action('detail-done', close);
  action('detail-retake', () => api.capture({ replaceId: id, kind: kindOf() }));
  action('detail-reuse', () => api.capture({ copyId: id, kind: kindOf() }));
  action('detail-remove', () => api.remove(id));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); void close().catch(report); }
    else if (!$('mark-list').contains(document.activeElement) && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) void Promise.resolve(step(event.key === 'ArrowLeft' ? -1 : 1)).catch(report);
  });
  api.onChange(() => draw().catch(report));
  await draw();
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
