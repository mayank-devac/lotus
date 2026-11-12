import {lotusSound} from '../sound';
import {PinSortBy, SpatialPin} from '../types';
import {escapeHtml, formatCreatedAgo} from './dom';
import {UIHost} from './UIHost';

/** The PINS list: every saved pin by distance or date, ongoing and completed. */
export class PinDirectoryModal {
  private pinSortBy: PinSortBy = 'proximity';

  constructor(
    private readonly host: UIHost,
    private readonly layer: HTMLElement,
  ) {}
  public render() {
    this.layer.style.pointerEvents = 'auto';

    const sortedPins = [...this.host.pins].sort((a, b) => {
      if (this.pinSortBy === 'proximity') {
        return this.host.markers.distanceMeters(a) - this.host.markers.distanceMeters(b);
      }
      return (b.createdAt || 0) - (a.createdAt || 0);
    });

    const ongoingPins = sortedPins.filter((p) => !p.completed);
    const completedPins = sortedPins.filter((p) => p.completed);

    const renderPinItem = (pin: SpatialPin) => {
      const distMeters = this.host.markers.distanceMeters(pin);
      const createdLabel = formatCreatedAgo(pin.createdAt);
      const isDone = Boolean(pin.completed);
      return `
        <div class="lotus-dir-item ${isDone ? 'is-completed' : ''}">
          <button
            type="button"
            data-tick-pin="${pin.id}"
            class="lotus-task-tick-btn ${isDone ? 'is-checked' : ''}"
            aria-label="${isDone ? 'Mark pin as ongoing' : 'Mark pin as completed'}"
            title="${isDone ? 'Completed — click to mark ongoing' : 'Tick to mark completed'}"
          >
            <span class="lotus-task-tick-icon">✓</span>
          </button>
          <div class="lotus-dir-item-main" data-open-pin="${pin.id}">
            <div class="lotus-dir-item-meta">
              <span class="lotus-pin-color-dot" style="background: ${pin.color};"></span>
              <span>${escapeHtml(pin.surfaceLabel)}</span>
              <span>·</span>
              <span class="lotus-tabular" style="color: var(--accent);">${distMeters.toFixed(1)}m</span>
              <span>·</span>
              <span>${escapeHtml(createdLabel)}</span>
              <span>·</span>
              <span>${(pin.shapeStyle ?? this.host.settings.defaultPinStyle) === 'dot' ? '● Dot' : '◆ Revolving Shape'}</span>
            </div>
            <div class="lotus-dir-item-title ${isDone ? 'is-line-through' : ''}">${escapeHtml(pin.title)}</div>
            <div class="lotus-dir-item-preview">${escapeHtml(pin.body)}</div>
          </div>
          <div class="lotus-dir-item-actions">
            <button type="button" data-open-pin="${pin.id}" class="lotus-chip-btn is-active">Open</button>
          </div>
        </div>
      `;
    };

    this.layer.innerHTML = `
      <div class="lotus-modal-backdrop">
        <section class="lotus-modal-card lotus-directory-modal" role="dialog" aria-labelledby="dir-title">
          <div class="lotus-modal-header">
            <div>
              <h2 id="dir-title" class="lotus-modal-title">Saved Memory Points (${this.host.pins.length})</h2>
              <p class="lotus-modal-subtitle">Order spatial pins by proximity or date, and tick off completed reminders.</p>
            </div>
            <button type="button" id="dir-close-btn" class="lotus-icon-close-btn" aria-label="Close">✕</button>
          </div>

          <div class="lotus-modal-body" data-modal-id="directory">
            <div class="lotus-dir-sort-bar" role="group" aria-label="Sort saved pins">
              <span class="lotus-dir-sort-label">Sort by:</span>
              <div class="lotus-dir-sort-options">
                <button
                  type="button"
                  data-sort-pins="proximity"
                  class="lotus-chip-btn ${this.pinSortBy === 'proximity' ? 'is-active' : ''}"
                >
                  ◎ Proximity
                </button>
                <button
                  type="button"
                  data-sort-pins="date"
                  class="lotus-chip-btn ${this.pinSortBy === 'date' ? 'is-active' : ''}"
                >
                  ◷ Creation Date
                </button>
              </div>
            </div>

            ${
              sortedPins.length === 0
                ? `<div class="lotus-empty-state">No points yet. Tap "+ ADD PIN" and tap anywhere on your camera feed.</div>`
                : `
              <div class="lotus-task-section">
                <div class="lotus-task-section-header">
                  <span class="lotus-task-section-title">ONGOING PINS</span>
                  <span class="lotus-task-count-pill">${ongoingPins.length} ONGOING</span>
                </div>
                ${
                  ongoingPins.length === 0
                    ? `<div class="lotus-empty-state">All spatial pins are marked completed!</div>`
                    : `<div class="lotus-pin-directory-list">${ongoingPins.map(renderPinItem).join('')}</div>`
                }
              </div>

              ${
                completedPins.length > 0
                  ? `
                <div class="lotus-task-section is-completed-section">
                  <div class="lotus-task-section-header">
                    <span class="lotus-task-section-title">COMPLETED PINS</span>
                    <span class="lotus-task-count-pill is-done">${completedPins.length} COMPLETED</span>
                  </div>
                  <div class="lotus-pin-directory-list">${completedPins.map(renderPinItem).join('')}</div>
                </div>
              `
                  : ''
              }
            `
            }
          </div>

          <div class="lotus-modal-footer">
            ${
              this.host.pins.length > 0
                ? `<button type="button" id="dir-clear-all-btn" class="lotus-danger-btn">Clear All</button>`
                : ''
            }
            <div style="flex: 1;"></div>
            <button type="button" id="dir-add-pin-btn" class="lotus-primary-cta">+ Add New Point</button>
          </div>
        </section>
      </div>
    `;

    this.layer
      .querySelector('#dir-close-btn')
      ?.addEventListener('click', () => {
        this.host.closeModal('directory');
        this.host.renderAll();
      });

    this.layer.querySelectorAll('[data-sort-pins]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sortMode = (btn as HTMLElement).dataset.sortPins as PinSortBy;
        if (sortMode && this.pinSortBy !== sortMode) {
          this.pinSortBy = sortMode;
          lotusSound.playKeyTap();
          this.render();
        }
      });
    });

    this.layer.querySelectorAll('[data-tick-pin]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const pinId = (btn as HTMLElement).dataset.tickPin;
        const found = this.host.pins.find((p) => p.id === pinId);
        if (!found) return;
        const updated: SpatialPin = {
          ...found,
          completed: !found.completed,
        };
        lotusSound.playTaskTick(Boolean(updated.completed));
        this.host.callbacks.onSavePin(updated);
        this.host.refreshPinMarkers();
        this.render();
      });
    });

    this.layer
      .querySelector('#dir-clear-all-btn')
      ?.addEventListener('click', () => {
        this.host.callbacks.onClearAllPins();
        this.host.refreshPinMarkers();
        this.host.renderAll();
      });

    this.layer
      .querySelector('#dir-add-pin-btn')
      ?.addEventListener('click', () => {
        this.host.enterPinAddMode();
      });

    this.layer.querySelectorAll('[data-open-pin]').forEach((el) => {
      el.addEventListener('click', () => {
        const id = (el as HTMLElement).dataset.openPin;
        if (id) {
          this.host.closeModal('directory');
          this.host.inspectPin(id);
        }
      });
    });
  }
}
