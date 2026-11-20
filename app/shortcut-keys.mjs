// Converts physical keyboard events into Electron accelerator strings so the
// Settings field can record a shortcut by pressing it. Pure: no DOM or Electron.
const NAMED = {
  Space: 'Space', Enter: 'Enter', NumpadEnter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Escape: 'Escape', PrintScreen: 'PrintScreen',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`',
  NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult', NumpadDivide: 'numdiv', NumpadDecimal: 'numdec',
};
const MODIFIER_CODES = /^(?:Control|Shift|Alt|Meta|OS)(?:Left|Right)?$|^(?:CapsLock|Fn|FnLock|AltGraph)$/;

/** Key part of an accelerator for a KeyboardEvent.code, or '' for modifier-only/unsupported keys. */
export function keyName(code = '') {
  let match;
  if ((match = /^Key([A-Z])$/.exec(code))) return match[1];
  if ((match = /^Digit(\d)$/.exec(code))) return match[1];
  if ((match = /^Numpad(\d)$/.exec(code))) return 'num' + match[1];
  if (/^F(?:[1-9]|1\d|2[0-4])$/.test(code)) return code;
  if (MODIFIER_CODES.test(code)) return '';
  return Object.hasOwn(NAMED, code) ? NAMED[code] : '';
}

/** Modifier names, in canonical order, held during a keyboard event. */
export function modifierNames(event, mac) {
  const names = [];
  if (mac ? event.metaKey : event.ctrlKey) names.push('CommandOrControl');
  if (mac && event.ctrlKey) names.push('Control');
  if (!mac && event.metaKey) names.push('Super');
  if (event.altKey) names.push('Alt');
  if (event.shiftKey) names.push('Shift');
  return names;
}

/**
 * Records a keydown as an accelerator.
 * Returns { accelerator } when complete, { pending } while only modifiers are held,
 * or { error } when a key is pressed without a modifier.
 */
export function recordShortcut(event, mac) {
  const modifiers = modifierNames(event, mac), key = keyName(event.code);
  if (!key) return { pending: modifiers.length ? modifiers.join('+') + '+…' : '' };
  if (!modifiers.length) return { error: `Hold Ctrl, Alt, Shift${mac ? ' or ⌘' : ' or Super'} with ${key}.` };
  return { accelerator: [...modifiers, key].join('+') };
}

/** Canonical form for comparing two accelerators that may use aliases (Ctrl, Cmd, Return…). */
export function shortcutIdentity(value, mac) {
  const aliases = {
    ctrl: 'control', cmd: 'command', option: 'alt', meta: mac ? 'command' : 'super',
    cmdorctrl: mac ? 'command' : 'control', commandorcontrol: mac ? 'command' : 'control',
  };
  const keys = { return: 'enter', esc: 'escape' };
  const parts = String(value || '').toLowerCase().split('+').map(part => part.trim());
  const key = parts.pop();
  return [...new Set(parts.map(part => aliases[part] || part))].sort().concat(keys[key] || key).join('+');
}

/** True when the keydown event produces the given accelerator. */
export function matchesShortcut(event, accelerator, mac) {
  const recorded = recordShortcut(event, mac).accelerator;
  return Boolean(recorded && accelerator) && shortcutIdentity(recorded, mac) === shortcutIdentity(accelerator, mac);
}
