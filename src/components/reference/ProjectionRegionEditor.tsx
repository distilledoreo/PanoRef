import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Plus,
  RotateCw,
  Scale,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import type {
  LocationProject,
  PanoReference,
  PanoViewState,
  ProjectionRegionAlignment,
  Vec2,
} from "../../domain/types";
import {
  findProjectionRegionAlignmentForPano,
  normalizeProjectedStyleSettings,
} from "../../domain/defaults";
import { diagnoseProjectionRegionPolygon } from "../../engine/projectionRegionPolygon";
import { projectionRegionDiagnosticsForAlignment } from "../../engine/projectionRegionDiagnostics";
import { degreesToRadians } from "../../engine/sync";
import { PanoViewer, type PanoViewerRegion } from "../viewers/PanoViewer";
import { SceneViewport } from "../viewers/SceneViewport";
import {
  cancelPendingRegion,
  commitRegionGesture,
  commitPendingRegion,
  completeTargetPolygon,
  createProjectionRegionDraft,
  draftToProjectionRegionAlignment,
  insertRegionVertexPair,
  isProjectionRegionDraftDirty,
  moveRegionDown,
  moveRegionUp,
  moveSourceVertexTransient,
  removeRegion,
  removeRegionVertexPair,
  renameRegion,
  resetSourceRegion,
  rotateSourceRegion,
  scaleSourceRegion,
  setRegionEdgeSoftness,
  setRegionStrength,
  moveTargetVertexTransient,
  replaceTargetPolygon,
  toggleRegion,
  translateSourceRegionTransient,
  translateSourceRegion,
  undoRegionAction,
  type ProjectionRegionDraft,
} from "./projectionRegionEditorState";
import { createProjectionRegionPreviewProject } from "./projectionRegionPreviewProject";
import { ProjectionRegionResultPreview } from "./ProjectionRegionResultPreview";

const DEFAULT_VIEW: PanoViewState = {
  yawDegrees: 0,
  pitchDegrees: 0,
  fovDegrees: 65,
};
const imageUrl = (project: LocationProject, pano?: PanoReference) =>
  pano ? project.assets.assets[pano.imageAssetId]?.uri : undefined;
const viewerRegions = (
  draft: ProjectionRegionDraft,
  side: "target" | "source",
  numbered = true,
): PanoViewerRegion[] =>
  [...draft.regions, ...(draft.pendingRegion ? [draft.pendingRegion] : [])].map(
    (region) => ({
      id: region.id,
      label: region.name,
      state: !region.enabled
        ? "disabled"
        : diagnoseProjectionRegionPolygon(region).valid
          ? region.id === draft.activeRegionId
            ? "active"
            : "complete"
          : "invalid",
      vertices: region.vertices.map((vertex, index) => ({
        id: vertex.id,
        uv: side === "target" ? vertex.targetUv : vertex.sourceUv,
        label: numbered ? String(index + 1) : undefined,
      })),
    }),
  );

