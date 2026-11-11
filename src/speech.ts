/**
 * One-shot voice dictation through the Web Speech API, shared by the DOM UI
 * and the in-headset interface. Degrades to "unsupported" where the browser
 * has no speech recognition.
 */

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult:
    | ((event: {results: ArrayLike<ArrayLike<{transcript: string}>>}) => void)
    | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function isSpeechSupported(): boolean {
  return getSpeechRecognitionCtor() !== null;
}

/**
 * Listens for one utterance. `onText` receives the trimmed transcript (never
 * empty); `onEnd` runs once when listening stops, with `failed` set if the
 * recognizer reported an error. Returns a stop function, or null when speech
 * recognition is unavailable or could not start.
 */
export function dictateOnce(
  onText: (text: string) => void,
  onEnd: (failed: boolean) => void,
): (() => void) | null {
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) return null;
  try {
    const recognizer = new Ctor();
    let failed = false;
    recognizer.lang = navigator.language || 'en-US';
    recognizer.interimResults = false;
    recognizer.maxAlternatives = 1;
    recognizer.onresult = (event) => {
      const text = event.results[0]?.[0]?.transcript?.trim();
      if (text) onText(text);
    };
    recognizer.onerror = () => {
      failed = true;
    };
    recognizer.onend = () => onEnd(failed);
    recognizer.start();
    return () => {
      try {
        recognizer.stop();
      } catch {
        // Already stopped
      }
    };
  } catch {
    return null;
  }
}
