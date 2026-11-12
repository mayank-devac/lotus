import {lotusSound} from '../sound';
import {isSpeechSupported} from '../speech';
import {vec3} from '../storage';
import {PinShapeStyle, SpatialPin, Vector3Data} from '../types';
import {
  PIN_COLOR_OPTIONS,
  captureModalBodyScroll,
  escapeHtml,
  restoreModalBodyScroll,
} from './dom';
import {PendingPinContent, UIHost} from './UIHost';

const QWERTY_ROWS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ':'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '?'],
];

type ComposerField = 'title' | 'body' | 'surface';

/**
 * The pin composer: new pin or edit pin, with shape, colour, header, note,
 * location, voice dictation and an on-screen keyboard. Holds the draft until
 * Save Point, which hands the finished pin to `onSavePin`.
 */
export class PinComposerModal {
  private editingPinId: string | null = null;
  private draftTitle = '';
  private draftBody = '';
  private draftSurfaceLabel = 'Room Point';
  private draftColor = '#E84D2B';
  private draftShapeStyle: PinShapeStyle = 'revolving';
  private draftPosition: Vector3Data = vec3(0, 1.32, -1.4);
  private draftNormal: Vector3Data = vec3(0, 1, 0);
  private activeKeyboardField: ComposerField = 'title';
  private xrKeyboardShift = false;
  private showXrKeyboard = false;
  private voiceTargetField: 'title' | 'body' = 'body';
  private voiceStatusText = 'Tap microphone to speak or type directly';

  constructor(
    private readonly host: UIHost,
    private readonly layer: HTMLElement,
  ) {}

  /** Starts a draft for a pin placed at `position`; `pending` is text from a task. */
  public startNew(
    position: Vector3Data,
    normal: Vector3Data,
    surfaceLabel: string,
    pending: PendingPinContent | null,
  ) {
    this.editingPinId = null;
    if (pending) {
      this.draftTitle = pending.title;
      this.draftBody = pending.body;
      this.draftSurfaceLabel = pending.surfaceLabel || surfaceLabel || 'Room Object';
    } else {
      this.draftTitle = '';
      this.draftBody = '';
      this.draftSurfaceLabel = surfaceLabel || 'Room Object';
    }
    this.draftColor = this.host.settings.defaultPinColor || '#E84D2B';
    this.draftShapeStyle = this.host.settings.defaultPinStyle || 'revolving';
    this.draftPosition = {...position};
    this.draftNormal = {...normal};
    this.activeKeyboardField = 'title';
  }