export function ProjectionRegionEditor({
  open,
  project,
  initialSourcePanoId,
  onApply,
  onClose,
}: {
  open: boolean;
  project: LocationProject;
  initialSourcePanoId: string;
  onApply: (
    sourcePanoId: string,
    alignment: ProjectionRegionAlignment | undefined,
  ) => void;
  onClose: () => void;
}) {
  const targets = project.panoRefs.filter(
    (pano) => pano.type === "graybox_render" && imageUrl(project, pano),
  );
  const sources = project.panoRefs.filter(
    (pano) => pano.type !== "graybox_render" && imageUrl(project, pano),
  );
  const [sourceId, setSourceId] = useState(initialSourcePanoId);
  const source = project.panoRefs.find((pano) => pano.id === sourceId);
  const saved = findProjectionRegionAlignmentForPano(
    normalizeProjectedStyleSettings(project.settings.projectedStyle),
    sourceId,
  );
  const [draft, setDraft] = useState(() =>
    createProjectionRegionDraft(
      initialSourcePanoId,
      targets[0]?.id,
      findProjectionRegionAlignmentForPano(
        normalizeProjectedStyleSettings(project.settings.projectedStyle),
        initialSourcePanoId,
      ),
    ),
  );
  const [view, setView] = useState(DEFAULT_VIEW);
  const [mobilePane, setMobilePane] = useState<"graybox" | "styled" | "review">(
    "review",
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [tool, setTool] = useState<
    | "polygon"
    | "rectangle"
    | "navigate"
    | "move"
    | "scale"
    | "rotate"
    | "handles"
  >("navigate");
  const [preview, setPreview] = useState(false);
  const [previewMode, setPreviewMode] = useState<"mapped" | "geometry">(
    "geometry",
  );
  const [previewComparison, setPreviewComparison] = useState<
    "before" | "after"
  >("after");
  const [beforeHeld, setBeforeHeld] = useState(false);
  const [previewUpdating, setPreviewUpdating] = useState(false);
  const [previewProject, setPreviewProject] = useState<LocationProject>(() =>
    createProjectionRegionPreviewProject(project, draft),
  );
  const previewGenerationRef = useRef(0);
  const [showOutlines, setShowOutlines] = useState(true);
  const [showSupport, setShowSupport] = useState(false);
  const [numbered, setNumbered] = useState(true);
  const [targetDraftDirty, setTargetDraftDirty] = useState(false);
  const [redrawRegionId, setRedrawRegionId] = useState<string>();
  const [editTarget, setEditTarget] = useState(false);
  const [regionTool, setRegionTool] = useState<"navigate" | "move-outline" | "edit-handles">("navigate");
  const gestureStartRef = useRef<ProjectionRegionDraft>();
  useEffect(() => {
    if (open) {
      setSourceId(initialSourcePanoId);
      const initialSaved = findProjectionRegionAlignmentForPano(
        normalizeProjectedStyleSettings(project.settings.projectedStyle),
        initialSourcePanoId,
      );
      setDraft(
        createProjectionRegionDraft(
          initialSourcePanoId,
          targets[0]?.id,
          initialSaved,
        ),
      );
      setMobilePane("review");
      setPreview(false);
      setRegionTool("navigate");
    }
  }, [open, initialSourcePanoId]);
  const previewDraftProject = useMemo(
    () => createProjectionRegionPreviewProject(project, draft),
    [project, draft],
  );
  useEffect(() => {
    const generation = ++previewGenerationRef.current;
    setPreviewUpdating(true);
    const timeoutId = window.setTimeout(() => {
      if (generation !== previewGenerationRef.current) return;
      setPreviewProject(previewDraftProject);
      setPreviewUpdating(false);
    }, 90);
    return () => window.clearTimeout(timeoutId);
  }, [previewDraftProject]);
  useEffect(() => {
    if (!preview) {
      setBeforeHeld(false);
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "b") return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input,textarea,select,[contenteditable='true']")) return;
      event.preventDefault();
      setBeforeHeld(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "b") setBeforeHeld(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [preview]);
  if (!open || !source) return null;
  const target = targets.find((pano) => pano.id === draft.targetGrayboxPanoId);
  const active =
    draft.pendingRegion ??
    draft.regions.find((region) => region.id === draft.activeRegionId);
  const diagnostics = active
    ? diagnoseProjectionRegionPolygon(active)
    : undefined;
  const alignment = draftToProjectionRegionAlignment(draft);
  const alignmentDiagnostics = projectionRegionDiagnosticsForAlignment(
    previewDraftProject,
    alignment,
  );
  const previewAlignment = findProjectionRegionAlignmentForPano(
    normalizeProjectedStyleSettings(previewProject.settings.projectedStyle),
    sourceId,
  );
  const canApply =
    !targetDraftDirty && !draft.pendingRegion && alignmentDiagnostics.valid;
  const canPreview = Boolean(target && (draft.regions.length || draft.pendingRegion));
  const effectivePreviewComparison = beforeHeld ? "before" : previewComparison;
  const close = () => {
    if (
      (!targetDraftDirty && !isProjectionRegionDraftDirty(draft)) ||
      window.confirm("Discard unsaved Region Fit changes?")
    )
      onClose();
  };
  const finishTarget = (points: { uv: Vec2 }[]) => {
    const positions = points.map((point) => point.uv);
    const next = redrawRegionId
      ? replaceTargetPolygon(draft, redrawRegionId, positions)
      : completeTargetPolygon(draft, positions);
    setDraft(next);
    setRedrawRegionId(undefined);
    setTargetDraftDirty(false);
    setTool("move");
    setRegionTool("move-outline");
    setMobilePane("styled");
  };
  const addRectangle = () => {
    setTool("rectangle");
    setMobilePane("graybox");
  };
  const beginRegionGesture = () => {
    gestureStartRef.current = draft;
  };
  const endRegionGesture = () => {
    const before = gestureStartRef.current;
    gestureStartRef.current = undefined;
    previewGenerationRef.current += 1;
    setDraft((current) => {
      const next = commitRegionGesture(current, before);
      setPreviewProject(createProjectionRegionPreviewProject(project, next));
      setPreviewUpdating(false);
      return next;
    });
  };
  const sourceInteractionMode = regionTool === "move-outline"
    ? "move-outline"
    : regionTool === "edit-handles"
      ? "edit-handles"
      : "navigate";
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Projection Assist Region Fit editor"
      className="fixed inset-0 z-[100] flex flex-col bg-surface-raised"
      data-projection-region-editor
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-subtle p-3">
        <div className="mr-auto">
          <h2 className="font-semibold text-primary">
            Projection Assist · Region Fit
          </h2>
          <p className="text-xs text-secondary">
            Draw the topology once, then adjust its paired styled outline.
          </p>
        </div>
        <label className="text-xs">
          Styled{" "}
          <select
            aria-label="Styled panorama"
            value={sourceId}
            onChange={(event) => {
              if (
                (targetDraftDirty || isProjectionRegionDraftDirty(draft)) &&
                !window.confirm(
                  "Changing the styled panorama discards this draft. Continue?",
                )
              )
                return;
              const id = event.target.value;
              const alignment = findProjectionRegionAlignmentForPano(
                normalizeProjectedStyleSettings(
                  project.settings.projectedStyle,
                ),
                id,
              );
              setSourceId(id);
              setDraft(
                createProjectionRegionDraft(id, targets[0]?.id, alignment),
              );
              setTargetDraftDirty(false);
            }}
            className="ml-1 rounded border border-subtle bg-surface-base p-2"
          >
            {sources.map((pano) => (
              <option key={pano.id} value={pano.id}>
                {pano.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          Graybox{" "}
          <select
            aria-label="Graybox panorama"
            value={draft.targetGrayboxPanoId}
            onChange={(event) => {
              if (
                (targetDraftDirty || isProjectionRegionDraftDirty(draft)) &&
                !window.confirm(
                  "Changing the graybox discards this draft. Continue?",
                )
              )
                return;
              setDraft(
                createProjectionRegionDraft(sourceId, event.target.value),
              );
              setTargetDraftDirty(false);
            }}
            className="ml-1 rounded border border-subtle bg-surface-base p-2"
          >
            {targets.map((pano) => (
              <option key={pano.id} value={pano.id}>
                {pano.name}
              </option>
            ))}
          </select>
        </label>
        <button
          aria-label={preview ? "Edit regions" : "Preview"}
          onClick={() => setPreview(!preview)}
          disabled={!preview && !canPreview}
          className="rounded-lg border border-subtle px-3 py-2 text-sm disabled:opacity-40"
        >
          {preview ? "Edit outline" : "Result"}
        </button>
        <button
          aria-label="Close Region Fit editor"
          onClick={close}
          className="p-2"
        >
          <X />
        </button>
      </header>
      {preview ? (
        <main className="flex min-h-0 flex-1 flex-col gap-2 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div
              className="flex rounded border border-subtle p-1"
              aria-label="Preview type"
            >
              <button
                aria-pressed={previewMode === "mapped"}
                onClick={() => setPreviewMode("mapped")}
                className="rounded px-3 py-1 text-xs"
              >
                Mapped panorama
              </button>
              <button
                aria-pressed={previewMode === "geometry"}
                onClick={() => setPreviewMode("geometry")}
                className="rounded px-3 py-1 text-xs"
              >
                Geometry
              </button>
            </div>
            <div
              className="flex rounded border border-subtle p-1"
              aria-label="Preview comparison"
            >
              <button
                aria-pressed={effectivePreviewComparison === "before"}
                onClick={() => setPreviewComparison("before")}
                className="rounded px-3 py-1 text-xs"
              >
                Before
              </button>
              <button
                aria-pressed={effectivePreviewComparison === "after"}
                onClick={() => setPreviewComparison("after")}
                className="rounded px-3 py-1 text-xs"
              >
                After
              </button>
            </div>
            <label className="text-xs">
              <input
                type="checkbox"
                checked={showOutlines}
                onChange={() => setShowOutlines(!showOutlines)}
              />{" "}
              Show outlines
            </label>
            {import.meta.env.DEV && (
              <label className="text-xs">
                <input
                  type="checkbox"
                  checked={showSupport}
                  onChange={() => setShowSupport(!showSupport)}
                />{" "}
                Show support regions
              </label>
            )}
            <span className="ml-auto text-xs text-secondary" aria-live="polite">
              {previewUpdating ? "Updating preview… " : ""}
              {beforeHeld ? "Holding B · " : ""}
              {alignmentDiagnostics.message}
            </span>
          </div>
          <div className="h-full min-h-0 overflow-hidden rounded-xl border border-subtle">
            {previewMode === "geometry" ? (
              <SceneViewport
                project={
                  effectivePreviewComparison === "after" ? previewProject : project
                }
                appearance="projected"
              />
            ) : (
              <ProjectionRegionResultPreview
                imageUrl={imageUrl(
                  project,
                  effectivePreviewComparison === "after" ? source : target,
                )}
                alignment={
                  effectivePreviewComparison === "after" ? previewAlignment : undefined
                }
                sourceYawRadians={degreesToRadians(source?.rotation[1] ?? 0)}
                targetYawRadians={degreesToRadians(target?.rotation[1] ?? 0)}
                sourceOrigin={source?.origin}
                targetOrigin={target?.origin}
                strength={draft.strength}
                regions={
                  showOutlines
                    ? viewerRegions(
                        showSupport ? draft : { ...draft, activeRegionId: undefined },
                        effectivePreviewComparison === "after" ? "source" : "target",
                        numbered,
                      )
                    : []
                }
                showOutlines={showOutlines}
                statusLabel={effectivePreviewComparison === "after" ? "After" : "Before"}
              />
            )}
          </div>
        </main>
      ) : (
        <>
          <nav
            className="flex border-b border-subtle sm:hidden"
            aria-label="Region Fit steps"
          >
            {(["graybox", "styled", "review"] as const).map((pane) => (
              <button
                key={pane}
                onClick={() => setMobilePane(pane)}
                className={`flex-1 p-3 text-xs font-semibold ${mobilePane === pane ? "bg-accent text-white" : ""}`}
              >
                {pane[0].toUpperCase() + pane.slice(1)}
              </button>
            ))}
          </nav>
          <main className="grid min-h-0 flex-1 grid-cols-1 gap-2 p-2 sm:grid-cols-[1fr_1fr_19rem]">
            <section
              className={`${mobilePane !== "graybox" ? "hidden sm:flex" : "flex"} min-h-[18rem] flex-col overflow-hidden rounded-xl border border-subtle`}
            >
              <div className="flex flex-wrap gap-1 border-b border-subtle p-2">
                <span className="mr-auto text-xs font-semibold">
                  Draw around the region where it should fit.
                </span>
                <button
                  onClick={() => {
                    setTool("polygon");
                    setEditTarget(false);
                  }}
                  className="rounded border px-2 py-1 text-xs"
                >
                  Polygon
                </button>
                <button
                  onClick={addRectangle}
                  className="rounded border px-2 py-1 text-xs"
                >
                  Rectangle
                </button>
                <button
                  onClick={() => {
                    setTool("navigate");
                    setEditTarget(false);
                  }}
                  className="rounded border px-2 py-1 text-xs"
                >
                  Navigate
                </button>
                <button
                  onClick={() => {
                    setTargetDraftDirty(false);
                    setTool("navigate");
                  }}
                  className="rounded border px-2 py-1 text-xs"
                >
              Cancel drawing
                </button>
              </div>
              <div className="min-h-0 flex-1">
                <PanoViewer
                  imageUrl={imageUrl(project, target)}
                  panoRotation={target?.rotation}
                  view={view}
                  onViewChange={(change) =>
                    setView((current) => ({ ...current, ...change }))
                  }
                  interactionMode={
                    tool === "polygon" || tool === "rectangle"
                      ? "draw-region"
                      : editTarget
                        ? "edit-handles"
                        : "navigate"
                  }
                  regionDrawShape={
                    tool === "rectangle" ? "rectangle" : "polygon"
                  }
                  regions={viewerRegions(draft, "target", numbered)}
                  activeRegionId={draft.activeRegionId}
                  selectedVertexIds={selectedIds}
                  onVertexSelectionChange={setSelectedIds}
                  onVertexMove={(regionId, vertexId, uv) =>
                    setDraft((current) =>
                      moveTargetVertexTransient(current, regionId, vertexId, uv),
                    )
                  }
                  onRegionGestureStart={beginRegionGesture}
                  onRegionGestureEnd={endRegionGesture}
                  onRegionDraftChange={(vertices) =>
                    setTargetDraftDirty(vertices.length > 0)
                  }
                  onRegionComplete={finishTarget}
                />
              </div>
            </section>
            <section
              className={`${mobilePane !== "styled" ? "hidden sm:flex" : "flex"} min-h-[18rem] flex-col overflow-hidden rounded-xl border border-subtle`}
            >
              <div className="flex flex-wrap gap-1 border-b border-subtle p-2">
                <span className="mr-auto text-xs font-semibold">
                  Move the outline around the matching region in the styled
                  panorama.
                </span>
                <div className="flex rounded border border-subtle p-1" aria-label="Styled preview mode">
                  <button
                    type="button"
                    aria-pressed={!preview}
                    onClick={() => setPreview(false)}
                    className="rounded px-2 py-1 text-xs"
                  >
                    Edit outline
                  </button>
                  <button
                    type="button"
                    aria-pressed={preview && previewMode === "mapped"}
                    disabled={!canPreview}
                    onClick={() => {
                      setPreviewMode("mapped");
                      setPreview(true);
                    }}
                    className="rounded px-2 py-1 text-xs disabled:opacity-40"
                  >
                    Result
                  </button>
                  <button
                    type="button"
                    aria-label="Preview on geometry"
                    disabled={!canPreview}
                    onClick={() => {
                      setPreviewMode("geometry");
                      setPreview(true);
                    }}
                    className="rounded px-2 py-1 text-xs disabled:opacity-40"
                  >
                    Geometry
                  </button>
                </div>
                <div className="flex rounded border border-subtle p-1" aria-label="Region Fit tool">
                  {([
                    ["navigate", "Navigate"],
                    ["move-outline", "Move outline"],
                    ["edit-handles", "Edit handles"],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={regionTool === value}
                      onClick={() => setRegionTool(value)}
                      className="rounded px-2 py-1 text-xs"
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {active && (
                  <>
                    <button
                      aria-label="Nudge outline"
                      onClick={() =>
                        setDraft((current) =>
                          translateSourceRegion(current, active.id, [0.01, 0]),
                        )
                      }
                      className="rounded border px-2 py-1 text-xs"
                    >
                      Nudge
                    </button>
                    <button
                      aria-label="Scale outline"
                      onClick={() =>
                        setDraft((current) =>
                          scaleSourceRegion(current, active.id, 1.05),
                        )
                      }
                      className="rounded border p-1"
                    >
                      <Scale size={14} />
                    </button>
                    <button
                      aria-label="Rotate outline"
                      onClick={() =>
                        setDraft((current) =>
                          rotateSourceRegion(current, active.id, Math.PI / 36),
                        )
                      }
                      className="rounded border p-1"
                    >
                      <RotateCw size={14} />
                    </button>
                    <button
                      aria-label="Reset to graybox outline"
                      onClick={() =>
                        setDraft((current) =>
                          resetSourceRegion(current, active.id),
                        )
                      }
                      className="rounded border px-2 py-1 text-xs"
                    >
                      Reset
                    </button>
                    <button
                      onClick={() =>
                        active === draft.pendingRegion
                          ? setDraft(cancelPendingRegion(draft))
                          : setMobilePane("review")
                      }
                      className="rounded border px-2 py-1 text-xs"
                    >
                      Cancel region
                    </button>
                  </>
                )}
              </div>
              <div className="min-h-0 flex-1">
                <PanoViewer
                  imageUrl={imageUrl(project, source)}
                  panoRotation={source.rotation}
                  view={view}
                  onViewChange={(change) =>
                    setView((current) => ({ ...current, ...change }))
                  }
                   interactionMode={active ? sourceInteractionMode : "navigate"}
                  regions={viewerRegions(draft, "source", numbered)}
                  activeRegionId={draft.activeRegionId}
                   onRegionTranslate={(regionId, delta) =>
                     setDraft((current) =>
                       translateSourceRegionTransient(current, regionId, delta),
                     )
                   }
                   onRegionGestureStart={beginRegionGesture}
                   onRegionGestureEnd={endRegionGesture}
                  selectedVertexIds={selectedIds}
                  onVertexSelectionChange={setSelectedIds}
                   onVertexMove={(regionId, vertexId, uv) =>
                     setDraft((current) =>
                       moveSourceVertexTransient(current, regionId, vertexId, uv),
                     )
                   }
                  onVertexInsert={(regionId, vertexId, edgeT) =>
                    setDraft((current) =>
                      insertRegionVertexPair(
                        current,
                        regionId,
                        vertexId,
                        edgeT,
                      ),
                    )
                  }
                  onVertexRemove={(regionId, vertexId) =>
                    setDraft((current) =>
                      removeRegionVertexPair(current, regionId, vertexId),
                    )
                  }
                />
              </div>
            </section>
            <aside
              className={`${mobilePane !== "review" ? "hidden sm:block" : "block"} min-h-0 overflow-auto rounded-xl border border-subtle p-3`}
            >
              <div className="flex items-center gap-2">
                <h3 className="mr-auto text-sm font-semibold">Regions</h3>
                <button
                  aria-label="Undo region action"
                  onClick={() => setDraft(undoRegionAction(draft))}
                >
                  <Undo2 size={16} />
                </button>
                <button
                  onClick={() => {
                    setTool("polygon");
                    setMobilePane("graybox");
                  }}
                  className="rounded bg-accent px-2 py-1 text-xs text-white"
                >
                  <Plus size={13} className="inline" /> Add region
                </button>
              </div>
              {!draft.regions.length && !draft.pendingRegion && (
                <p className="mt-4 text-xs text-secondary">
                  Add a region to align part of the styled panorama with the
                  graybox.
                </p>
              )}
              {draft.pendingRegion && (
                <div className="mt-3 rounded border border-accent p-2">
                  <p className="text-xs font-semibold">
                    {draft.pendingRegion.name}
                  </p>
                  <p
                    className={`text-xs ${diagnostics?.valid ? "text-emerald-600" : "text-red-600"}`}
                  >
                    {diagnostics?.valid
                      ? "Region valid"
                      : diagnostics?.messages[0]}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => {
                        setDraft(commitPendingRegion(draft));
                        setMobilePane("review");
                      }}
                      disabled={!diagnostics?.valid}
                      className="rounded bg-accent px-2 py-1 text-xs text-white disabled:opacity-40"
                    >
                      Save region
                    </button>
                    <button
                      onClick={() => setDraft(cancelPendingRegion(draft))}
                      className="text-xs"
                    >
                      Cancel region
                    </button>
                  </div>
                </div>
              )}
              <div className="mt-3 space-y-2">
                {draft.regions.map((region) => (
                  <div
                    key={region.id}
                    data-region-row={region.id}
                    className="rounded border border-subtle p-2"
                  >
                    <div className="flex items-center gap-1">
                      <input
                        aria-label={`Enable ${region.name}`}
                        type="checkbox"
                        checked={region.enabled}
                        onChange={() =>
                          setDraft(toggleRegion(draft, region.id))
                        }
                      />
                      <input
                        aria-label="Region name"
                        value={region.name}
                        onChange={(event) =>
                          setDraft(
                            renameRegion(draft, region.id, event.target.value),
                          )
                        }
                        className="min-w-0 flex-1 bg-transparent text-xs font-semibold"
                      />
                      <button
                        aria-label="Move region up"
                        onClick={() => setDraft(moveRegionUp(draft, region.id))}
                      >
                        <ArrowUp size={13} />
                      </button>
                      <button
                        aria-label="Move region down"
                        onClick={() =>
                          setDraft(moveRegionDown(draft, region.id))
                        }
                      >
                        <ArrowDown size={13} />
                      </button>
                      <button
                        aria-label="Remove region"
                        onClick={() => setDraft(removeRegion(draft, region.id))}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                    <p
                      className={`mt-1 text-[11px] ${alignmentDiagnostics.regionMessages[region.id] ? "text-red-600" : "text-emerald-600"}`}
                    >
                      {alignmentDiagnostics.regionMessages[region.id] ??
                        (region.enabled ? "Region valid" : "Region disabled")}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        onClick={() => {
                           setDraft({ ...draft, activeRegionId: region.id });
                           setMobilePane("styled");
                           setRegionTool("move-outline");
                           setEditTarget(false);
                        }}
                        className="text-xs text-accent"
                      >
                        Adjust styled outline
                      </button>
                      <button
                        onClick={() => {
                          setDraft({ ...draft, activeRegionId: region.id });
                          setMobilePane("graybox");
                          setTool("navigate");
                          setEditTarget(true);
                        }}
                        className="text-xs text-accent"
                      >
                        Edit graybox outline
                      </button>
                      <button
                        onClick={() => {
                          setDraft({ ...draft, activeRegionId: region.id });
                          setRedrawRegionId(region.id);
                          setTool("polygon");
                          setEditTarget(false);
                          setMobilePane("graybox");
                        }}
                        className="text-xs text-accent"
                      >
                        Redraw graybox outline
                      </button>
                    </div>
                    <label className="mt-2 block text-[11px]">
                      Edge softness{" "}
                      <input
                        aria-label={`Edge softness ${region.name}`}
                        type="range"
                        min="0"
                        max="0.25"
                        step="0.005"
                        value={region.edgeSoftness}
                        onChange={(event) =>
                          setDraft(
                            setRegionEdgeSoftness(
                              draft,
                              region.id,
                              Number(event.target.value),
                            ),
                          )
                        }
                        className="w-full"
                      />
                    </label>
                  </div>
                ))}
              </div>
              <label className="mt-4 block text-xs">
                Overall strength ({Math.round(draft.strength * 100)}%)
                <input
                  aria-label="Region Fit strength"
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={draft.strength}
                  onChange={(event) =>
                    setDraft(
                      setRegionStrength(draft, Number(event.target.value)),
                    )
                  }
                  className="w-full"
                />
              </label>
              <label className="mt-2 flex gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={numbered}
                  onChange={() => setNumbered(!numbered)}
                />{" "}
                Matching handle numbers
              </label>
            </aside>
          </main>
        </>
      )}
      <footer className="flex items-center gap-2 border-t border-subtle p-3">
        <span className="mr-auto text-xs text-secondary">
          {saved && draft.regions.length
            ? `${draft.regions.length} regions`
            : "No Region Fit"}
          {saved &&
          normalizeProjectedStyleSettings(
            project.settings.projectedStyle,
          ).alignments?.some(
            (alignment) => alignment.sourcePanoId === source.id,
          )
            ? " · legacy point correction inactive"
            : ""}
        </span>
        <button onClick={close} className="px-3 py-2 text-sm">
          Cancel
        </button>
        <button
          onClick={() =>
            onApply(source.id, draftToProjectionRegionAlignment(draft))
          }
          disabled={!canApply}
          className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          <Check size={15} className="inline" /> Apply
        </button>
      </footer>
    </div>
  );
}
