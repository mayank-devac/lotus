import {lotusSound} from '../sound';
import {isSpeechSupported} from '../speech';
import {PinShapeStyle, SpatialPin} from '../types';
import {PIN_COLOR_OPTIONS, escapeHtml} from './dom';
import {UIHost} from './UIHost';

/**
 * An opened pin: title and note edited in place (saved as you type), quick
 * style and colour, voice dictation into the note, and Delete / Move / Edit.
 */
export class PinInspectorModal {
  constructor(
    private readonly host: UIHost,
    private readonly layer: HTMLElement,
  ) {}
  public render(pin: SpatialPin) {
    this.layer.style.pointerEvents = 'auto';
    const currentStyle: PinShapeStyle =
      pin.shapeStyle ?? this.host.settings.defaultPinStyle ?? 'revolving';

    this.layer.innerHTML = `
      <div class="lotus-modal-backdrop">
        <section class="lotus-modal-card lotus-inspector-modal" role="dialog" aria-labelledby="inspector-title">
          <div class="lotus-modal-header">
            <div style="flex: 1; min-width: 0;">
              <div class="lotus-inspector-meta">
                <span class="lotus-pin-color-dot" style="background: ${pin.color};"></span>
                <span>${escapeHtml(pin.surfaceLabel)}</span>
              </div>
              <input
                type="text"
                id="inspector-inline-title-input"
                class="lotus-inline-title-input"
                value="${escapeHtml(pin.title)}"
                aria-label="Pin title"
              />
            </div>
            <button type="button" id="inspector-close-btn" class="lotus-icon-close-btn" aria-label="Close">✕</button>
          </div>

          <div class="lotus-modal-body" data-modal-id="inspector">
            <!-- Directly Editable Note Box + Mic Button -->
            <div class="lotus-full-note-box lotus-editable-note-box">
              <textarea
                id="inspector-inline-note-input"
                class="lotus-inline-note-textarea"
                rows="2"
                aria-label="Note content"
                placeholder="Write or speak your note here…"
              >${escapeHtml(pin.body)}</textarea>
              <button
                type="button"
                id="inspector-inline-mic-btn"
                class="lotus-inline-mic-btn ${this.host.dictation.inspectorListening ? 'is-listening' : ''}"
                aria-label="Dictate note with microphone"
                title="Voice input (Microphone)"
              >
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                  <line x1="12" y1="19" x2="12" y2="22"/>
                  <line x1="8" y1="22" x2="16" y2="22"/>
                </svg>
              </button>
            </div>

            <!-- Instant 1-Tap Color & Point Style Controls -->
            <div class="lotus-setup-section" style="padding-top: 4px; border-bottom: none; padding-bottom: 0;">
              <div class="lotus-inspector-style-stack">
                <div class="lotus-inspector-field">
                  <span class="lotus-field-label">Style</span>
                  <div class="lotus-preset-row">
                  <button
                    type="button"
                    data-quick-style="revolving"
                    class="lotus-chip-btn ${currentStyle === 'revolving' ? 'is-active' : ''}"
                  >
                    ◆ Revolving Shape
                  </button>
                  <button
                    type="button"
                    data-quick-style="dot"
                    class="lotus-chip-btn ${currentStyle === 'dot' ? 'is-active' : ''}"
                  >
                    ● Minimalistic Dot
                  </button>
                  </div>
                </div>

                <div class="lotus-inspector-field">
                  <span class="lotus-field-label">Color</span>
                  <div class="lotus-color-swatch-row">
                    ${PIN_COLOR_OPTIONS.map(
                      (c) => `
                      <button
                        type="button"
                        data-quick-color="${c.value}"
                        class="lotus-color-swatch ${pin.color.toUpperCase() === c.value.toUpperCase() ? 'is-selected' : ''}"
                        style="background-color: ${c.value};"
                        aria-label="${c.label}"
                        title="${c.label}"
                      ></button>
                    `,
                    ).join('')}
                    <input
                      type="color"
                      id="inspector-custom-color"
                      value="${pin.color || '#E84D2B'}"
                      class="lotus-color-picker-input"
                      title="Custom color"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="lotus-modal-footer">
            <button type="button" id="inspector-delete-btn" class="lotus-danger-btn">Delete</button>
            <div style="flex: 1;"></div>
            <button type="button" id="inspector-move-pin-btn" class="lotus-secondary-btn" title="Move pin to a new location in your surroundings">✥ Move Pin</button>
            <button type="button" id="inspector-edit-btn" class="lotus-primary-cta">Edit Note</button>
          </div>
        </section>
      </div>
    `;

    const inlineTitleInput = this.layer.querySelector(
      '#inspector-inline-title-input',
    ) as HTMLInputElement | null;
    const inlineNoteInput = this.layer.querySelector(
      '#inspector-inline-note-input',
    ) as HTMLTextAreaElement | null;
    const inlineMicBtn = this.layer.querySelector(
      '#inspector-inline-mic-btn',
    ) as HTMLButtonElement | null;

    const persistInlineEdits = () => {
      const nextTitle =
        inlineTitleInput?.value.trim() ||
        pin.title ||
        `Reminder at ${pin.surfaceLabel}`;
      const nextBody = inlineNoteInput?.value ?? pin.body;
      pin.title = nextTitle;
      pin.body = nextBody;
      this.host.pins = this.host.pins.map((p) => (p.id === pin.id ? {...pin} : p));
      this.host.callbacks.onSavePin({...pin});
      this.host.refreshPinMarkers();
    };

    inlineTitleInput?.addEventListener('input', persistInlineEdits);
    inlineNoteInput?.addEventListener('input', persistInlineEdits);

    inlineMicBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleVoiceDictation(pin, inlineNoteInput, inlineMicBtn);
    });

    this.layer
      .querySelector('#inspector-close-btn')
      ?.addEventListener('click', () => {
        persistInlineEdits();
        this.host.dictation.stop();
        this.host.closeModal('inspector');
        this.host.renderAll();
      });

    this.layer
      .querySelector('#inspector-move-pin-btn')
      ?.addEventListener('click', () => {
        persistInlineEdits();
        this.host.dictation.stop();
        this.host.enterPinRepositionMode(pin.id);
      });

    this.layer
      .querySelector('#inspector-edit-btn')
      ?.addEventListener('click', () => {
        persistInlineEdits();
        this.host.dictation.stop();
        this.host.openComposerForEditPin(pin);
      });

    this.layer
      .querySelector('#inspector-delete-btn')
      ?.addEventListener('click', () => {
        this.host.dictation.stop();
        this.host.closeModal('inspector');
        this.host.callbacks.onDeletePin(pin.id);
        this.host.refreshPinMarkers();
        this.host.renderAll();
      });

    this.layer.querySelectorAll('[data-quick-style]').forEach((btn) => {
      btn.addEventListener('click', () => {
        persistInlineEdits();
        const nextStyle = (btn as HTMLElement).dataset
          .quickStyle as PinShapeStyle;
        const updated: SpatialPin = {...pin, shapeStyle: nextStyle};
        lotusSound.playKeyTap();
        this.host.callbacks.onSavePin(updated);
        this.render(updated);
      });
    });

    this.layer.querySelectorAll('[data-quick-color]').forEach((btn) => {
      btn.addEventListener('click', () => {
        persistInlineEdits();
        const nextColor =
          (btn as HTMLElement).dataset.quickColor || '#E84D2B';
        const updated: SpatialPin = {...pin, color: nextColor};
        lotusSound.playKeyTap();
        this.host.callbacks.onSavePin(updated);
        this.host.refreshPinMarkers();
        this.render(updated);
      });
    });

    const customPicker = this.layer.querySelector(
      '#inspector-custom-color',
    ) as HTMLInputElement | null;
    customPicker?.addEventListener('input', () => {
      persistInlineEdits();
      const updated: SpatialPin = {...pin, color: customPicker.value};
      this.host.callbacks.onSavePin(updated);
      this.host.refreshPinMarkers();
    });
  }

  private toggleVoiceDictation(
    pin: SpatialPin,
    noteTextarea: HTMLTextAreaElement | null,
    micBtn: HTMLButtonElement | null,
  ) {
    if (this.host.dictation.inspectorListening) {
      this.host.dictation.stop();
      micBtn?.classList.remove('is-listening');
      return;
    }

    const applyDictatedNote = (spokenText: string) => {
      const currentVal = noteTextarea ? noteTextarea.value : pin.body;
      const nextBody = currentVal.trim()
        ? `${currentVal.trim()} ${spokenText.trim()}`
        : spokenText.trim();
      if (noteTextarea) {
        noteTextarea.value = nextBody;
      }
      pin.body = nextBody;
      this.host.pins = this.host.pins.map((p) => (p.id === pin.id ? {...pin} : p));
      this.host.callbacks.onSavePin({...pin});
      this.host.refreshPinMarkers();
    };

    if (!isSpeechSupported()) {
      lotusSound.playKeyTap();
      noteTextarea?.focus();
      applyDictatedNote(`Voice note added for ${pin.surfaceLabel}.`);
      return;
    }

    const stopListening = () => {
      this.host.dictation.inspectorListening = false;
      micBtn?.classList.remove('is-listening');
    };
    this.host.dictation.inspectorListening = true;
    micBtn?.classList.add('is-listening');
    lotusSound.playKeyTap();
    if (!this.host.dictation.start(applyDictatedNote, stopListening)) stopListening();
  }
}
