/**
 * Speechify: a hosted voice with a free monthly allowance, which a person has by giving a key (`SPEECHIFY_API_KEY`).
 * Its text-to-speech call (`POST /v1/audio/speech`) gives back the audio and speech marks, the time of every word in
 * milliseconds, so captions and scene moments land on what is really said, as with ElevenLabs. A scene is one request
 * (a scene longer than one request takes is spoken in runs of whole sentences and joined), cut from the quiet the
 * request leaves at either end and set between LEAD and TAIL like every other voice. Each request is kept on disk by
 * its words and voice, so a rewrite pays only for the scenes whose words changed.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { asSceneWords, placeSpeech } from "./eleven.ts";
import { ffmpeg } from "./ffmpeg.ts";
import { wordsOf } from "./script.ts";
import type { Word } from "./scene.ts";
import { sentences, VoiceDown, type Spoken, type Voice, type VoiceHealth, type VoiceTrouble } from "./voice.ts";
import { fetchPreview, readJsonFrom, setting, type VoiceOption, type VoiceService } from "./voices.ts";

export const SPEECHIFY_API = "https://api.speechify.ai";
/** A built-in English voice, the one Speechify's own examples use. `SCENES_SPEECHIFY_VOICE` names another. */
export const SPEECHIFY_VOICE = "geffen_32";
/** Speechify's newest model, which it recommends. `SCENES_SPEECHIFY_MODEL` names another (`simba-3.0`, `simba-3.2`). */
export const SPEECHIFY_MODEL = "simba-3.5";
/** Most spoken characters Speechify takes in one request is 2,000; this leaves room. */
export const MOST_CHARS = 1800;

const SR = 48000; // asked for as wav_48000
const CONCURRENCY = 3; // the free plan allows three requests at once
const ATTEMPTS = 3;

/** One timed mark: a word, or (with `chunks`) a stretch of them. Times in milliseconds from the start of the audio. */
export interface SpeechMark {
  value?: string;
  start_time?: number;
  end_time?: number;
  chunks?: SpeechMark[];
}

export type SpeechifyRequest = { input: string };
export type SpeechifyResult = { audio: Uint8Array; marks: SpeechMark };
export type SpeechifyTts = (voice: { id: string; model: string }, req: SpeechifyRequest, signal?: AbortSignal) => Promise<SpeechifyResult>;

/** The words in Speechify's speech marks, in seconds: the innermost marks, wherever they are nested. */
export function markWords(marks: SpeechMark | undefined): Word[] {
  if (!marks) return [];
  if (marks.chunks?.length) return marks.chunks.flatMap(markWords);
  const text = marks.value?.trim();
  if (!text || typeof marks.start_time !== "number" || typeof marks.end_time !== "number") return [];
  return [{ text, start: marks.start_time / 1000, end: Math.max(marks.start_time, marks.end_time) / 1000 }];
}

/** A scene's words cut into runs of whole sentences of at most `most` characters each (a sentence longer than that is cut by words). */
export function runs(text: string, most = MOST_CHARS): string[] {
  const out: string[] = [];
  let cur = "";
  const add = (piece: string) => {
    if (cur && cur.length + 1 + piece.length > most) {
      out.push(cur);
      cur = "";
    }
    cur = cur ? `${cur} ${piece}` : piece;
  };
  for (const sentence of sentences(text)) {
    const whole = sentence.join(" ");
    if (whole.length <= most) add(whole);
    else for (const w of sentence) add(w);
  }
  if (cur) out.push(cur);
  return out;
}

/** Speechify's own words in an error answer (`{ error: { code, message } }`), each when it gave it. */
export function speechifySaid(body: string): { code?: string; message?: string } {
  try {
    const e = (JSON.parse(body) as { error?: unknown }).error;
    if (e && typeof e === "object") {
      const r = e as Record<string, unknown>;
      return { ...(typeof r.code === "string" && r.code ? { code: r.code } : {}), ...(typeof r.message === "string" && r.message.trim() ? { message: r.message.trim() } : {}) };
    }
  } catch {
    // Not JSON: nothing of its own fields to read.
  }
  return {};
}

