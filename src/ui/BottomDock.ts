import {lotusSound} from '../sound';
import {UIHost} from './UIHost';

/**
 * The bottom dock: + ADD PIN, focus area and FOCUS (start timer). In focus
 * area mode it turns into the visibility slider with AGAIN and OKAY. Hidden
 * while the timer runs and while a pin is being placed.
 */
export class BottomDock {
  constructor(
    private readonly host: UIHost,
    private readonly el: HTMLElement,
  ) {}
  public render() {
    // When Focus Timer is running or user is placing a pin in surroundings, hide the bottom dock
    if (this.host.timer.running || (this.host.mode === 'pin-add' && !this.host.isModalOpen('composer'))) {
      this.el.style.display = 'none';
      this.el.innerHTML = '';
      return;
    }

    this.el.style.display = 'flex';
    this.el.className = 'lotus-bottom-dock';

    // When in Focus Area mode: show Visibility slider, Again button, and Okay button
    if (this.host.mode === 'focus-drag') {
      const visibilityVal = Math.round(
        this.host.settings.focusAreaVisibility ?? 25,
      );
      this.el.innerHTML = `
        <div class="lotus-dock-surface lotus-focus-area-controls">
          <label class="lotus-focus-vis-control" for="focus-visibility-slider">
            <span class="lotus-focus-vis-label">VISIBILITY</span>
            <input
              type="range"
              id="focus-visibility-slider"
              class="lotus-focus-vis-slider"
              min="0"
              max="100"
              step="1"
              value="${visibilityVal}"
            />
            <span id="focus-visibility-val" class="lotus-tabular lotus-focus-vis-val">${visibilityVal}%</span>
          </label>

          <button type="button" id="focus-area-again-btn" class="lotus-dock-btn">
            AGAIN
          </button>

          <button type="button" id="focus-area-okay-btn" class="lotus-dock-cta">
            OKAY
          </button>
        </div>
      `;

      const visSlider = this.el.querySelector(
        '#focus-visibility-slider',
      ) as HTMLInputElement | null;
      const visValEl = this.el.querySelector(
        '#focus-visibility-val',
      ) as HTMLElement | null;

      visSlider?.addEventListener('input', () => {
        const nextVal = Number(visSlider.value);
        this.host.settings.focusAreaVisibility = nextVal;
        if (visValEl) {
          visValEl.textContent = `${nextVal}%`;
        }
        // Higher VISIBILITY % -> more visibility of surroundings (lower shield strength)
        const shieldStrength = Math.max(0, Math.min(1, 1 - nextVal / 100));
        this.host.shield.setStrength(shieldStrength);
        this.host.callbacks.onSettingsChange(this.host.settings);
      });

      this.el
        .querySelector('#focus-area-again-btn')
        ?.addEventListener('click', () => {
          lotusSound.playKeyTap();
          this.host.redraggingFocusArea = true;
          this.host.updateDragBox2D(false);
          this.host.shield.hide();
          this.host.renderAll();
        });

      this.el
        .querySelector('#focus-area-okay-btn')
        ?.addEventListener('click', () => {
          lotusSound.playKeyTap();
          this.host.redraggingFocusArea = false;
          this.host.updateDragBox2D(false);
          this.host.mode = 'explore';
          this.host.callbacks.onFocusZoneChange(this.host.focusZone);
          this.host.callbacks.onModeChange('explore');
          this.host.renderAll();
        });

      return;
    }

    const clockStr = this.host.timer.clockText();

    this.el.innerHTML = `
      <div class="lotus-dock-surface">
        <button type="button" id="dock-mode-pin" class="lotus-dock-btn ${this.host.mode === 'pin-add' ? 'is-active' : ''}">
          + ADD PIN
        </button>

        <button type="button" id="dock-mode-drag" class="lotus-dock-btn">
          ⬚ 
        </button>

        <button type="button" id="dock-timer-toggle" class="lotus-dock-cta">
          <span>FOCUS</span>
          <span id="lotus-dock-clock" class="lotus-tabular">${clockStr}</span>
        </button>
      </div>
    `;

    this.el
      .querySelector('#dock-mode-pin')
      ?.addEventListener('click', () => {
        if (this.host.mode === 'pin-add') {
          this.host.mode = 'explore';
          this.host.updatePinPlacementReticle(false);
          this.host.callbacks.onModeChange('explore');
          this.host.renderAll();
        } else {
          this.host.enterPinAddMode();
        }
      });

    this.el
      .querySelector('#dock-mode-drag')
      ?.addEventListener('click', () => {
        this.host.closeModal('tasks');
        this.host.enterFocusAreaMode();
      });

    this.el
      .querySelector('#dock-timer-toggle')
      ?.addEventListener('click', () => {
        if (this.host.mode !== 'explore') {
          this.host.mode = 'explore';
          this.host.callbacks.onModeChange('explore');
        }
        this.host.startFocusTimer();
      });
  }
}
