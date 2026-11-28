import { useState } from "react";
import { useNavigate } from "react-router";
import type { Project } from "../api/types";
import { useApi } from "../app/context";
import { folderDialog } from "../app/folderDialog";
import { FolderField } from "../app/FolderField";
import { ErrorNotice } from "../app/Status";
import { Icon } from "../design/Icon";
import { folderTitle } from "./folderTitle";

const same = (a: string, b: string) => a.replace(/[\\/]+$/, "") === b.replace(/[\\/]+$/, "");

/**
 * "Open a folder" on Home: a folder on this computer becomes a project linked to it, named from the folder, its files
 * the project's sources, kept in step while Open Sourcebook runs. The desktop app shows the system's folder dialog; a
 * browser takes the folder's whole path. A folder a project is linked to already opens that project.
 */
export function OpenFolderTile({ projects }: { projects: readonly Project[] }) {
  const client = useApi();
  const navigate = useNavigate();
  const [typing, setTyping] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();

  async function open(path: string) {
    const here = projects.find((p) => p.folder && same(p.folder, path));
    if (here) return navigate(`/projects/${here.id}`);
    setBusy(true);
    setError(undefined);
    try {
      const project = await client.createProject({ title: folderTitle(path) });
      try {
        await client.linkFolder(project.id, path);
      } catch (e) {
        // A folder that cannot be linked leaves no empty project behind.
        await client.deleteProject(project.id).catch(() => undefined);
        throw e;
      }
      navigate(`/projects/${project.id}`);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  function start() {
    const dialog = folderDialog();
    if (!dialog) return setTyping(true);
    void dialog().then((picked) => picked && void open(picked));
  }

  if (typing)
    return (
      <div className="card pc pc-folder">
        <span className="pc-folder-head">
          <Icon name="folder" />
          Open a folder
        </span>
        <FolderField label="Folder to open" action="Open" busy={busy} onPick={(path) => void open(path)} onCancel={() => (setTyping(false), setError(undefined))} />
        <ErrorNotice error={error} />
      </div>
    );
  return (
    <div className="pc-new-wrap">
      <button type="button" className="pc-new main" disabled={busy} onClick={start}>
        <Icon name="folder" />
        <span>{busy ? "Opening…" : "Open a folder"}</span>
      </button>
      <ErrorNotice error={error} />
    </div>
  );
}
