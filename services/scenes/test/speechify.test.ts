import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { markWords, runs, speechify, speechifyCheck, speechifyTroubleOf, speechifyVoice, type SpeechifyTts, type SpeechMark } from "../src/speechify.ts";
import { chooseVoice, NO_KEY_NOTE } from "../src/voice-choice.ts";
import { LEAD, TAIL, VoiceDown, voiceFromEnv } from "../src/voice.ts";
import { audioStatus } from "../src/audio.ts";

const dir = mkdtempSync(join(tmpdir(), "opensourcebook-scenes-speechify-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const ordered = (words: { start: number; end: number }[]) => words.every((w, i) => w.end >= w.start && (i === 0 || w.start >= words[i - 1]!.end - 1e-6));

const BEFORE = 0.3;
const AFTER = 0.5;

/**
 * A stand-in for Speechify, for these tests only: a WAV with a tone a quarter second a word and quiet either side, and
 * speech marks in milliseconds nested as Speechify nests them (a sentence's chunks are its words).
 */
function fakeSpeechify(calls: string[] = []): SpeechifyTts {
  return async (_v, req) => {
    calls.push(req.input);
    const words = req.input.split(" ");
    const speech = words.length * 0.25;
    const audio = execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", `sine=frequency=220:duration=${speech}`, "-af", `adelay=${BEFORE * 1000},apad=pad_dur=${AFTER},volume=0.5`, "-ac", "1", "-ar", "48000", "-f", "wav", "pipe:1"], { maxBuffer: 256 * 1024 * 1024 });
    const chunks: SpeechMark[] = words.map((w, i) => ({ value: w, start_time: (BEFORE + i * 0.25) * 1000, end_time: (BEFORE + (i + 1) * 0.25) * 1000 }));
    return { audio, marks: { value: req.input, start_time: 0, end_time: (BEFORE + speech + AFTER) * 1000, chunks: [{ value: req.input, start_time: BEFORE * 1000, end_time: (BEFORE + speech) * 1000, chunks }] } };
  };
}

test("speech marks in milliseconds, however deeply nested, become word times in seconds", () => {
  const words = markWords({ value: "Hello, world.", start_time: 0, end_time: 900, chunks: [{ value: "Hello,", start_time: 125, end_time: 375 }, { value: "world.", start_time: 400, end_time: 800 }] });
  assert.deepEqual(words, [{ text: "Hello,", start: 0.125, end: 0.375 }, { text: "world.", start: 0.4, end: 0.8 }]);
  assert.deepEqual(markWords({}), []);
});

test("a scene longer than one request takes is cut into runs of whole sentences, and no word is lost", () => {
  const text = "One two three. Four five. Six seven eight nine.";
  assert.deepEqual(runs(text, 21), ["One two three.", "Four five.", "Six seven eight nine."]);
  assert.deepEqual(runs(text, 30), ["One two three. Four five.", "Six seven eight nine."]);
  const long = Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ");
  assert.ok(runs(long, 40).every((r) => r.length <= 40));
  assert.equal(runs(long, 40).join(" "), long);
});

test("a scene's speech is cut from its quiet and set between the lead and the tail, and the same words are never paid for twice", async () => {
  const calls: string[] = [];
  const voice = speechifyVoice({ tts: fakeSpeechify(calls), cacheDir: join(dir, "kept") });
  const segs = [{ id: "s1", text: "A lever is a stiff bar. It turns on one point." }, { id: "s2", text: "Push down far from it." }];
  const spoken = await voice.speak(segs, join(dir, "a"));
  assert.equal(calls.length, 2, "one request a scene");
  for (const [i, s] of spoken.entries()) {
    assert.ok(s.audio && existsSync(s.audio));
    assert.equal(s.words.map((w) => w.text).join(" "), segs[i]!.text);
    assert.ok(ordered(s.words));
    assert.ok(Math.abs(s.words[0]!.start - LEAD) < 0.03, `first word at ${s.words[0]!.start}`);
    assert.ok(s.words.at(-1)!.end <= s.seconds - TAIL + 0.03, `${s.id}: last word ends ${s.words.at(-1)!.end}, scene ${s.seconds}`);
  }
  await voice.speak([segs[0]!], join(dir, "b"));
  assert.equal(calls.length, 2);
  assert.equal(readdirSync(join(dir, "kept")).filter((f) => f.endsWith(".wav")).length, 2);
});

test("a long scene is spoken in runs and joined, its words timed in order across the joins", async () => {
  const calls: string[] = [];
  const sentence = Array.from({ length: 30 }, (_, i) => `w${i}`).join(" ") + ".";
  const text = Array.from({ length: 30 }, () => sentence).join(" ");
  const [s] = await speechifyVoice({ tts: fakeSpeechify(calls) }).speak([{ id: "long", text }], join(dir, "long"));
  assert.ok(calls.length >= 2, `${calls.length} requests`);
  assert.ok(calls.every((c) => c.length <= 1800));
  assert.equal(s!.words.length, text.split(" ").length);
  assert.ok(ordered(s!.words));
});

test("the service keeps answering while a long narration is converted", async () => {
  // Two minutes of sound, made before the clock starts, so only the voice's own converting is timed.
  const seconds = 120;
  const audio = execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", `sine=frequency=220:duration=${seconds}`, "-af", "volume=0.5", "-ac", "1", "-ar", "48000", "-f", "wav", "pipe:1"], { maxBuffer: 256 * 1024 * 1024 });
  const words = ["A", "long", "narration."];
  const chunks: SpeechMark[] = words.map((w, i) => ({ value: w, start_time: (i * seconds * 1000) / words.length, end_time: ((i + 1) * seconds * 1000) / words.length }));
  const tts: SpeechifyTts = async () => ({ audio, marks: { value: words.join(" "), start_time: 0, end_time: seconds * 1000, chunks } });
  let ticks = 0;
  const timer = setInterval(() => ticks++, 5);
  try {
    const [s] = await speechifyVoice({ tts }).speak([{ id: "long", text: words.join(" ") }], join(dir, "answering"));
    assert.ok(s!.audio && existsSync(s!.audio));
  } finally {
    clearInterval(timer);
  }
  assert.ok(ticks > 3, `${ticks} ticks while the narration was converted`);
});

test("stopping the job ends the voice's converting", async () => {
  const audio = execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=duration=1", "-ac", "1", "-ar", "48000", "-f", "wav", "pipe:1"]);
  const stop = new AbortController();
  const tts: SpeechifyTts = async () => (stop.abort(), { audio, marks: { value: "Hi.", start_time: 0, end_time: 1000 } });
  await assert.rejects(speechifyVoice({ tts }).speak([{ id: "s1", text: "Hi." }], join(dir, "stopped"), stop.signal), /stopped/);
});

/** Makes every call to Speechify answer as given, counting what reached it; every other address goes through. */
function speechifyAnswers(answer: (url: URL, init?: RequestInit) => Response): { restore: () => void; calls: { url: URL; body?: unknown; auth?: string }[] } {
  const real = globalThis.fetch;
  const calls: { url: URL; body?: unknown; auth?: string }[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.origin !== "https://api.speechify.ai") return real(input, init);
    calls.push({ url, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}), auth: new Headers(init?.headers).get("authorization") ?? "" });
    return answer(url, init);
  }) as typeof fetch;
  return { restore: () => void (globalThis.fetch = real), calls };
}

