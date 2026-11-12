import MONO_LOTUS_SVG from '../../assets/icon.svg?raw';
import {ROOM_WAYPOINTS} from '../storage';
import {AmbientLightMode, PinShapeStyle, ShieldStyle, TimerMode} from '../types';
import {PIN_COLOR_OPTIONS} from './dom';
import {UIHost} from './UIHost';

/**
 * The SETUP modal: default pin style and colour, header pop-ups, focus timer
 * mode and length, peripheral blur style, proximity radius, ambient light,
 * camera and demo-room switches. Edits the live settings object in place and
 * reports each change through `onSettingsChange`.
 */
export class SetupModal {
  /** The camera distance step the "Distance" button walks between. */
  private activeWaypointId = 'desk';

  constructor(
    private readonly host: UIHost,
    private readonly layer: HTMLElement,
  ) {}
  public render() {
    this.layer.style.pointerEvents = 'auto';
    this.layer.innerHTML = `
      <div class="lotus-modal-backdrop">
        <section class="lotus-modal-card lotus-welcome-modal" role="dialog" aria-labelledby="welcome-title">
          <div class="lotus-modal-header">
            <div class="lotus-welcome-brand-row">
              <div class="lotus-mono-badge">${MONO_LOTUS_SVG}</div>
              <div>
                <h2 id="welcome-title" class="lotus-modal-title">LOTUS Setup</h2>
                <p class="lotus-modal-subtitle">Configure point style, header pop-ups, focus timer, and peripheral blur.</p>
              </div>
            </div>
            <button type="button" id="welcome-close-btn" class="lotus-icon-close-btn" aria-label="Close">✕</button>
          </div>

          <div class="lotus-modal-body" data-modal-id="welcome">
            <!-- 1. Point Appearance & Header Auto-Pop Switch -->
            <div class="lotus-setup-section">
              <div class="lotus-setup-label-row">
                <h3 class="lotus-setup-heading">01. Spatial Point Style, Color &amp; Header Pop-Up</h3>
              </div>

              <div class="lotus-segmented-grid" style="grid-template-columns: repeat(2, 1fr);">
                <button type="button" data-default-style="revolving" class="lotus-choice-btn ${this.host.settings.defaultPinStyle === 'revolving' ? 'is-selected' : ''}">
                  <span class="lotus-choice-title">◆ Revolving 3D Shape</span>
                  <span class="lotus-choice-desc">Floating geometric crystal that revolves in space</span>
                </button>
                <button type="button" data-default-style="dot" class="lotus-choice-btn ${this.host.settings.defaultPinStyle === 'dot' ? 'is-selected' : ''}">
                  <span class="lotus-choice-title">● Minimalistic Dot (Just a Point)</span>
                  <span class="lotus-choice-desc">Clean, minimal floating sphere point</span>
                </button>
              </div>

              <div class="lotus-proximity-controls-row" style="margin-top: 6px; justify-content: space-between;">
                <div class="lotus-inline-field">
                  <span>Default Color:</span>
                  <div class="lotus-color-swatch-row">
                    ${PIN_COLOR_OPTIONS.map(
                      (c) => `
                      <button
                        type="button"
                        data-default-color="${c.value}"
                        class="lotus-color-swatch ${this.host.settings.defaultPinColor === c.value ? 'is-selected' : ''}"
                        style="background-color: ${c.value};"
                        aria-label="${c.label}"
                      ></button>
                    `,
                    ).join('')}
                    <input
                      type="color"
                      id="setup-custom-color"
                      value="${this.host.settings.defaultPinColor || '#E84D2B'}"
                      class="lotus-color-picker-input"
                      title="Pick custom color"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  id="setup-header-pop-toggle"
                  class="lotus-chip-btn ${this.host.settings.headerPopEnabled ? 'is-active' : ''}"
                >
                  Popping Header UI: ${this.host.settings.headerPopEnabled ? 'ON' : 'OFF (Point Only)'}
                </button>
              </div>
            </div>

            <!-- 2. Timer Mode -->
            <div class="lotus-setup-section">
              <div class="lotus-setup-label-row">
                <h3 class="lotus-setup-heading">02. Focus Timer Mode</h3>
              </div>
              <div class="lotus-segmented-grid">
                <button type="button" data-timer-mode="preset" class="lotus-choice-btn ${this.host.settings.timerMode === 'preset' ? 'is-selected' : ''}">
                  <span class="lotus-choice-title">Preset Durations</span>
                  <span class="lotus-choice-desc">1m, 15m, 25m, 45m, 60m</span>
                </button>
                <button type="button" data-timer-mode="custom" class="lotus-choice-btn ${this.host.settings.timerMode === 'custom' ? 'is-selected' : ''}">
                  <span class="lotus-choice-title">Custom Countdown</span>
                  <span class="lotus-choice-desc">Set exact minutes &amp; seconds</span>
                </button>
                <button type="button" data-timer-mode="stopwatch" class="lotus-choice-btn ${this.host.settings.timerMode === 'stopwatch' ? 'is-selected' : ''}">
                  <span class="lotus-choice-title">Stopwatch Mode</span>
                  <span class="lotus-choice-desc">Counts up from 00:00</span>
                </button>
              </div>

              <div class="lotus-timer-subconfig">
                ${
                  this.host.settings.timerMode === 'preset'
                    ? `
                  <div class="lotus-preset-row">
                    ${[1, 15, 25, 45, 60]
                      .map(
                        (m) => `
                      <button type="button" data-preset-min="${m}" class="lotus-chip-btn ${this.host.settings.presetMinutes === m ? 'is-active' : ''}">
                        ${m === 1 ? '1m' : `${m}m`}
                      </button>
                    `,
                      )
                      .join('')}
                  </div>
                `
                    : this.host.settings.timerMode === 'custom'
                      ? `
                  <div class="lotus-custom-time-row">
                    <label class="lotus-inline-field">
                      <span>Min:</span>
                      <input type="number" id="custom-min-input" min="0" max="180" value="${this.host.settings.customMinutes}" class="lotus-num-input" />
                    </label>
                    <label class="lotus-inline-field">
                      <span>Sec:</span>
                      <input type="number" id="custom-sec-input" min="0" max="59" value="${this.host.settings.customSeconds}" class="lotus-num-input" />
                    </label>
                  </div>
                `
                      : ''
                }
              </div>
            </div>

            <!-- 3. Peripheral Shield Style -->
            <div class="lotus-setup-section">
              <div class="lotus-setup-label-row">
                <h3 class="lotus-setup-heading">03. Peripheral Blur Style</h3>
              </div>
              <div class="lotus-segmented-grid">
                <button type="button" data-shield-style="frosted" class="lotus-choice-btn ${this.host.settings.shieldStyle === 'frosted' ? 'is-selected' : ''}">
                  <span class="lotus-choice-title">Frosted Blur</span>
                  <span class="lotus-choice-desc">Translucent optical blur outside focus area</span>
                </button>
                <button type="button" data-shield-style="dark" class="lotus-choice-btn ${this.host.settings.shieldStyle === 'dark' ? 'is-selected' : ''}">
                  <span class="lotus-choice-title">Opaque Dark Mask</span>
                  <span class="lotus-choice-desc">Deep dark blackout outside focus area</span>
                </button>
                <button type="button" data-shield-style="ambient" class="lotus-choice-btn ${this.host.settings.shieldStyle === 'ambient' ? 'is-selected' : ''}">
                  <span class="lotus-choice-title">Soft Ambient Tint</span>
                  <span class="lotus-choice-desc">Warm study tint + soft blur</span>
                </button>
              </div>
            </div>

            <!-- 4. Camera & Proximity Radius -->
            <div class="lotus-setup-section">
              <div class="lotus-setup-label-row">
                <h3 class="lotus-setup-heading">04. Real-World Camera &amp; Proximity Radius</h3>
              </div>
              <div class="lotus-proximity-controls-row">
                <label class="lotus-slider-label">
                  <span>Auto-Pop Radius: <strong class="lotus-tabular" id="prox-radius-readout">${this.host.settings.proximityDistanceMeters.toFixed(1)}m</strong></span>
                  <input type="range" id="prox-radius-slider" min="0.5" max="4.0" step="0.1" value="${this.host.settings.proximityDistanceMeters}" />
                </label>

                <label class="lotus-slider-label">
                  <span>Light Duration: <strong class="lotus-tabular" id="ambient-duration-readout">${this.host.settings.ambientLightDurationSec}s</strong></span>
                  <input type="range" id="ambient-duration-slider" min="2" max="30" step="1" value="${this.host.settings.ambientLightDurationSec}" />
                </label>

                <label class="lotus-slider-label is-wide">
                  <span>Ambient Border Light</span>
                  <select id="ambient-mode-select" class="lotus-select">
                    <option value="none" ${this.host.settings.ambientLightMode === 'none' ? 'selected' : ''}>None</option>
                    <option value="timer" ${this.host.settings.ambientLightMode === 'timer' ? 'selected' : ''}>Timer running</option>
                    <option value="all" ${this.host.settings.ambientLightMode === 'all' ? 'selected' : ''}>Every pin</option>
                  </select>
                </label>

                <button type="button" id="setup-flip-cam-btn" class="lotus-chip-btn">
                  Flip Camera
                </button>

                <button type="button" id="setup-step-dist-btn" class="lotus-chip-btn ${this.activeWaypointId === 'desk' ? 'is-active' : ''}">
                  Distance: ${this.activeWaypointId === 'desk' ? 'Near (1.2m)' : 'Far (2.7m)'}
                </button>

                <button type="button" id="toggle-room-mesh-btn" class="lotus-chip-btn ${!this.host.settings.showVirtualRoom ? 'is-active' : ''}">
                  ${!this.host.settings.showVirtualRoom ? 'Live Camera Mode (Real World)' : '3D Demo Furniture Shown'}
                </button>
              </div>
            </div>
          </div>

          <div class="lotus-modal-footer">
            <button type="button" id="welcome-done-btn" class="lotus-primary-cta">Done</button>
          </div>
        </section>
      </div>
    `;

    const close = () => {
      this.host.closeModal('welcome');
      this.host.renderAll();
    };
    this.layer
      .querySelector('#welcome-close-btn')
      ?.addEventListener('click', close);
    this.layer
      .querySelector('#welcome-done-btn')
      ?.addEventListener('click', close);

    this.layer
      .querySelectorAll('[data-default-style]')
      .forEach((btn) => {
        btn.addEventListener('click', () => {
          const style = (btn as HTMLElement).dataset
            .defaultStyle as PinShapeStyle;
          this.host.settings.defaultPinStyle = style;
          this.host.callbacks.onApplyStyleToAllPins(style);
          this.host.callbacks.onSettingsChange(this.host.settings);
          this.host.renderAll();
        });
      });

    this.layer
      .querySelectorAll('[data-default-color]')
      .forEach((btn) => {
        btn.addEventListener('click', () => {
          const col =
            (btn as HTMLElement).dataset.defaultColor || '#E84D2B';
          this.host.settings.defaultPinColor = col;
          this.host.callbacks.onSettingsChange(this.host.settings);
          this.host.renderAll();
        });
      });

    const setupColorPicker = this.layer.querySelector(
      '#setup-custom-color',
    ) as HTMLInputElement | null;
    setupColorPicker?.addEventListener('input', () => {
      this.host.settings.defaultPinColor = setupColorPicker.value;
      this.host.callbacks.onSettingsChange(this.host.settings);
    });

    this.layer
      .querySelector('#setup-header-pop-toggle')
      ?.addEventListener('click', () => {
        this.host.settings.headerPopEnabled = !this.host.settings.headerPopEnabled;
        this.host.callbacks.onSettingsChange(this.host.settings);
        this.host.renderAll();
      });

    this.layer.querySelectorAll('[data-timer-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.host.settings.timerMode = (btn as HTMLElement).dataset
          .timerMode as TimerMode;
        this.host.callbacks.onSettingsChange(this.host.settings);
        this.host.renderAll();
      });
    });

    this.layer.querySelectorAll('[data-preset-min]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.host.settings.presetMinutes = Number(
          (btn as HTMLElement).dataset.presetMin,
        );
        this.host.callbacks.onSettingsChange(this.host.settings);
        this.host.renderAll();
      });
    });

    const customMinInput = this.layer.querySelector(
      '#custom-min-input',
    ) as HTMLInputElement | null;
    const customSecInput = this.layer.querySelector(
      '#custom-sec-input',
    ) as HTMLInputElement | null;
    const onCustomTimeChange = () => {
      this.host.settings.customMinutes = Math.max(
        0,
        Math.min(180, Number(customMinInput?.value || 0)),
      );
      this.host.settings.customSeconds = Math.max(
        0,
        Math.min(59, Number(customSecInput?.value || 0)),
      );
      if (
        this.host.settings.customMinutes === 0 &&
        this.host.settings.customSeconds === 0
      ) {
        this.host.settings.customSeconds = 30;
      }
      this.host.callbacks.onSettingsChange(this.host.settings);
      this.host.updateTimerReadouts();
    };
    customMinInput?.addEventListener('change', onCustomTimeChange);
    customSecInput?.addEventListener('change', onCustomTimeChange);

    this.layer.querySelectorAll('[data-shield-style]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.host.settings.shieldStyle = (btn as HTMLElement).dataset
          .shieldStyle as ShieldStyle;
        this.host.callbacks.onSettingsChange(this.host.settings);
        this.host.renderAll();
      });
    });

    const radiusSlider = this.layer.querySelector(
      '#prox-radius-slider',
    ) as HTMLInputElement | null;
    radiusSlider?.addEventListener('input', () => {
      this.host.settings.proximityDistanceMeters = Number(radiusSlider.value);
      this.host.callbacks.onSettingsChange(this.host.settings);
      // Update the readout in place — re-rendering the panel on 'input' would
      // replace the slider DOM mid-drag and kill the drag gesture.
      const readout = this.layer.querySelector('#prox-radius-readout');
      if (readout) {
        readout.textContent = `${this.host.settings.proximityDistanceMeters.toFixed(1)}m`;
      }
    });
    radiusSlider?.addEventListener('change', () => {
      // Full panel refresh only after the drag fully ends.
      this.host.renderAll();
    });

    this.layer
      .querySelector('#ambient-mode-select')
      ?.addEventListener('change', (e) => {
        this.host.settings.ambientLightMode = (e.target as HTMLSelectElement)
          .value as AmbientLightMode;
        this.host.markers.resetAmbientLights();
        this.host.callbacks.onSettingsChange(this.host.settings);
      });
    const ambientSlider = this.layer.querySelector(
      '#ambient-duration-slider',
    ) as HTMLInputElement | null;
    ambientSlider?.addEventListener('input', () => {
      this.host.settings.ambientLightDurationSec = Number(ambientSlider.value);
      this.host.callbacks.onSettingsChange(this.host.settings);
      const r = this.layer.querySelector('#ambient-duration-readout');
      if (r) r.textContent = `${this.host.settings.ambientLightDurationSec}s`;
    });

    this.layer
      .querySelector('#setup-flip-cam-btn')
      ?.addEventListener('click', () => {
        this.host.callbacks.onFlipCamera();
      });

    this.layer
      .querySelector('#setup-step-dist-btn')
      ?.addEventListener('click', () => {
        const nextWp =
          this.activeWaypointId === 'desk'
            ? ROOM_WAYPOINTS.find((w) => w.id === 'doorway')
            : ROOM_WAYPOINTS.find((w) => w.id === 'desk');
        if (nextWp) {
          this.activeWaypointId = nextWp.id;
          this.host.callbacks.onWalkToWaypoint(nextWp);
          this.host.renderAll();
        }
      });

    this.layer
      .querySelector('#toggle-room-mesh-btn')
      ?.addEventListener('click', () => {
        this.host.settings.showVirtualRoom = !this.host.settings.showVirtualRoom;
        this.host.callbacks.onSettingsChange(this.host.settings);
        this.host.renderAll();
      });
  }
}