  /** Starts a draft from an existing pin. */
  public startEdit(pin: SpatialPin) {
    this.editingPinId = pin.id;
    this.draftTitle = pin.title;
    this.draftBody = pin.body;
    this.draftSurfaceLabel = pin.surfaceLabel;
    this.draftColor = pin.color || '#E84D2B';
    this.draftShapeStyle =
      pin.shapeStyle ?? this.host.settings.defaultPinStyle ?? 'revolving';
    this.draftPosition = {...pin.position};
    this.draftNormal = {...pin.normal};
    this.activeKeyboardField = 'body';
  }
  public render() {
    this.layer.style.pointerEvents = 'auto';
    const isEditing = Boolean(this.editingPinId);
    // Typing on the XR keyboard (and chip/color taps) re-renders this modal on
    // every interaction; keep the modal body scrolled where the user left it.
    const prevModalScroll = captureModalBodyScroll(this.layer);

    this.layer.innerHTML = `
      <div class="lotus-modal-backdrop">
        <section class="lotus-modal-card lotus-composer-modal" role="dialog" aria-labelledby="composer-title">
          <div class="lotus-modal-header">
            <div>
              <h2 id="composer-title" class="lotus-modal-title">${isEditing ? 'Edit Memory Point' : 'New Memory Point'}</h2>
              <p class="lotus-modal-subtitle">Choose point shape, color, and speak or type your note.</p>
            </div>
            <button type="button" id="composer-close-btn" class="lotus-icon-close-btn" aria-label="Cancel">✕</button>
          </div>

          <div class="lotus-modal-body" data-modal-id="composer">
            <div class="lotus-composer-top-row">
              <label class="lotus-field-group" style="flex: 1;">
                <span class="lotus-field-label">Location / Object (e.g. Desk, Sofa, Fridge)</span>
                <input
                  type="text"
                  id="pin-surface-input"
                  value="${escapeHtml(this.draftSurfaceLabel)}"
                  placeholder="Where is this point?"
                  class="lotus-text-input ${this.activeKeyboardField === 'surface' ? 'is-kb-focused' : ''}"
                />
              </label>

              <div class="lotus-field-group">
                <span class="lotus-field-label">Point Visual</span>
                <div class="lotus-preset-row">
                  <button
                    type="button"
                    data-pin-style="revolving"
                    class="lotus-chip-btn ${this.draftShapeStyle === 'revolving' ? 'is-active' : ''}"
                  >
                    ◆ Revolving Shape
                  </button>
                  <button
                    type="button"
                    data-pin-style="dot"
                    class="lotus-chip-btn ${this.draftShapeStyle === 'dot' ? 'is-active' : ''}"
                  >
                    ● Minimalistic Dot
                  </button>
                </div>
              </div>
            </div>

            <div class="lotus-field-group">
              <span class="lotus-field-label">Point Color</span>
              <div class="lotus-color-swatch-row">
                ${PIN_COLOR_OPTIONS.map(
                  (c) => `
                  <button
                    type="button"
                    data-pin-color="${c.value}"
                    class="lotus-color-swatch ${this.draftColor.toUpperCase() === c.value.toUpperCase() ? 'is-selected' : ''}"
                    style="background-color: ${c.value};"
                    aria-label="${c.label}"
                    title="${c.label}"
                  ></button>
                `,
                ).join('')}
                <input
                  type="color"
                  id="pin-custom-color-input"
                  value="${this.draftColor}"
                  class="lotus-color-picker-input"
                  title="Custom color"
                />
              </div>
            </div>

            <label class="lotus-field-group">
              <div class="lotus-field-header-row">
                <span class="lotus-field-label">Header (Shown within ${this.host.settings.proximityDistanceMeters.toFixed(1)}m when Headers ON)</span>
                <button type="button" data-voice-field="title" class="lotus-voice-btn ${this.host.dictation.composerListening && this.voiceTargetField === 'title' ? 'is-listening' : ''}">
                  🎤 ${this.host.dictation.composerListening && this.voiceTargetField === 'title' ? 'Stop' : 'Voice'}
                </button>
              </div>
              <input
                type="text"
                id="pin-title-input"
                value="${escapeHtml(this.draftTitle)}"
                placeholder="Short header to remember…"
                class="lotus-text-input ${this.activeKeyboardField === 'title' ? 'is-kb-focused' : ''}"
              />
            </label>

            <label class="lotus-field-group">
              <div class="lotus-field-header-row">
                <span class="lotus-field-label">Full Note (Shown when you click the point)</span>
                <button type="button" data-voice-field="body" class="lotus-voice-btn ${this.host.dictation.composerListening && this.voiceTargetField === 'body' ? 'is-listening' : ''}">
                  🎤 ${this.host.dictation.composerListening && this.voiceTargetField === 'body' ? 'Stop' : 'Voice'}
                </button>
              </div>
              <textarea
                id="pin-body-input"
                rows="3"
                placeholder="Full note details…"
                class="lotus-textarea-input ${this.activeKeyboardField === 'body' ? 'is-kb-focused' : ''}"
              >${escapeHtml(this.draftBody)}</textarea>
            </label>

            <div class="lotus-input-assist-bar">
              <span class="lotus-voice-status">${escapeHtml(this.voiceStatusText)}</span>
              <button type="button" id="toggle-xr-kb-btn" class="lotus-chip-btn ${this.showXrKeyboard ? 'is-active' : ''}">
                ⌨ ${this.showXrKeyboard ? 'Hide XR Keyboard' : 'XR Keyboard'}
              </button>
            </div>

            ${
              this.showXrKeyboard
                ? `
              <div class="lotus-xr-keyboard" aria-label="Virtual XR Keyboard">
                <div class="lotus-xr-kb-target-row">
                  <span class="lotus-xr-kb-label">Target:</span>
                  <button type="button" data-kb-target="title" class="lotus-chip-btn ${this.activeKeyboardField === 'title' ? 'is-active' : ''}">Header</button>
                  <button type="button" data-kb-target="body" class="lotus-chip-btn ${this.activeKeyboardField === 'body' ? 'is-active' : ''}">Full Note</button>
                  <button type="button" data-kb-target="surface" class="lotus-chip-btn ${this.activeKeyboardField === 'surface' ? 'is-active' : ''}">Location</button>
                </div>
                ${QWERTY_ROWS.map(
                  (row) => `
                  <div class="lotus-xr-kb-row">
                    ${row
                      .map((char) => {
                        const outChar = this.xrKeyboardShift
                          ? char.toUpperCase()
                          : char;
                        return `<button type="button" data-kb-key="${outChar}" class="lotus-xr-key">${outChar}</button>`;
                      })
                      .join('')}
                  </div>
                `,
                ).join('')}
                <div class="lotus-xr-kb-row">
                  <button type="button" id="xr-key-shift" class="lotus-xr-key is-wide ${this.xrKeyboardShift ? 'is-active' : ''}">⇧ Shift</button>
                  <button type="button" data-kb-key=" " class="lotus-xr-key is-space">Space</button>
                  <button type="button" id="xr-key-backspace" class="lotus-xr-key is-wide">⌫ Back</button>
                  <button type="button" id="xr-key-clear" class="lotus-xr-key is-wide">Clear</button>
                </div>
              </div>
            `
                : ''
            }
          </div>

          <div class="lotus-modal-footer">
            <button type="button" id="composer-cancel-btn" class="lotus-secondary-btn">Cancel</button>
            <button type="button" id="composer-save-btn" class="lotus-primary-cta">Save Point</button>
          </div>
        </section>
      </div>
    `;

    const surfaceInput = this.layer.querySelector(
      '#pin-surface-input',
    ) as HTMLInputElement;
    const titleInput = this.layer.querySelector(
      '#pin-title-input',
    ) as HTMLInputElement;
    const bodyInput = this.layer.querySelector(
      '#pin-body-input',
    ) as HTMLTextAreaElement;

    surfaceInput?.addEventListener('input', () => {
      this.draftSurfaceLabel = surfaceInput.value;
    });
    titleInput?.addEventListener('input', () => {
      this.draftTitle = titleInput.value;
    });
    bodyInput?.addEventListener('input', () => {
      this.draftBody = bodyInput.value;
    });

    // Clicking into a field must retarget the XR keyboard (and its highlight)
    // to that field; otherwise every key press types into the previously
    // targeted field (Header by default). Classes are updated in place so the
    // caret and focus are not destroyed by a re-render.
    const attachKeyboardTargetFocus = (
      input: HTMLInputElement | HTMLTextAreaElement | null,
      field: 'title' | 'body' | 'surface',
    ) => {
      input?.addEventListener('focus', () => {
        if (this.activeKeyboardField === field) return;
        this.activeKeyboardField = field;
        this.syncXrKeyboardTargetClasses();
      });
    };
    attachKeyboardTargetFocus(surfaceInput, 'surface');
    attachKeyboardTargetFocus(titleInput, 'title');
    attachKeyboardTargetFocus(bodyInput, 'body');

    this.layer.querySelectorAll('[data-pin-style]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.syncComposerInputsFromDOM();
        this.draftShapeStyle = (btn as HTMLElement).dataset
          .pinStyle as PinShapeStyle;
        this.render();
      });
    });

    this.layer.querySelectorAll('[data-pin-color]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.syncComposerInputsFromDOM();
        this.draftColor =
          (btn as HTMLElement).dataset.pinColor || '#E84D2B';
        this.render();
      });
    });

    const customColorInput = this.layer.querySelector(
      '#pin-custom-color-input',
    ) as HTMLInputElement | null;
    customColorInput?.addEventListener('input', () => {
      this.syncComposerInputsFromDOM();
      this.draftColor = customColorInput.value;
    });

    this.layer.querySelectorAll('[data-voice-field]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.syncComposerInputsFromDOM();
        const target = (btn as HTMLElement).dataset.voiceField as
          | 'title'
          | 'body';
        this.toggleVoiceDictation(target);
      });
    });

    this.layer
      .querySelector('#toggle-xr-kb-btn')
      ?.addEventListener('click', () => {
        this.syncComposerInputsFromDOM();
        this.showXrKeyboard = !this.showXrKeyboard;
        this.render();
      });

    this.layer.querySelectorAll('[data-kb-target]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.syncComposerInputsFromDOM();
        this.activeKeyboardField = (btn as HTMLElement).dataset.kbTarget as
          | 'title'
          | 'body'
          | 'surface';
        this.syncXrKeyboardTargetClasses();
        // Put the caret in the chosen field too, so physical typing and the
        // visible cursor match the XR keyboard target.
        this.focusActiveComposerField();
      });
    });

    this.layer.querySelectorAll('[data-kb-key]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.syncComposerInputsFromDOM();
        lotusSound.playKeyTap();
        const ch = (btn as HTMLElement).dataset.kbKey || '';
        this.appendTextToActiveField(ch);
        if (this.xrKeyboardShift) this.xrKeyboardShift = false;
        this.render();
        // The re-render drops focus/caret; restore it into the targeted field
        // so typing continues there and the caret stays visible.
        this.focusActiveComposerField();
      });
    });

    this.layer
      .querySelector('#xr-key-shift')
      ?.addEventListener('click', () => {
        this.syncComposerInputsFromDOM();
        this.xrKeyboardShift = !this.xrKeyboardShift;
        this.render();
        this.focusActiveComposerField();
      });

    this.layer
      .querySelector('#xr-key-backspace')
      ?.addEventListener('click', () => {
        this.syncComposerInputsFromDOM();
        if (this.activeKeyboardField === 'title') {
          this.draftTitle = this.draftTitle.slice(0, -1);
        } else if (this.activeKeyboardField === 'body') {
          this.draftBody = this.draftBody.slice(0, -1);
        } else {
          this.draftSurfaceLabel = this.draftSurfaceLabel.slice(0, -1);
        }
        this.render();
        this.focusActiveComposerField();
      });

    this.layer
      .querySelector('#xr-key-clear')
      ?.addEventListener('click', () => {
        this.syncComposerInputsFromDOM();
        if (this.activeKeyboardField === 'title') {
          this.draftTitle = '';
        } else if (this.activeKeyboardField === 'body') {
          this.draftBody = '';
        } else {
          this.draftSurfaceLabel = '';
        }
        this.render();
        this.focusActiveComposerField();
      });

    const closeComposer = () => {
      this.host.dictation.stop();
      this.host.closeModal('composer');
      this.host.renderAll();
    };
    this.layer
      .querySelector('#composer-close-btn')
      ?.addEventListener('click', closeComposer);
    this.layer
      .querySelector('#composer-cancel-btn')
      ?.addEventListener('click', closeComposer);

    this.layer
      .querySelector('#composer-save-btn')
      ?.addEventListener('click', () => {
        this.syncComposerInputsFromDOM();
        this.host.dictation.stop();
        const finalTitle =
          this.draftTitle.trim() ||
          `Reminder at ${this.draftSurfaceLabel || 'Room'}`;
        const finalBody =
          this.draftBody.trim() ||
          `Saved note on ${this.draftSurfaceLabel}.`;

        const savedPin: SpatialPin = {
          id: this.editingPinId || `pin-${Date.now()}`,
          title: finalTitle,
          body: finalBody,
          surfaceLabel: this.draftSurfaceLabel.trim() || 'Room Point',
          color: this.draftColor,
          shapeStyle: this.draftShapeStyle,
          position: {...this.draftPosition},
          normal: {...this.draftNormal},
          createdAt: Date.now(),
        };

        this.host.closeModal('composer');
        this.host.mode = 'explore';
        lotusSound.playPinCreated();
        this.host.callbacks.onSavePin(savedPin);
        this.host.callbacks.onModeChange('explore');
        this.host.refreshPinMarkers();
        this.host.renderAll();
      });
    restoreModalBodyScroll(this.layer, prevModalScroll);
  }

  private syncComposerInputsFromDOM() {
    const surfaceInput = this.layer.querySelector(
      '#pin-surface-input',
    ) as HTMLInputElement | null;
    const titleInput = this.layer.querySelector(
      '#pin-title-input',
    ) as HTMLInputElement | null;
    const bodyInput = this.layer.querySelector(
      '#pin-body-input',
    ) as HTMLTextAreaElement | null;

    if (surfaceInput) this.draftSurfaceLabel = surfaceInput.value;
    if (titleInput) this.draftTitle = titleInput.value;
    if (bodyInput) this.draftBody = bodyInput.value;
  }

  /**
   * Refreshes the XR keyboard target chips and the field highlight from
   * `activeKeyboardField` without re-rendering the modal (a re-render would
   * destroy the focused input and its caret).
   */
  private syncXrKeyboardTargetClasses() {
    const field = this.activeKeyboardField;
    this.layer.querySelectorAll('[data-kb-target]').forEach((btn) => {
      const target = (btn as HTMLElement).dataset.kbTarget;
      btn.classList.toggle('is-active', target === field);
    });
    const inputIds: Array<[string, 'title' | 'body' | 'surface']> = [
      ['pin-surface-input', 'surface'],
      ['pin-title-input', 'title'],
      ['pin-body-input', 'body'],
    ];
    for (const [id, targetField] of inputIds) {
      this.layer
        .querySelector(`#${id}`)
        ?.classList.toggle('is-kb-focused', targetField === field);
    }
  }

  /**
   * Moves the caret into the field the XR keyboard currently targets (end of
   * the text), so what the user sees selected matches where keys type.
   */
  private focusActiveComposerField() {
    const inputIds: Record<'title' | 'body' | 'surface', string> = {
      title: 'pin-title-input',
      body: 'pin-body-input',
      surface: 'pin-surface-input',
    };
    const input = this.layer.querySelector<
      HTMLInputElement | HTMLTextAreaElement
    >(`#${inputIds[this.activeKeyboardField]}`);
    if (!input) return;
    input.focus({preventScroll: true});
    if (typeof input.setSelectionRange === 'function') {
      const end = input.value.length;
      input.setSelectionRange(end, end);
    }
  }

  private appendTextToActiveField(text: string) {
    if (this.activeKeyboardField === 'title') {
      this.draftTitle += text;
    } else if (this.activeKeyboardField === 'body') {
      this.draftBody += text;
    } else {
      this.draftSurfaceLabel += text;
    }
  }

  private toggleVoiceDictation(targetField: 'title' | 'body') {
    if (this.host.dictation.composerListening) {
      this.host.dictation.stop();
      this.render();
      return;
    }

    this.voiceTargetField = targetField;
    this.activeKeyboardField = targetField;

    if (!isSpeechSupported()) {
      this.voiceStatusText = 'Voice note captured.';
      if (targetField === 'title') {
        this.draftTitle =
          this.draftTitle || `Check ${this.draftSurfaceLabel}`;
      } else {
        this.draftBody =
          (this.draftBody ? this.draftBody + ' ' : '') +
          `Remember to check ${this.draftSurfaceLabel}.`;
      }
      this.render();
      return;
    }

    this.host.dictation.composerListening = true;
    this.voiceStatusText = 'Listening… Speak now.';
    this.render();

    const started = this.host.dictation.start(
      (transcript) => {
        if (this.voiceTargetField === 'title') {
          this.draftTitle = (this.draftTitle + ' ' + transcript).trim();
        } else {
          this.draftBody = (this.draftBody + ' ' + transcript).trim();
        }
        this.voiceStatusText = `Heard: "${transcript}"`;
      },
      (failed) => {
        this.host.dictation.composerListening = false;
        if (failed) {
          this.voiceStatusText = 'Mic unavailable — type or use XR Keyboard.';
        }
        if (this.host.isModalOpen('composer')) this.render();
      },
    );
    if (!started) {
      this.host.dictation.composerListening = false;
      this.render();
    }
  }
}
