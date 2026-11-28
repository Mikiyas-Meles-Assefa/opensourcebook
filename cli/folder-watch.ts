/**
 * Watching the folders projects are linked to, while Open Sourcebook runs, so a file added, changed or removed there
 * shows in its project on its own. The engine cannot see the disk (local-files.ts), so the launcher watches and, a
 * moment after a folder's files change, asks the engine for the same check the web app asks for when a project opens
 * (`POST /v1/projects/:id/folder/check`). Which projects are linked comes from the engine: once when it is up, and
 * again whenever it says they changed (`POST /folder/links` on local-files.ts).
 *
 * On macOS and Windows the system tells of every change in the folder and below it (`fs.watch`, recursive). Elsewhere,
 * or when that cannot start, the folder is listed every few seconds and compared with the last listing. A change to a
 * file the check would leave alone (hidden, in node_modules, too large, or of a kind a folder does not give, such as
 * the finished video copied into it) asks for nothing. Only reads: nothing in a folder is ever written.
 */
import { watch, type FSWatcher } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { leftOut, listFolder } from "./local-files.ts";

/** How long the folder must be still before a check: one copy of many files is one check. */
export const QUIET_MS = 1_500;
/** How often a folder is listed where the system does not tell of changes. */
export const LIST_MS = 5_000;
/** A check reads every new file; a large one can take a while. */
const CHECK_TIMEOUT_MS = 10 * 60_000;

export interface FolderWatchOptions {
  /** The engine's address and the client token it takes. */
  engine: string;
  token: string;
  fetchImpl?: typeof fetch;
  /** For tests: the platform, and the waits. */
  platform?: NodeJS.Platform;
  quietMs?: number;
  listMs?: number;
  /** A line for the log. */
  note?: (line: string) => void;
}

/** What the engine takes from a folder: the file name endings, and how large a file may be. */
interface Takes {
  extensions: Set<string>;
  maxBytes: number;
}

interface Watched {
  folder: string;
  stop: () => void;
  timer?: NodeJS.Timeout;
  checking: boolean;
  again: boolean;
}

/** Whether the system tells of changes in a folder and everything below it here. */
export function tellsOfChanges(platform: NodeJS.Platform): boolean {
  return platform === "darwin" || platform === "win32";
}

/**
 * Whether a change to this path (from the folder, as the system names it) can change what a check finds. A path with
 * no ending may be a folder (one removed takes its files with it), so it counts.
 */
export async function counts(folder: string, path: string | null | undefined, takes: Takes): Promise<boolean> {
  if (!path) return true;
  const parts = path.split(/[\\/]/).filter(Boolean);
  if (parts.some(leftOut)) return false;
  const ending = parts.at(-1)?.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (!ending) return true;
  if (!takes.extensions.has(ending)) return false;
  const info = await stat(join(folder, path)).catch(() => undefined);
  return !(info?.isFile() && info.size > takes.maxBytes);
}

export class FolderWatch {
  private readonly o: FolderWatchOptions;
  private readonly watched = new Map<string, Watched>();
  private takes: Takes | undefined;
  private stopped = false;
  private refreshing: Promise<void> | undefined;
  private refreshAgain = false;

  constructor(options: FolderWatchOptions) {
    this.o = options;
  }

  /** The projects watched now, with their folders. */
  get folders(): Record<string, string> {
    return Object.fromEntries([...this.watched].map(([id, w]) => [id, w.folder]));
  }

  /** Asks the engine which projects are linked and watches their folders; one ask at a time, the last one wins. */
  refresh(): Promise<void> {
    if (this.refreshing) {
      this.refreshAgain = true;
      return this.refreshing;
    }
    this.refreshing = (async () => {
      do {
        this.refreshAgain = false;
        try {
          await this.look();
        } catch (error) {
          this.o.note?.(`Watching linked folders: the engine did not say which projects are linked (${error instanceof Error ? error.message : String(error)}).`);
        }
      } while (this.refreshAgain && !this.stopped);
    })().finally(() => (this.refreshing = undefined));
    return this.refreshing;
  }

  stop(): void {
    this.stopped = true;
    for (const id of [...this.watched.keys()]) this.drop(id);
  }

  private async look(): Promise<void> {
    this.takes ??= await this.askTakes();
    const linked = await this.linked();
    if (this.stopped) return;
    for (const [id, w] of this.watched) if (linked.get(id) !== w.folder) this.drop(id);
    for (const [id, folder] of linked) if (!this.watched.has(id)) this.add(id, folder);
  }

