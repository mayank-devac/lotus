import {lotusSound} from '../sound';
import {SpatialPin} from '../types';
import {PIN_COLOR_OPTIONS} from '../ui/dom';
import {ConfirmGuard} from './ConfirmGuard';
import {ImmersiveHost, PinContent} from './ImmersiveHost';
import {XRCardAction} from './XRInterfaceTypes';
import {XRInterface} from './XRInterface';
import {XRTextEntry} from './XRTextEntry';
import {XRTextRequest} from './XRTextEditor';

/** The pin's text fields; `taskId` is a link, not text a user edits. */
type PinTextField = Extract<keyof PinContent, 'title' | 'body' | 'surfaceLabel'>;
const PIN_TEXT_FIELDS: Record<PinTextField, Omit<XRTextRequest, 'initial'>> = {
  title: {label: 'Pin title', maxLength: 80},
  body: {label: 'Pin note', maxLength: 400},
  surfaceLabel: {label: 'Where is this pin?', maxLength: 40},
};

/** What the buttons of an opened pin's card do in a headset (XRPinCard draws it). */
export class XRPinCardController {
  constructor(
    private readonly host: ImmersiveHost,
    private readonly ui: XRInterface,
    private readonly text: XRTextEntry,
    private readonly confirm: ConfirmGuard,
  ) {}
  public runAction(action: XRCardAction) {
    if (action !== 'delete') this.confirm.clear();
    const pinId = this.ui.getCardPinId();
    if (!pinId) return;
    switch (action) {
      case 'move-card':
        return; // A drag, handled in selectStart.
      case 'close':
        this.close();
        return;
      case 'delete':
        if (!this.confirm.confirm(`pin:${pinId}`)) return;
        this.close();
        this.host.commitPins(this.host.getPins().filter((p) => p.id !== pinId));
        this.ui.flashStatus('Pin deleted');
        return;
      case 'edit':
        this.ui.setCardEditing(true);
        return;
      case 'edit-done':
        // Text still on the keyboard counts, as if Done was pressed there.
        this.text.commit();
        this.ui.setCardEditing(false);
        return;
      case 'field-title':
        this.editText(pinId, 'title');
        return;
      case 'field-body':
        this.editText(pinId, 'body');
        return;
      case 'field-place':
        this.editText(pinId, 'surfaceLabel');
        return;
      case 'toggle-done':
        this.updatePin(pinId, (pin) => ({...pin, completed: !pin.completed}));
        return;
      case 'color':
        this.updatePin(pinId, (pin) => {
          const colors = PIN_COLOR_OPTIONS.map((c) => c.value.toLowerCase());
          const i = colors.indexOf((pin.color || '').toLowerCase());
          return {...pin, color: PIN_COLOR_OPTIONS[(i + 1) % colors.length].value};
        });
        return;
      case 'shape':
        this.updatePin(pinId, (pin) => ({
          ...pin,
          shapeStyle:
            (pin.shapeStyle ?? this.host.ui.getSettings().defaultPinStyle) === 'dot'
              ? 'revolving'
              : 'dot',
        }));
        return;
    }
  }

  /** Applies `change` to one pin, commits, and redraws its card. */
  private updatePin(pinId: string, change: (pin: SpatialPin) => SpatialPin) {
    const pins = this.host.getPins();
    const pin = pins.find((p) => p.id === pinId);
    if (!pin) return;
    const updated = change(pin);
    this.host.commitPins(pins.map((p) => (p === pin ? updated : p)));
    this.host.pinManager.triggerClickEffect(pinId);
    this.ui.refreshCard(updated);
  }

  public open(pinId: string) {
    const pin = this.findPin(pinId);
    if (!pin) return;
    this.text.close();
    this.confirm.clear();
    this.ui.openCard(pin);
    this.host.pinManager.triggerClickEffect(pinId);
    lotusSound.playPinOpen();
  }

  public close() {
    this.text.close();
    this.ui.closeCard();
  }

  public findPin(pinId: string | null): SpatialPin | undefined {
    return pinId ? this.host.getPins().find((p) => p.id === pinId) : undefined;
  }

  /** Opens the keyboard for one of a pin's text fields. */
  public editText(
    pinId: string,
    field: PinTextField,
    request?: XRTextRequest,
  ) {
    const pin = this.findPin(pinId);
    if (!pin) return;
    this.text.request(
      request ?? {...PIN_TEXT_FIELDS[field], initial: pin[field]},
      (text) => {
        // A pin always keeps a title: an emptied one stays as it was.
        if (!text && field === 'title') return;
        this.updatePin(pinId, (p) => (p[field] === text ? p : {...p, [field]: text}));
      },
      () => this.ui.getCardPinId() === pinId && Boolean(this.findPin(pinId)),
    );
  }
}
