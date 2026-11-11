import {isSpeechSupported} from './speech';

/**
 * How the user enters text inside an immersive session, where DOM inputs are
 * not visible:
 *  - 'keyboard': the headset's system keyboard (Meta Quest Browser 26.1+)
 *  - 'voice': Web Speech dictation (not available in Meta Quest Browser)
 *  - 'none': text can only be edited on the 2D screen after the session
 */
export type XRTextInputMethod = 'keyboard' | 'voice' | 'none';

interface SystemKeyboardSession {
  isSystemKeyboardSupported?: boolean;
}

export function pickTextInputMethod(
  session: XRSession | null,
): XRTextInputMethod {
  if ((session as SystemKeyboardSession | null)?.isSystemKeyboardSupported) {
    return 'keyboard';
  }
  return isSpeechSupported() ? 'voice' : 'none';
}

/**
 * Opens the system keyboard by focusing a hidden text field (Meta's WebXR
 * system keyboard contract). `onInput` sees every edit; `onDone` receives the
 * final text when the keyboard is dismissed (Done, hide, or a click outside).
 * Each opening is a fresh edit: the first key press replaces the whole value.
 *
 * Returns a cancel function (removes the field without calling `onDone`), or
 * null when the browser refused to focus the field, so no keyboard opened.
 */
export function editWithSystemKeyboard(
  initial: string,
  onInput: (text: string) => void,
  onDone: (text: string) => void,
): (() => void) | null {
  const field = document.createElement('input');
  field.type = 'text';
  field.value = initial;
  field.autocomplete = 'off';
  // Kept in the viewport (off-screen fields make the page scroll while typing)
  // but invisible: the headset shows the keyboard, the panel shows the text.
  field.style.cssText =
    'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;' +
    'pointer-events:none;border:0;padding:0;';
  document.body.appendChild(field);

  let finished = false;
  const finish = (commit: boolean) => {
    if (finished) return;
    finished = true;
    field.oninput = null;
    field.onblur = null;
    const text = field.value;
    field.remove();
    if (commit) onDone(text);
  };
  field.oninput = () => onInput(field.value);
  field.onblur = () => finish(true);

  field.focus();
  if (document.activeElement !== field) {
    finish(false);
    return null;
  }
  return () => finish(false);
}
