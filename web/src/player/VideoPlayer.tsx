import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Icon } from "../design/Icon";
import { ChromeTools, ProgressLine } from "./chrome";
import { mediaUrl } from "./media";
import type { PlayerProps } from "./players";
import { isNumber, progressField } from "./progress";
import { useChrome } from "./useChrome";
import { asVideo, sceneAt, videoFileName } from "./videoData";

/**
 * A video (engine/docs/video.md, "Players"; docs/DECISIONS.md #49): the
 * video and nothing else. One screen in the file's own shape (a 9:16 reel
 * by default), centred, with the browser's own controls; no scene list,
 * panel, cards or marks around or over it. A storyboard made before that
 * maker was taken out (DECISIONS #69) still plays, and says so inside its
 * own frames. Nothing sideways (#36): the chrome around it goes to the
 * thing before and after; playing to the end ticks the item done.
 *
 * The browser's own controls are not used: their bar covers the bottom of
 * the frame, where a video's captions are. A tap (or Space) plays and
 * pauses, a play mark shows while paused, and the chrome's thin line along
 * the bottom shows and moves the time (its own line, outside a chrome). The
 * video is drawn under the chrome's bar, in the window's full height. A
 * screen scrolled out of view pauses.
 */
export function VideoPlayer({ output, complete, active = true, autoplay = false, progress, keep, here }: PlayerProps) {
  const read = useMemo(() => asVideo(output.payload), [output.payload]);
  const render = read.render;
  const src = render ? mediaUrl(render.url) : undefined;
  const shape = render?.width && render.height ? `${render.width} / ${render.height}` : "9 / 16";
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState({ at: 0, length: 0 });
  const [muted, setMuted] = useState(false);
  const [why, setWhy] = useState(false);
  // Where the person stopped (and the scene there), kept when they pause, scroll away, every so often while it plays, and at the end.
  const keptAt = useRef(progressField(progress, "time", isNumber) ?? 0);
  const keepTime = useCallback(
    (at: number) => {
      const t = Math.round(at * 10) / 10;
      if (Math.abs(t - keptAt.current) < 0.5) return;
      keptAt.current = t;
      const scene = sceneAt(read, t);
      keep?.({ time: t, ...(scene ? { scene } : {}) });
    },
    [keep, read],
  );

  // Where the person is right now, finer than what is kept, so a thread is written at the moment they see, with the scene playing then.
  const told = useRef(-1);
  const tell = useCallback(
    (at: number) => {
      const t = Math.round(at * 10) / 10;
      if (Math.abs(t - told.current) < 0.25) return;
      told.current = t;
      const scene = sceneAt(read, t);
      here?.({ time: t, ...(scene ? { scene } : {}) });
    },
    [here, read],
  );

  function toggle() {
    const v = video.current;
    if (!v) return;
    // Playing on its own in a feed it is muted, as browsers require; the first tap turns the sound on.
    if (v.muted && !v.paused) {
      v.muted = false;
      setMuted(false);
      return;
    }
    if (v.paused) void Promise.resolve(v.play()).catch(() => undefined);
    else v.pause();
  }
  const seekTo = useCallback((fraction: number) => {
    const v = video.current;
    if (v && Number.isFinite(v.duration) && v.duration > 0) v.currentTime = fraction * v.duration;
  }, []);
  const at = time.length ? time.at / time.length : 0;
  const inChrome = useChrome({ behind: "dark", ...(src ? { progress: at, onSeek: seekTo } : {}) });

  // A screen scrolled away stops, so two never play at once; in a feed the one scrolled into view plays.
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (!active) {
      v.pause();
      return;
    }
    if (autoplay && v.paused) {
      v.muted = true;
      setMuted(true);
      void Promise.resolve(v.play()).catch(() => undefined);
    }
  }, [active, autoplay]);

  useEffect(() => {
    if (!active) return;
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select, button")) return;
      if (e.key !== " " || !src) return;
      toggle();
      e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, src]);

  return (
    <div className="vstage">
      {/* Saving the file is a tool in the chrome's bar, never something drawn over the video. */}
      {src && (
        <ChromeTools>
          <a className="pc-ib" href={src} download={videoFileName(output.title)} aria-label="Download the video" title="Download the video">
            <Icon name="download" />
          </a>
        </ChromeTools>
      )}
      <div className="vscreen" style={{ "--shape": shape } as CSSProperties}>
        {src ? (
          <>
            <video
              ref={video}
              src={src}
              playsInline
              preload="metadata"
              aria-label={output.title}
              onClick={toggle}
              onPlay={() => setPlaying(true)}
              onPause={(e) => {
                setPlaying(false);
                if (!e.currentTarget.ended) keepTime(e.currentTarget.currentTime);
              }}
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                // Carry on from where the person stopped, unless that was the very end.
                if (keptAt.current > 0 && v.duration && keptAt.current < v.duration - 1) v.currentTime = keptAt.current;
                setTime({ at: v.currentTime, length: v.duration || 0 });
                tell(v.currentTime);
              }}
              onTimeUpdate={(e) => {
                const v = e.currentTarget;
                setTime({ at: v.currentTime, length: v.duration || 0 });
                tell(v.currentTime);
                if (!v.paused && Math.abs(v.currentTime - keptAt.current) >= 10) keepTime(v.currentTime);
              }}
              onEnded={() => {
                setPlaying(false);
                keepTime(0);
                complete?.();
              }}
            />
            {/* Only on the video in view: a neighbour in the feed or the Studio (a set of cards above it) never wears its label. */}
            {render?.silent && active && (
              <div className="vquiet">
                <button type="button" aria-expanded={why} onClick={() => setWhy(!why)}>
                  <Icon name="sound" />
                  No sound
                </button>
                {why && <p role="note">{render.silent.note ?? "This video was made without a voice; its captions carry the words."}</p>}
              </div>
            )}
            {!render?.silent && playing && muted && (
              <button className="vsound" type="button" aria-label="Turn the sound on" title="Turn the sound on" onClick={toggle}>
                <Icon name="mute" />
              </button>
            )}
            {!playing && (
              <button className="vplay" type="button" aria-label="Play" onClick={toggle}>
                <Icon name="play" />
              </button>
            )}
            {!inChrome && <ProgressLine progress={at} onSeek={seekTo} />}
          </>
        ) : (
          <p className="vnone">This video has no file yet.</p>
        )}
      </div>
    </div>
  );
}
