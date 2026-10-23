# patient-listener

A tiny, dependency-free JavaScript library that makes the browser's Web
Speech API wait for people to actually finish talking.

**[Live demo →](https://shalynmonet.github.io/patient-listener/)**

## Why this exists

The browser's built-in speech recognition is tuned for quick commands: say
something, pause, and it stops listening — often right in the middle of a
thought. That's a bad fit for a lot of real speech:

- **Older adults**, who often speak more slowly or pause to find a word
- **Anyone recovering from a stroke**, or living with a condition (Parkinson's,
  a stutter, a breathing condition) that puts gaps between words
- **Non-native speakers**, who may pause mid-sentence to translate in their head
- **Anyone just thinking out loud** — which is most people, most of the time

On top of that, **iPhone Safari's speech recognition in continuous mode
often never marks a result as "final" at all**, even though the live
transcript on screen was completely correct. A naive integration that only
trusts final results silently throws that speech away — the person watches
their own words vanish.

patient-listener fixes both problems. It was extracted from
[Vera](https://github.com/shalynmonet/vera-alexa), a voice companion app
built for an older family member, after exactly this bug showed up during
real iPhone testing.

## What it does

- Keeps listening through natural pauses, and only finishes after a
  configurable silence window (default **3 seconds**) or an explicit "I'm
  done" action you call yourself
- **Auto-restarts** the recognizer when the browser ends a session on its
  own (Chrome does this after a pause, or roughly every minute) — without
  losing the transcript captured so far
- Works on **iPhone Safari**, where results are often never marked final
  and can arrive **cumulatively** (each update repeats everything said so
  far, rather than just the new words) — handled so the transcript never
  doubles up and is never silently lost
- Gives you a **live interim transcript** via a callback, so you can show
  words appearing as they're spoken
- A clean `cancel()` for "never mind", separate from `stop()` for "I'm
  done" — and a plain `null` result plus an `isSupported()` check for
  browsers with no speech recognition at all, so your app can fall back to
  a text box
- Zero dependencies, one file, native ES module

## Install

There's no build step and nothing to install. Either:

**Copy the file.** Grab [`patient-listener.js`](./patient-listener.js) and
drop it into your project.

**Or import it directly from a CDN**, pinned to a tagged release:

```html
<script type="module">
  import { startListening } from "https://cdn.jsdelivr.net/gh/shalynmonet/patient-listener@v1.0.0/patient-listener.js";
</script>
```

## Usage

```js
import { startListening, isSupported } from "./patient-listener.js";

if (!isSupported()) {
  // fall back to a text input -- no SpeechRecognition in this browser
}

const controller = startListening({
  silenceMs: 3000,              // optional, defaults to 3000
  lang: "en-US",                // optional, defaults to "en-US"
  onInterim: (text) => {
    // called every time new speech comes in, final or not --
    // use this to show a live, updating transcript
    transcriptEl.textContent = text;
  },
});

// Later, in response to the user:
controller.stop();    // "I'm done" -- finalize now with whatever was heard
controller.cancel();  // "never mind" -- discard everything

const text = await controller.promise;
// text is a trimmed, non-empty string, or null if nothing was ever
// captured, the browser doesn't support speech recognition, or
// cancel() was called (check controller.cancelled to tell those apart)
```

### API

#### `startListening(options?)`

| Option      | Type                     | Default  | Description                                   |
| ----------- | ------------------------ | -------- | ---------------------------------------------- |
| `onInterim` | `(text: string) => void` | —        | Called with the best transcript so far on every update |
| `silenceMs` | `number`                 | `3000`   | How long to wait with no new speech before finishing |
| `lang`      | `string`                 | `"en-US"`| BCP-47 language tag passed to the recognizer   |

Returns a controller:

| Property    | Type                      | Description                                        |
| ----------- | ------------------------- | ---------------------------------------------------- |
| `promise`   | `Promise<string \| null>` | Resolves with the final transcript, or `null`        |
| `stop()`    | `() => void`               | Finish now, keeping whatever was captured             |
| `cancel()`  | `() => void`               | Discard everything; `promise` resolves to `null`      |
| `cancelled` | `boolean`                  | `true` once `cancel()` has been called                |

#### `isSupported()`

Returns `true` if this browser exposes any form of `SpeechRecognition`.

#### `DEFAULT_SILENCE_MS`

The library's default silence timeout (`3000`), exported so a UI (like the
[demo](./index.html)) can show or default to it without hardcoding the
number twice.

## Browser support

| Browser                | Works? | Notes                                                           |
| ----------------------- | ------ | ---------------------------------------------------------------- |
| Chrome / Edge (desktop) | ✅     | Full support, results reliably marked final                      |
| Chrome (Android)        | ✅     | Full support                                                     |
| Safari (iPhone/iPad)    | ✅     | Supported via the fallback-to-displayed-text path (see above)    |
| Safari (macOS)          | ✅     | Same as iOS Safari                                                |
| Firefox                 | ⚠️     | No `SpeechRecognition` support as of 2026; resolves `null` immediately so your app can fall back to typing |

## Known limitation

If the browser's own session boundary (a forced restart) lands exactly
mid-word, any not-yet-finalized interim text from that instant is lost —
the Web Speech API gives no way to recover an interim result after its
session ends. This is rare in practice, and still strictly better than the
default cut-off-at-first-pause behavior every browser ships with, but it's
not perfect.

## Testing

No dependencies to install — the tests use Node's built-in test runner
with a fake `SpeechRecognition` standing in for the browser's:

```bash
node --test tests/
```

Covered: accumulating a transcript across a browser-forced restart, the
silence timer resetting on each new word, `stop()`/`cancel()` semantics,
the no-support fallback, and the two iOS-specific behaviors (never-final
results, cumulative/repeating results).

## License

MIT — see [LICENSE](./LICENSE).
