On a Meta Quest, nobody can use the 2D screen UI during XR: the headset doesn't show the web page while the user is in XR. I found one real problem, that pin text couldn't be typed in the headset, and fixed it. The typecheck and build pass, but none of this has been tested on a real Quest.

## Can the controller click the 2D buttons?

No. Quest's browser doesn't draw web page content inside an immersive XR session. WebXR's "DOM Overlay" feature, which puts the page in front of the user, only works on Android phones. So the 2D buttons are invisible, and a controller ray can't reach them.

Instead, the app draws its own panels in 3D space ([XRInterface.ts](src/XRInterface.ts)): a control panel, a pin card, pin labels and aiming rays. The user points the controller, or a hand, and pulls the trigger or pinches to press a button. [ImmersiveSession.ts](src/ImmersiveSession.ts) handles that. In a desktop XR emulator the 2D page is still shown on top, so the mouse works there; the headset itself never shows it.

## How does the user fill in the text boxes?

That was the bug. In the headset, text could only be entered by voice. Quest Browser doesn't support the browser's speech-to-text feature, so on a real Quest a pin could never get a title or note. It stayed "Pin 3" until the user left XR.

**Fix:** a new file, [xrTextInput.ts](src/xrTextInput.ts), uses Quest's own keyboard. Meta documents this for WebXR in Quest Browser 26.1 and later. The app picks one of three methods when the session starts:

| What the headset supports | Pin card buttons | What happens |
|---|---|---|
| Quest keyboard | **Type title / Type note** | Quest's keyboard opens. The card shows the text as it's typed, and it's saved when the user presses Done. |
| Speech only (other headsets) | **Say title / Say note** | Voice input, as before. |
| Neither | Close / Delete | The card says "Edit the text on the 2D screen after exiting XR." |

**Opening the keyboard.** Quest only opens the keyboard from a real user action. The XR library reports pinches from its own update loop, which doesn't count as one. So the keyboard opens when the user releases the pinch, from the browser's own pinch event. If that event is missed, it tries once more as the pinch ends. If it still fails, the card says "The keyboard did not open. Try again."

**Keyboard behaviour to expect:**
- The first key press replaces the whole old text; that's how Quest's keyboard works.
- Clearing the title and pressing Done keeps the old title.
- The hidden text box is removed when the session ends.

## Still 2D-only (resolved)
These now work in the headset:
- **Tasks**: the list button on the control panel opens a Tasks drawer; pinch a task to mark it done or not done. Creating a task still happens on the 2D screen.
- **Pin list**: the pins drawer lists every pin, nearest first, with its distance. Pinch one to open its card.
- **Settings**: focus length (5-minute steps), sound, when pin titles show, and how much the room dims while focusing.
- **Pin colour and style**: the pin card has a colour button (cycles the same palette as the 2D screen) and a shape button (shape or dot).

Sources:
- [System Keyboard in WebXR (Meta)](https://developers.meta.com/horizon/documentation/web/webxr-keyboard/)
- [SpeechRecognition in WebXR (Meta forum)](https://communityforums.atmeta.com/discussions/dev-quest/speechrecognition-in-webxr/1168273)
- [Voice recognition with Web Speech API (Babylon.js forum)](https://forum.babylonjs.com/t/voice-recognition-with-web-speech-api/41911)