import { errorText, isApiError } from "../api/errors";
import type { SetupRow } from "../api/types";
import { useApi } from "../app/context";
import { useLoad } from "../app/useLoad";
import { OutlineButton } from "../design/Buttons";
import { Icon } from "../design/Icon";

const MARK: Record<string, "check" | "alert" | "clock"> = { ok: "check", missing: "alert", waiting: "clock" };

function Row({ row }: { row: SetupRow }) {
  return (
    <li>
      <div className="fr-row">
        <span className={`fr-mark ${row.state}`}>
          <Icon name={MARK[row.state] ?? "clock"} />
        </span>
        <span className="fr-who">
          <b>{row.label}</b>
          <span>{row.text}</span>
        </span>
        {row.state === "missing" && row.optional && <span className="fr-opt">Optional</span>}
      </div>
      {row.state === "missing" && row.detail && <p className="fr-detail">{row.detail}</p>}
    </li>
  );
}

/**
 * What this computer has and lacks, one row each (Node, ffmpeg, an agent, its sign-in, a voice), asked of the
 * launcher (cli/check.ts) each time, with Check again. Where there is no launcher to ask (the web app run alone,
 * or a launcher from before this check) there is nothing to show, so it shows nothing.
 */
export function SetupCheck() {
  const client = useApi();
  const loaded = useLoad(() => client.setupCheck(), [client]);
  const rows = loaded.data?.rows;
  const none = isApiError(loaded.error, "phone_unavailable") || isApiError(loaded.error, "not_found");
  if (none && !rows) return null;
  return (
    <section className="fr-card fr-check" aria-labelledby="fr-check-h">
      <div className="fr-chead">
        <h2 id="fr-check-h">What this computer needs</h2>
        <OutlineButton onClick={() => void loaded.reload()} disabled={loaded.loading}>
          {loaded.loading ? "Checking…" : "Check again"}
        </OutlineButton>
      </div>
      {!rows && loaded.loading && (
        <p className="fr-line" role="status">
          Checking this computer…
        </p>
      )}
      {!rows && loaded.error !== undefined && (
        <p className="fr-line" role="alert">
          {errorText(loaded.error)}
        </p>
      )}
      {rows && (
        <ul className="fr-list" aria-label="What this computer needs">
          {rows.map((row) => (
            <Row key={row.id} row={row} />
          ))}
        </ul>
      )}
    </section>
  );
}