test("the real call sends the words, voice, model and key as Speechify's API takes them, and reads its audio and marks", async () => {
  const wav = execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=duration=0.5", "-ar", "48000", "-ac", "1", "-f", "wav", "pipe:1"]);
  const net = speechifyAnswers(() => Response.json({ audio_data: wav.toString("base64"), audio_format: "wav", billable_characters_count: 5, speech_marks: { value: "Hi.", start_time: 0, end_time: 500, chunks: [{ value: "Hi.", start_time: 50, end_time: 400 }] } }));
  try {
    const r = await speechify("sk-test")({ id: "geffen_32", model: "simba-3.5" }, { input: "Hi." });
    assert.equal(net.calls[0]!.url.pathname, "/v1/audio/speech");
    assert.equal(net.calls[0]!.auth, "Bearer sk-test");
    assert.deepEqual(net.calls[0]!.body, { input: "Hi.", voice_id: "geffen_32", model: "simba-3.5", output_format: "wav_48000" });
    assert.deepEqual(Buffer.from(r.audio), wav);
    assert.deepEqual(markWords(r.marks), [{ text: "Hi.", start: 0.05, end: 0.4 }]);
  } finally {
    net.restore();
  }
});

test("no characters left or a refused key is VoiceDown at once; the check reads a refused key without speaking", async () => {
  assert.equal(speechifyTroubleOf(402, '{"error":{"code":"payment_required","message":"Insufficient credits"}}'), "credits");
  assert.equal(speechifyTroubleOf(401, '{"error":{"code":"unauthorized"}}'), "refused");
  assert.equal(speechifyTroubleOf(503, ""), "unreachable");
  assert.equal(speechifyTroubleOf(429, '{"error":{"code":"rate_limited"}}'), undefined);

  for (const [status, code, kind, words] of [[402, "payment_required", "credits", /no characters left/], [401, "unauthorized", "refused", /refused the API key \(SPEECHIFY_API_KEY\)/]] as const) {
    const net = speechifyAnswers(() => Response.json({ error: { code, message: "nope" } }, { status }));
    try {
      await assert.rejects(speechifyVoice({ key: "k", retryMs: 1 }).speak([{ id: "s1", text: "Hello there." }], join(dir, `down-${status}`)), (e: unknown) => e instanceof VoiceDown && e.trouble === kind && words.test(e.message));
      assert.equal(net.calls.length, 1, "not tried again");
      assert.deepEqual(await speechifyCheck("k")(), status === 401 ? { ok: false, trouble: "refused", message: "Speechify refused the API key (SPEECHIFY_API_KEY): nope. Fix the key in services/scenes/.env, or remove it to make videos without sound." } : { ok: false, trouble: "credits", message: "The Speechify account has no characters left for this narration: nope. A free account starts again next month." });
      assert.equal(net.calls.at(-1)!.url.pathname, "/v1/voices");
    } finally {
      net.restore();
    }
  }

  const busy = speechifyAnswers(() => Response.json({ error: { code: "rate_limited" } }, { status: 429 }));
  try {
    await assert.rejects(speechifyVoice({ key: "k", retryMs: 1 }).speak([{ id: "s1", text: "Hello there." }], join(dir, "busy")), (e: unknown) => !(e instanceof VoiceDown) && /busy/.test((e as Error).message));
    assert.equal(busy.calls.length, 3, "a busy answer is tried again");
  } finally {
    busy.restore();
  }
});