/** Whether an answer means the voice cannot speak until something changes: no credits (402), the key refused (401), or the service failing (5xx). */
export function speechifyTroubleOf(status: number, body: string): VoiceTrouble | undefined {
  const code = speechifySaid(body).code ?? "";
  if (status === 402 || /payment_required|spend_cap/.test(code)) return "credits";
  if (status === 401 || status === 403 || code === "unauthorized") return "refused";
  if (status >= 500) return "unreachable";
  return undefined;
}

/** Plain words for what went wrong with the Speechify account, since the person reads them. */
export function speechifyTrouble(status: number, body: string): string {
  const said = speechifySaid(body);
  const kind = speechifyTroubleOf(status, body);
  const detail = said.message ? `: ${said.message.replace(/\.+$/, "")}` : "";
  if (kind === "credits") return `The Speechify account has no characters left for this narration${detail}. A free account starts again next month.`;
  if (kind === "refused") return `Speechify refused the API key (SPEECHIFY_API_KEY)${detail}. Fix the key in services/scenes/.env, or remove it to make videos without sound.`;
  if (status === 429) return "Speechify is busy (too many requests); try again in a minute.";
  return `Speechify answered ${status}${detail || `: ${body.slice(0, 300)}`}`;
}

type TtsError = Error & { final?: boolean; trouble?: VoiceTrouble };

function within(signal: AbortSignal | undefined, ms: number): AbortSignal {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);
}

/** The real Speechify call: a WAV at 48 kHz and the speech marks of every word. */
export function speechify(key: string, api = SPEECHIFY_API): SpeechifyTts {
  return async (v, req, signal) => {
    let res: Response;
    try {
      res = await fetch(`${api}/v1/audio/speech`, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ input: req.input, voice_id: v.id, model: v.model, output_format: "wav_48000" }),
        signal: within(signal, 3 * 60_000),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw Object.assign(new Error(`Speechify could not be reached (${(error as Error).message}).`), { trouble: "unreachable" as const });
    }
    const body = await res.text();
    if (!res.ok) {
      const e: TtsError = new Error(speechifyTrouble(res.status, body));
      const kind = speechifyTroubleOf(res.status, body);
      // No characters left or a refused key: the same request again meets the same answer.
      e.final = kind === "credits" || kind === "refused" || (res.status >= 400 && res.status < 500 && res.status !== 429);
      if (kind) e.trouble = kind;
      throw e;
    }
    const j = JSON.parse(body) as { audio_data: string; speech_marks?: SpeechMark };
    return { audio: Buffer.from(j.audio_data, "base64"), marks: j.speech_marks ?? {} };
  };
}

/**
 * Whether the key is taken, without speaking: the list of voices is free to read. A refused key and no answer say
 * themselves; whether characters are left cannot be read this way, so the next narration is that check.
 */
export function speechifyCheck(key: string, api = SPEECHIFY_API): (signal?: AbortSignal) => Promise<VoiceHealth> {
  return async (signal) => {
    let res: Response;
    try {
      res = await fetch(`${api}/v1/voices?limit=1`, { headers: { authorization: `Bearer ${key}` }, signal: within(signal, 15_000) });
    } catch (error) {
      return { ok: false, trouble: "unreachable", message: `Speechify could not be reached (${(error as Error).message}).` };
    }
    if (res.ok) return { ok: true };
    const body = await res.text().catch(() => "");
    const kind = speechifyTroubleOf(res.status, body);
    return kind ? { ok: false, trouble: kind, message: speechifyTrouble(res.status, body) } : { ok: true };
  };
}

