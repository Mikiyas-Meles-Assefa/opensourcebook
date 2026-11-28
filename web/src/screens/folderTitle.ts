/** A project's title from its folder: the folder's own name. */
export function folderTitle(path: string): string {
  const name = path.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).pop();
  return (name || path).slice(0, 200);
}