test("Speechify is the voice with its key alone; an ElevenLabs key still wins, and asking for it without a key says so", () => {
  assert.deepEqual(chooseVoice({ SPEECHIFY_API_KEY: "k" }), { kind: "speechify" });
  assert.equal(chooseVoice({ SPEECHIFY_API_KEY: "k", ELEVENLABS_API_KEY: "e" }).kind, "elevenlabs");
  assert.equal(chooseVoice({ SPEECHIFY_API_KEY: "k", ELEVENLABS_API_KEY: "e", SCENES_VOICE: "speechify" }).kind, "speechify");
  assert.equal(chooseVoice({ SPEECHIFY_API_KEY: "  " }).note, NO_KEY_NOTE);
  assert.match(chooseVoice({ SPEECHIFY_API_KEY: "k", SCENES_VOICE: "silent" }).note ?? "", /SCENES_VOICE=silent/);
  assert.throws(() => chooseVoice({ SCENES_VOICE: "speechify" }), /SCENES_VOICE=speechify needs SPEECHIFY_API_KEY/);
  const voice = voiceFromEnv({ SPEECHIFY_API_KEY: "k", SCENES_SPEECHIFY_VOICE: "henry" });
  assert.equal(voice.id, "speechify");
  assert.equal(voice.sound("flat"), "speechify:henry:simba-3.5");
  assert.equal(voice.note, undefined);
  assert.deepEqual(audioStatus(voice), { ready: true });
});
