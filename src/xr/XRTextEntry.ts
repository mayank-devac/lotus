import {dictateOnce, isSpeechSupported} from '../speech';
import {XRInterface} from './XRInterface';
import {XRKeyAction, XRTextRequest} from './XRTextEditor';
import {editWithSystemKeyboard, isSystemKeyboardSupported} from './xrTextInput';

/**
 * Text entry in a headset: the in-scene keyboard (XRTextEditor), voice
 * dictation into it, and the Quest system keyboard. Fields ask for text
 * through `request`; this class decides when the text is applied.
 */
export class XRTextEntry {
  // Text entry. `textEdit` is the edit the keyboard is open for: `apply`
  // saves the typed text, `alive` is false once what it edits has gone (card
  // closed, task form cancelled), which closes the keyboard.
  private textEdit: {apply: (text: string) => void; alive: () => boolean} | null = null;
  private systemKeyboard = false;
  private stopDictation: (() => void) | null = null;
  private stopSystemKeyboard: (() => void) | null = null;
  /**
   * The headset-keyboard key was pressed. That keyboard opens on the
   * browser's own `select` event (pinch release): xrblocks reports pinches
   * from its frame loop, outside the user gesture `focus()` needs.
   */
  private pendingSystemKeyboard = false;

  constructor(private readonly ui: XRInterface) {}

  /** Checks whether this session offers the headset's own keyboard. */
  public setSession(session: XRSession | null) {
    this.systemKeyboard = isSystemKeyboardSupported(session);
  }

  public isOpen(): boolean {
    return this.ui.editor.isOpen();
  }

  /** Closes the keyboard once what it edits has gone (card closed, task form cancelled). */
  public closeIfStale() {
    if (this.textEdit && !this.textEdit.alive()) this.close();
  }
  /**
   * Opens the keyboard. `apply` receives the trimmed text when the user
   * presses Done; Cancel drops the edit. The keyboard closes by itself once
   * `alive` turns false. Moving on to another field keeps what was typed in
   * the current one.
   */
  public request(
    request: XRTextRequest,
    apply: (text: string) => void,
    alive: () => boolean,
  ) {
    this.commit();
    this.stopTextTools();
    this.textEdit = {apply, alive};
    this.ui.editor.open(request, {
      voice: isSpeechSupported(),
      systemKeyboard: this.systemKeyboard,
    });
  }

  public close() {
    this.stopTextTools();
    this.textEdit = null;
    this.ui.editor.close();
  }

  /** Saves what is on the keyboard to its field, as Done would, but keeps the keyboard open. */
  public commit() {
    const edit = this.textEdit;
    if (!edit || !this.ui.editor.isOpen() || !edit.alive()) return;
    edit.apply(this.ui.editor.getText().trim());
    this.ui.invalidateDrawer();
  }

  /** Stops dictation and the headset keyboard, whichever is running. */
  private stopTextTools() {
    this.pendingSystemKeyboard = false;
    this.stopDictation?.();
    this.stopDictation = null;
    this.stopSystemKeyboard?.();
    this.stopSystemKeyboard = null;
  }

  public runAction(action: XRKeyAction) {
    const editor = this.ui.editor;
    if (editor.press(action)) {
      // Typing dismisses an old message, but not "Listening…".
      if (!this.stopDictation) editor.setStatus('');
      return;
    }
    switch (action) {
      case 'done': {
        const apply = this.textEdit?.apply;
        const text = editor.getText().trim();
        this.close();
        apply?.(text);
        // A task form's field shows the new text at once.
        this.ui.invalidateDrawer();
        return;
      }
      case 'cancel':
        this.close();
        return;
      case 'move':
        return; // A drag, handled in selectStart.
      case 'voice':
        this.toggleDictation();
        return;
      case 'system-keyboard':
        this.stopTextTools();
        // Opens on release; see `pendingSystemKeyboard`.
        this.pendingSystemKeyboard = true;
        return;
    }
  }

  private toggleDictation() {
    const editor = this.ui.editor;
    if (this.stopDictation) {
      this.stopDictation();
      this.stopDictation = null;
      editor.setStatus('');
      return;
    }
    this.stopTextTools();
    const edit = this.textEdit;
    const stop = dictateOnce(
      (text) => {
        if (this.textEdit === edit) editor.insert(text);
      },
      (failed) => {
        if (this.stopDictation !== stop) return;
        this.stopDictation = null;
        editor.setStatus(failed ? 'Could not hear that. Check mic access and try again.' : '');
      },
    );
    if (!stop) {
      editor.setStatus('Voice input is not available in this browser.');
      return;
    }
    this.stopDictation = stop;
    editor.setStatus('Listening… speak now', true);
  }

  public openSystemKeyboard() {
    if (!this.pendingSystemKeyboard) return;
    this.pendingSystemKeyboard = false;
    const editor = this.ui.editor;
    const edit = this.textEdit;
    if (!edit || !editor.isOpen()) return;
    const stop = editWithSystemKeyboard(
      editor.getText(),
      (text) => {
        if (this.textEdit === edit) editor.setText(text);
      },
      (text) => {
        if (this.stopSystemKeyboard !== stop) return;
        this.stopSystemKeyboard = null;
        editor.setText(text);
        editor.setStatus('');
      },
    );
    if (!stop) {
      editor.setStatus('The headset keyboard did not open. Use the keys below.');
      return;
    }
    this.stopSystemKeyboard = stop;
    editor.setStatus('Type on the headset keyboard, then close it and press Done');
  }
}