  private async askTakes(): Promise<Takes> {
    const body = (await this.get("/v1/uploads/types")) as { maxBytes?: number; folderExtensions?: string[] };
    return { extensions: new Set(body.folderExtensions ?? []), maxBytes: body.maxBytes ?? Number.POSITIVE_INFINITY };
  }

  /** Every project not archived that is linked to a folder, by id. */
  private async linked(): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    let cursor: string | undefined;
    do {
      const page = (await this.get(`/v1/projects?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`)) as {
        projects: Array<{ id: string; folder?: string; archivedAt?: string }>;
        nextCursor?: string;
      };
      for (const p of page.projects) if (p.folder && !p.archivedAt) out.set(p.id, p.folder);
      cursor = page.nextCursor;
    } while (cursor);
    return out;
  }

  private add(id: string, folder: string): void {
    const w: Watched = { folder, stop: () => undefined, checking: false, again: false };
    this.watched.set(id, w);
    const told = tellsOfChanges(this.o.platform ?? process.platform) ? this.tell(id, w) : undefined;
    w.stop = told ?? this.list(id, w);
  }

  private drop(id: string): void {
    const w = this.watched.get(id);
    if (!w) return;
    this.watched.delete(id);
    clearTimeout(w.timer);
    w.stop();
  }

  /** The system tells of each change; undefined when it cannot watch this folder. */
  private tell(id: string, w: Watched): (() => void) | undefined {
    let watcher: FSWatcher;
    try {
      watcher = watch(w.folder, { recursive: true, persistent: false }, (_event, name) => {
        void counts(w.folder, name, this.takes!).then((yes) => yes && this.soon(id, w));
      });
    } catch {
      return undefined;
    }
    watcher.on("error", () => {
      // The folder went (moved, or its disk taken out): listing it now and then finds it when it is back.
      watcher.close();
      if (this.watched.get(id) === w) w.stop = this.list(id, w);
    });
    return () => watcher.close();
  }

  /** Lists the folder every few seconds and asks for a check when what a check would see differs. */
  private list(id: string, w: Watched): () => void {
    let last: string | undefined;
    let busy = false;
    const look = async () => {
      if (busy) return;
      busy = true;
      try {
        const listing = await listFolder(w.folder).catch(() => undefined);
        const takes = this.takes!;
        const seen = listing
          ? listing.files
              .filter((f) => takes.extensions.has(f.path.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "") && f.size <= takes.maxBytes)
              .map((f) => `${f.path}\u0000${f.size}\u0000${f.modifiedMs}`)
              .join("\n")
          : "";
        if (last !== undefined && seen !== last) this.soon(id, w);
        last = seen;
      } finally {
        busy = false;
      }
    };
    void look();
    const timer = setInterval(() => void look(), this.o.listMs ?? LIST_MS);
    timer.unref();
    return () => clearInterval(timer);
  }

  /** A check once the folder has been still a moment; one at a time, and one more if it changed meanwhile. */
  private soon(id: string, w: Watched): void {
    if (this.watched.get(id) !== w) return;
    clearTimeout(w.timer);
    w.timer = setTimeout(() => void this.check(id, w), this.o.quietMs ?? QUIET_MS);
    w.timer.unref();
  }

  private async check(id: string, w: Watched): Promise<void> {
    if (w.checking) {
      w.again = true;
      return;
    }
    w.checking = true;
    try {
      const response = await (this.o.fetchImpl ?? fetch)(new URL(`/v1/projects/${encodeURIComponent(id)}/folder/check`, this.o.engine), {
        method: "POST",
        headers: { "x-client-token": this.o.token },
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      });
      await response.body?.cancel();
      // Gone, archived or unlinked since: it is not watched any more.
      if (response.status === 404 || response.status === 409) this.drop(id);
    } catch {
      // The engine may be restarting; the next change asks again, and opening the project checks too.
    } finally {
      w.checking = false;
    }
    if (w.again && this.watched.get(id) === w) {
      w.again = false;
      this.soon(id, w);
    }
  }

  private async get(path: string): Promise<unknown> {
    const response = await (this.o.fetchImpl ?? fetch)(new URL(path, this.o.engine), { headers: { "x-client-token": this.o.token }, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`${path} answered ${response.status}`);
    return response.json();
  }
}
