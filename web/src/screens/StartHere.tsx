import { useState } from "react";
import { useNavigate } from "react-router";
import type { Glimpse } from "../api/types";
import { useApi, useFormats } from "../app/context";
import { ErrorNotice } from "../app/Status";
import { useLoad } from "../app/useLoad";
import type { FormatLike } from "../design/formatLook";
import { GlimpseFace } from "../design/GlimpseFace";
import { Icon } from "../design/Icon";
import { EXAMPLES, exampleCounts, openExample, type Example, type ExampleBundle } from "./examples";

/** Shared picture area for project and example grid cards: what was made newest, with the Example tag on top when it is one. */
export function ProjectCardFace({
  newest,
  formats,
  example,
}: {
  newest?: { type: string; glimpse?: Glimpse | undefined };
  formats: readonly FormatLike[];
  /** Marks a finished example the person has not opened yet. */
  example?: boolean;
}) {
  return (
    <div className="pface">
      {newest ? (
        <GlimpseFace type={newest.type} glimpse={newest.glimpse} formats={formats} />
      ) : (
        <span className="face empty-face" aria-hidden="true">
          <Icon name="doc" />
        </span>
      )}
      {example && (
        <span className="ptags">
          <span className="ptag">Example</span>
        </span>
      )}
    </div>
  );
}

/**
 * Fixed footer shared by every card in the projects grid: its sources and things made in total. A project opened from
 * a folder shows that folder and that it is kept in step with it, in place of the count of its sources.
 */
export function ProjectCardFooter({ sources, made, folder }: { sources: number; made: number; folder?: string }) {
  return (
    <div className="pfoot">
      {folder ? (
        <span className="pstat pfolder" title={folder}>
          <Icon name="folder" />
          <span className="ppath">{folder}</span>
          <span className="psynced">Synced</span>
        </span>
      ) : (
        <span className="pstat" title={`${sources} ${sources === 1 ? "source" : "sources"}`}>
          <Icon name="page" />
          {sources}
          <span className="sr-only"> {sources === 1 ? "source" : "sources"}</span>
        </span>
      )}
      <span className="pstat" title={`${made} ${made === 1 ? "item made" : "items made"}`}>
        <Icon name="layers" />
        {made}
        <span className="sr-only"> {made === 1 ? "item made" : "items made"}</span>
      </span>
    </div>
  );
}

/** The first finished example in `examples/`, shown as a grid card when there are no projects yet. */
export function ExampleCard({ bundle, filter = "" }: { bundle?: ExampleBundle; filter?: string }) {
  const example = EXAMPLES[0];
  return example ? <ExampleOf example={example} preloaded={bundle} filter={filter} /> : null;
}

function ExampleOf({ example, preloaded, filter }: { example: Example; preloaded?: ExampleBundle; filter: string }) {
  const client = useApi();
  const formats = useFormats();
  const navigate = useNavigate();
  const loaded = useLoad(() => (preloaded ? Promise.resolve(preloaded) : example.load()), [example, preloaded]);
  const data = preloaded ?? loaded.data;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  if (!data) return null;
  if (filter && !data.project.title.toLowerCase().includes(filter.toLowerCase())) return null;
  const counts = exampleCounts(data);
  const first = counts.made[0];
  async function open() {
    setBusy(true);
    setError(undefined);
    try {
      const project = await openExample(client, example);
      navigate(`/projects/${project.id}`);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }
  return (
    <div className="pcw">
      <div className="card pc pc-example">
        <ProjectCardFace formats={formats} example {...(first ? { newest: { type: first.type, glimpse: { text: first.title } } } : {})} />
        <div className="pbody">
          <h3 title={data.project.title}>
            <button type="button" className="pc-open" disabled={busy} onClick={() => void open()}>
              {data.project.title}
            </button>
          </h3>
          <ProjectCardFooter sources={counts.sources} made={counts.made.length} />
        </div>
      </div>
      <ErrorNotice error={error} />
    </div>
  );
}