// ffmpeg runs without the service waiting on it, so the service keeps answering while a long narration is converted.
async function decode(audio: Uint8Array, signal?: AbortSignal): Promise<Float32Array> {
  const raw = (await ffmpeg(["-v", "error", "-i", "pipe:0", "-ac", "1", "-ar", String(SR), "-f", "f32le", "pipe:1"], { input: audio, signal })).stdout;
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4).slice();
}

async function writeWav(pcm: Float32Array, out: string, signal?: AbortSignal) {
  await ffmpeg(["-v", "error", "-y", "-f", "f32le", "-ar", String(SR), "-ac", "1", "-i", "pipe:0", out], { input: new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), signal });
}

export function speechifyVoice(o: { key?: string; tts?: SpeechifyTts; check?: (signal?: AbortSignal) => Promise<VoiceHealth>; retryMs?: number; voiceId?: string; model?: string; cacheDir?: string }): Voice {
  const tts = o.tts ?? speechify(o.key ?? "");
  const check = o.check ?? (o.tts ? undefined : speechifyCheck(o.key ?? ""));
  const v = { id: o.voiceId ?? SPEECHIFY_VOICE, model: o.model ?? SPEECHIFY_MODEL };

  const request = async (input: string, id: string, signal?: AbortSignal): Promise<SpeechifyResult> => {
    // Kept by the words and the voice, so the same words are never paid for twice.
    const cache = o.cacheDir && join(o.cacheDir, `speechify-${createHash("sha256").update(JSON.stringify([v.id, v.model, input])).digest("hex").slice(0, 32)}`);
    if (cache && existsSync(`${cache}.json`) && existsSync(`${cache}.wav`)) return { audio: readFileSync(`${cache}.wav`), marks: JSON.parse(readFileSync(`${cache}.json`, "utf8")).marks };
    for (let attempt = 1; ; attempt++) {
      try {
        const r = await tts(v, { input }, signal);
        if (!markWords(r.marks).length) throw new Error("no timed words came back");
        if (cache) {
          mkdirSync(o.cacheDir!, { recursive: true });
          writeFileSync(`${cache}.wav`, r.audio);
          writeFileSync(`${cache}.json`, JSON.stringify({ marks: r.marks, voice: v, input }));
        }
        return r;
      } catch (e) {
        const err = e as TtsError;
        if (signal?.aborted) throw new Error(`The voice could not speak ${id}: ${err.message}`);
        if (err.trouble && (err.final || attempt >= ATTEMPTS)) throw new VoiceDown(err.message, err.trouble);
        if (err.final || attempt >= ATTEMPTS) throw new Error(`The voice could not speak ${id}: ${err.message}`);
        await new Promise((r) => setTimeout(r, (o.retryMs ?? 2000) * attempt));
      }
    }
  };

  return {
    id: "speechify",
    label: "Speechify",
    real: true,
    // Paid past its free allowance, but kept by its words: a rewrite pays only for the scenes it changed.
    quick: true,
    sound: () => `speechify:${v.id}:${v.model}`,
    ...(check ? { check } : {}),
    async speak(segments, folder, signal) {
      mkdirSync(folder, { recursive: true });
      const out: Spoken[] = new Array(segments.length);
      const one = async (i: number) => {
        const seg = segments[i]!;
        // Each run is spoken on its own and the runs are joined, their word times moved along with them.
        const pieces: Float32Array[] = [];
        const timed: Word[] = [];
        let at = 0;
        for (const input of runs(wordsOf(seg.text).join(" "))) {
          const r = await request(input, seg.id, signal);
          const pcm = await decode(r.audio, signal);
          const shift = at / SR;
          timed.push(...markWords(r.marks).map((w) => ({ text: w.text, start: w.start + shift, end: w.end + shift })));
          pieces.push(pcm);
          at += pcm.length;
        }
        const whole = new Float32Array(at);
        let k = 0;
        for (const p of pieces) (whole.set(p, k), (k += p.length));
        const placed = placeSpeech(whole, timed, SR);
        const wav = join(folder, `${seg.id}.wav`);
        await writeWav(placed.pcm, wav, signal);
        out[i] = { id: seg.id, audio: wav, words: asSceneWords(placed.words, seg.text), seconds: placed.seconds };
      };
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, segments.length) }, async () => {
        while (next < segments.length) await one(next++);
      }));
      return out;
    },
  };
}

