import type { Json, JsonObject } from "../api/types";
import type { Cite } from "./blockData";

/** One scene of a video (engine/docs/video.md, "Scene"). */
export interface Scene {
  id: string;
  kind: string;
  durationMs: number;
  visual: { kind: string; description: string };
  narration: string;
  onScreenText: string[];
  cites: Cite[];
}

/** The file made from the scenes (engine/docs/video.md, "Render"). */
export interface VideoRender {
  by: string;
  storyboard: boolean;
  url: string;
  width?: number;
  height?: number;
  durationMs: number;
  /** Where each scene sits in the file; a voiced render may differ from the planned lengths. */
  scenes: Array<{ id: string; startMs: number; endMs: number }>;
  /** Set when the file has no sound (made without a voice key): why, in the maker's own words, when it said. */
  silent?: { note?: string };
}

export interface Video {
  idea: string;
  scenes: Scene[];
  render?: VideoRender;
}

const arr = (v: Json | undefined): Json[] => (Array.isArray(v) ? v : []);
const isObj = (v: Json | undefined): v is JsonObject => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: Json | undefined): string => (typeof v === "string" ? v : "");
const num = (v: Json | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** A video payload read defensively: a scene without an id is given one; a render without a file is left out. */
export function asVideo(payload: JsonObject): Video {
  const scenes: Scene[] = arr(payload.scenes)
    .filter(isObj)
    .map((s, i) => {
      const visual = isObj(s.visual) ? s.visual : {};
      return {
        id: str(s.id) || `s${i + 1}`,
        kind: str(s.kind),
        durationMs: num(s.durationMs),
        visual: { kind: str(visual.kind), description: str(visual.description) },
        narration: str(s.narration),
        onScreenText: arr(s.onScreenText).filter((t): t is string => typeof t === "string"),
        cites: arr(s.cites).filter(isObj).filter((c) => typeof c.sourceId === "string") as unknown as Cite[],
      };
    });
  const r = isObj(payload.render) ? payload.render : undefined;
  let render: VideoRender | undefined;
  if (r && typeof r.url === "string") {
    const spans = arr(r.scenes).filter(isObj).map((x) => ({ id: str(x.id), startMs: num(x.startMs), endMs: num(x.endMs) }));
    render = {
      by: str(r.by),
      // Only an explicit false is a finished video; anything unclear is shown as a storyboard.
      storyboard: r.storyboard !== false,
      url: r.url,
      ...(typeof r.width === "number" ? { width: r.width } : {}),
      ...(typeof r.height === "number" ? { height: r.height } : {}),
      durationMs: num(r.durationMs),
      scenes: spans.length === scenes.length ? spans : planned(scenes),
      ...(r.storyboard === false && r.audio === false ? { silent: silentNote(r) } : {}),
    };
  }
  return { idea: str(payload.idea), scenes, ...(render ? { render } : {}) };
}

/** Why a finished video has no sound, from its maker's voice, when the maker said. */
function silentNote(render: JsonObject): { note?: string } {
  const maker = isObj(render.maker) ? render.maker : undefined;
  const note = maker && isObj(maker.voice) ? str(maker.voice.note) : "";
  return note ? { note } : {};
}

/**
 * Who made a video, in words, when its maker said (`render.maker`): "Drawn
 * scenes, Chalkboard style, written by claude (sonnet, high effort), voice:
 * Computer voice". Undefined for anything else, a storyboard included.
 */
export function madeByLine(payload: JsonObject): string | undefined {
  const render = isObj(payload.render) ? payload.render : undefined;
  const maker = render && isObj(render.maker) ? render.maker : undefined;
  if (!maker || !str(maker.label)) return undefined;
  const style = isObj(maker.style) ? str(maker.style.label) : "";
  const agent = isObj(maker.agent) ? maker.agent : undefined;
  const writer = agent ? str(agent.label) || str(agent.id) : "";
  const model = agent ? str(agent.model) : "";
  const effort = agent ? str(agent.effort) : "";
  const spec = [model, effort && `${effort} effort`].filter(Boolean).join(", ");
  const voice = isObj(maker.voice) ? str(maker.voice.label) : "";
  return [
    str(maker.label),
    style && `${style} style`,
    writer && `written by ${writer}${spec ? ` (${spec})` : ""}`,
    voice && `voice: ${voice}`,
  ]
    .filter(Boolean)
    .join(", ");
}

/**
 * The scene playing at a moment of the file, by its id: the first whose span
 * ends after it, else the last. Undefined for a video with no file or scenes.
 */
export function sceneAt(video: Video, seconds: number): string | undefined {
  const spans = video.render?.scenes ?? [];
  if (spans.length === 0) return undefined;
  const ms = seconds * 1000;
  return (spans.find((span) => ms < span.endMs) ?? spans.at(-1))?.id || undefined;
}

function planned(scenes: Scene[]): VideoRender["scenes"] {
  let at = 0;
  return scenes.map((s) => {
    const span = { id: s.id, startMs: at, endMs: at + s.durationMs };
    at += s.durationMs;
    return span;
  });
}

/** The name a downloaded video is saved under: its title, kept to what every file system takes. The scenes service always makes an MP4. */
export function videoFileName(title: string): string {
  const base = [...title.normalize("NFKC")]
    .map((c) => (c.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(c) ? " " : c))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 120)
    .trim();
  return `${base || "video"}.mp4`;
}
