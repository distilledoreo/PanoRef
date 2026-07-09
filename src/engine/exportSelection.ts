/**
 * Keep Export multi-select coherent when the project or shot list changes.
 * - New project: select all shots
 * - Same project: drop deleted IDs, auto-select newly added shots, preserve user choices
 */
export function reconcileExportSelectedShotIds(params: {
  projectChanged: boolean;
  previousShotIds: readonly string[];
  nextShotIds: readonly string[];
  currentSelected: ReadonlySet<string>;
}): Set<string> {
  if (params.projectChanged) {
    return new Set(params.nextShotIds);
  }

  const previousIds = new Set(params.previousShotIds);
  const validIds = new Set(params.nextShotIds);
  const next = new Set<string>();

  for (const id of params.currentSelected) {
    if (validIds.has(id)) next.add(id);
  }
  for (const id of params.nextShotIds) {
    if (!previousIds.has(id)) next.add(id);
  }

  return next;
}