/** A voice as Speechify lists it, read as one to pick: its name, its kind of voice, its language. */
export function speechifyOption(v: Record<string, unknown>): VoiceOption | undefined {
  const id = typeof v.id === "string" ? v.id : "";
  if (!id) return undefined;
  const word = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : undefined);
  const tags = Array.isArray(v.tags) ? v.tags.map(word).filter((t): t is string => !!t).map((t) => t.replace(/^[^:]+:/, "").replace(/[-_]/g, " ")) : [];
  const description = tags.slice(0, 3).join(", ") || undefined;
  const language = word(v.locale);
  return { id, label: word(v.display_name) ?? id, ...(description ? { description } : {}), ...(language ? { language } : {}), sample: !!previewOf(v) };
}

/** A Speechify voice's own preview: on the voice, else on its first language that has one. */
function previewOf(v: Record<string, unknown>): string | undefined {
  if (typeof v.preview_audio === "string" && v.preview_audio) return v.preview_audio;
  for (const m of Array.isArray(v.models) ? v.models : []) {
    for (const l of Array.isArray((m as { languages?: unknown }).languages) ? (m as { languages: unknown[] }).languages : []) {
      const p = (l as { preview_audio?: unknown }).preview_audio;
      if (typeof p === "string" && p) return p;
    }
  }
  return undefined;
}

/** Every voice on the key's account, page by page (at most a few pages). */
async function speechifyVoices(key: string | undefined, signal?: AbortSignal, api = SPEECHIFY_API): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const body = (await readJsonFrom(`${api}/v1/voices${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { authorization: `Bearer ${key ?? ""}` }, "Speechify", (status, text) => (speechifyTroubleOf(status, text) ? speechifyTrouble(status, text) : undefined), signal)) as { voices?: unknown; has_more?: unknown; next_cursor?: unknown } | unknown[];
    // An older answer was the list itself.
    const list = Array.isArray(body) ? body : Array.isArray(body.voices) ? body.voices : [];
    out.push(...list.filter((v): v is Record<string, unknown> => typeof v === "object" && v !== null));
    if (Array.isArray(body) || body.has_more !== true || typeof body.next_cursor !== "string") break;
    cursor = body.next_cursor;
  }
  return out;
}

/** Speechify as a voice service: the person's own key, their account's voices, and each voice's own preview. */
export function speechifyService(): VoiceService {
  return {
    id: "speechify",
    label: "Speechify",
    where: "hosted",
    about: "A hosted voice on your own Speechify account, with real word times and a free monthly allowance.",
    key: { name: "SPEECHIFY_API_KEY", label: "Your Speechify key", helpUrl: "https://platform.speechify.ai/api-keys" },
    voiceSetting: "SCENES_SPEECHIFY_VOICE",
    offered: true,
    async listVoices(key, signal) {
      return (await speechifyVoices(key, signal)).map(speechifyOption).filter((o): o is VoiceOption => !!o);
    },
    async sample(voiceId, key, signal) {
      const voice = (await speechifyVoices(key, signal)).find((v) => v.id === voiceId);
      return fetchPreview(voice ? previewOf(voice) : undefined, signal);
    },
    checkKey: (key, signal) => speechifyCheck(key)(signal),
    build: (s, o) => {
      const voiceId = setting(s, "SCENES_SPEECHIFY_VOICE");
      const model = setting(s, "SCENES_SPEECHIFY_MODEL");
      return speechifyVoice({ key: setting(s, "SPEECHIFY_API_KEY") ?? "", ...(o.cacheDir ? { cacheDir: o.cacheDir } : {}), ...(voiceId ? { voiceId } : {}), ...(model ? { model } : {}) });
    },
  };
}
