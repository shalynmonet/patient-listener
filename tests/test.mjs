// Tests for patient-listener.js, run with the Node.js built-in test runner
// (no dependencies to install): `node --test tests/`.
//
// There's no real microphone here. A fake SpeechRecognition stands in for
// the browser's, shaped exactly like the real Web Speech API, so these
// tests drive the actual transcript-accumulation logic directly rather
// than re-implementing it.
import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.window = globalThis;

// A SpeechRecognitionResult is array-like: indexable to alternatives, with
// an .isFinal flag -- this builds one the same shape the real API gives.
function mkResult(transcript, isFinal) {
  const r = [{ transcript }];
  r.isFinal = isFinal;
  return r;
}

class FakeRecognition {
  constructor() {
    this.results = [];
    this.started = false;
    this.onresult = null;
    this.onerror = null;
    this.onend = null;
    FakeRecognition.instances.push(this);
  }
  start() {
    if (this.started) throw new Error("InvalidStateError: recognition already started");
    this.started = true;
    this.results = []; // a new session starts its own fresh results list, like a real browser
  }
  stop() {
    this.started = false;
  }
  // Test helpers standing in for what a real browser fires as speech comes
  // in: updateInterim() refines the one in-progress (non-final) result,
  // finalize() locks the current result in as final -- both the way a
  // browser keeps revising the same trailing result until it's finalized.
  _setTrailing(transcript, isFinal) {
    const idx = this.results.length && !this.results[this.results.length - 1].isFinal
      ? this.results.length - 1
      : this.results.length;
    this.results[idx] = mkResult(transcript, isFinal);
    this.results.length = idx + 1;
    this.onresult?.({ resultIndex: idx, results: this.results });
  }
  updateInterim(transcript) { this._setTrailing(transcript, false); }
  finalize(transcript) { this._setTrailing(transcript, true); }
  triggerEnd() {
    this.started = false;
    this.onend?.();
  }
  triggerError(error) {
    this.onerror?.({ error });
  }
}
FakeRecognition.instances = [];
window.SpeechRecognition = FakeRecognition;

const { startListening, isSupported, DEFAULT_SILENCE_MS } = await import("../patient-listener.js");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const latestRec = () => FakeRecognition.instances.at(-1);

test("isSupported() and DEFAULT_SILENCE_MS", () => {
  assert.equal(isSupported(), true);
  assert.equal(DEFAULT_SILENCE_MS, 3000);
});

test("accumulates across a browser-forced restart mid-utterance", async () => {
  const ctrl = startListening({ silenceMs: 50 });
  const rec = latestRec();
  rec.updateInterim("hello there");
  rec.finalize("hello there, this is a long sentence");
  rec.triggerEnd();
  assert.ok(rec.started, "recognition should auto-restart after the browser ends the session on its own");
  rec.finalize("and it keeps going after the restart");
  await sleep(80); // let the silence timer elapse now that she's stopped talking
  const transcript = await ctrl.promise;
  assert.equal(transcript, "hello there, this is a long sentence and it keeps going after the restart");
});

test("a new word resets the silence timer", async () => {
  const interims = [];
  const ctrl = startListening({ silenceMs: 60, onInterim: (t) => interims.push(t) });
  let resolved = false;
  ctrl.promise.then(() => { resolved = true; });
  const rec = latestRec();
  rec.updateInterim("one");
  await sleep(35);
  assert.equal(resolved, false, "should still be listening before silenceMs has elapsed");
  rec.updateInterim("one two"); // a new word -- resets the 60ms timer
  await sleep(35);
  assert.equal(resolved, false, "a new word should have reset the silence timer, not just continued the old one");
  await sleep(40); // now actually let 60ms pass with nothing new
  await ctrl.promise;
  assert.equal(resolved, true);
  assert.deepEqual(interims, ["one", "one two"]);
});

test("cancel() discards everything and resolves null", async () => {
  const ctrl = startListening({ silenceMs: 5000 });
  const rec = latestRec();
  rec.finalize("something was said");
  ctrl.cancel();
  const result = await ctrl.promise;
  assert.equal(result, null);
  assert.equal(ctrl.cancelled, true);
  assert.equal(rec.started, false, "cancel should stop the recognizer rather than leaving it running");
});

test("stop() finalizes immediately with whatever was captured so far", async () => {
  const ctrl = startListening({ silenceMs: 5000 });
  const rec = latestRec();
  rec.finalize("I went for a walk this morning");
  const raced = await Promise.race([ctrl.promise, sleep(30).then(() => "__still_listening__")]);
  assert.equal(raced, "__still_listening__", "shouldn't have finished yet -- silenceMs is long and stop() hasn't been called");
  ctrl.stop();
  const result = await ctrl.promise;
  assert.equal(result, "I went for a walk this morning");
  assert.equal(ctrl.cancelled, false);
});

test("a real permission problem ends listening right away", async () => {
  const ctrl = startListening({ silenceMs: 5000 });
  const rec = latestRec();
  rec.triggerError("not-allowed");
  const result = await ctrl.promise;
  assert.equal(result, null);
});

test("no SpeechRecognition in this browser resolves null immediately", async () => {
  const saved = window.SpeechRecognition;
  window.SpeechRecognition = undefined;
  const ctrl = startListening();
  const result = await ctrl.promise;
  assert.equal(result, null);
  window.SpeechRecognition = saved;
});

test("iOS: a transcript that's never marked final still resolves", async () => {
  const interims = [];
  const ctrl = startListening({ silenceMs: 50, onInterim: (t) => interims.push(t) });
  const rec = latestRec();
  rec.updateInterim("I went for a walk this morning");
  await sleep(80);
  const result = await ctrl.promise;
  assert.equal(result, "I went for a walk this morning");
  assert.deepEqual(interims, ["I went for a walk this morning"]);
});

test("iOS: cumulative (repeating) interim results don't double up", async () => {
  const ctrl = startListening({ silenceMs: 50 });
  const rec = latestRec();
  rec.updateInterim("I went");
  rec.updateInterim("I went for a walk");
  rec.updateInterim("I went for a walk this morning");
  await sleep(80);
  const result = await ctrl.promise;
  assert.equal(result, "I went for a walk this morning");
});

test("a never-final transcript survives a mid-utterance forced restart too", async () => {
  const ctrl = startListening({ silenceMs: 50 });
  const rec = latestRec();
  rec.updateInterim("hello there");
  rec.triggerEnd();
  assert.ok(rec.started, "recognition should auto-restart after the browser ends the session on its own");
  rec.updateInterim("this is a new session");
  await sleep(80);
  const result = await ctrl.promise;
  assert.equal(result, "this is a new session", "the never-final text from before the restart couldn't survive it (a real browser gives no way to recover it), but nothing from after it should be lost either");
});

test("stop() also falls back to the last interim when nothing was ever finalized", async () => {
  const ctrl = startListening({ silenceMs: 5000 });
  const rec = latestRec();
  rec.updateInterim("stopping before the silence timer");
  ctrl.stop();
  const result = await ctrl.promise;
  assert.equal(result, "stopping before the silence timer");
});

test("nothing displayed at all resolves null", async () => {
  const ctrl = startListening({ silenceMs: 50 });
  await sleep(80);
  const result = await ctrl.promise;
  assert.equal(result, null);
});

test("a custom lang option is passed through to the recognizer", async () => {
  const ctrl = startListening({ silenceMs: 50, lang: "es-ES" });
  const rec = latestRec();
  assert.equal(rec.lang, "es-ES");
  ctrl.cancel();
  await ctrl.promise;
});
