import React, { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Camera,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileDown,
  Grid3X3,
  Keyboard,
  Lock,
  MousePointer2,
  Move3D,
  RotateCcw,
  Ruler,
  Trash2,
  Unlock,
} from 'lucide-react';
import { SceneObject, SceneObjectType, Vec3 } from '../../domain/types';
import { objectDisplayName } from '../../domain/defaults';
import { getLatestGrayboxPano, getPanoAsset } from '../../domain/selectors';
import {
  BUILD_PRIMITIVE_SHORTCUTS,
  CLICK_ONLY_BUILD_PRIMITIVES,
  HOTKEYED_BUILD_PRIMITIVES,
  getPrimitiveShortcutLabel,
  resolveBuildShortcut,
} from '../../engine/buildShortcuts';
import { downloadPanoImage } from '../../engine/panoImage';
import { downloadDataUrl } from '../../engine/projectIO';
import { BuildMode, useContinuityStore } from '../../state/useContinuityStore';
import { Field, IconButton, Panel, Select, TextInput } from '../common/Field';
import { Vec3Input } from '../common/Vec3Input';
import { SceneViewport } from '../viewers/SceneViewport';

const primitiveTypes: SceneObjectType[] = [
  ...HOTKEYED_BUILD_PRIMITIVES,
  ...CLICK_ONLY_BUILD_PRIMITIVES,
];

const primitiveShortNames: Partial<Record<SceneObjectType, string>> = {
  tree_blob: 'Tree',
  terrain_mass: 'Terrain',
  background_card: 'Backdrop',
  human_dummy: 'Person',
  sun_marker: 'Sun',
};

export function BuildWorkspace() {
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const {
    project,
    selectedObjectId,
    buildMode,
    activePrimitive,
    gridSnap,
    setBuildMode,
    setActivePrimitive,
    setGridSnap,
    placeObject,
    selectObject,
    updateObject,
    moveObjectToGroundPoint,
    duplicateObject,
    toggleObjectLocked,
    toggleObjectVisibility,
    removeObject,
    setPanoOrigin,
    renderGrayboxPano,
    isRenderingGraybox,
  } = useContinuityStore();
  const selectedObject = project.scene.objects.find((object) => object.id === selectedObjectId);
  const grayboxPano = getLatestGrayboxPano(project);
  const grayboxAsset = getPanoAsset(project, grayboxPano);

  const rotateSelected = useCallback((degrees: number) => {
    if (!selectedObject) return;
    updateObject(selectedObject.id, {
      transform: {
        ...selectedObject.transform,
        rotation: [
          selectedObject.transform.rotation[0],
          normalizeDegrees(selectedObject.transform.rotation[1] + degrees),
          selectedObject.transform.rotation[2],
        ],
      },
    });
  }, [selectedObject, updateObject]);

  const scaleSelected = useCallback((factor: number) => {
    if (!selectedObject) return;
    updateObject(selectedObject.id, {
      dimensions: selectedObject.dimensions.map((value) => Math.max(0.05, Number((value * factor).toFixed(2)))) as Vec3,
    });
  }, [selectedObject, updateObject]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const command = resolveBuildShortcut(event);
      if (!command) return;
      event.preventDefault();

      if (command.kind === 'primitive') {
        blurActiveElement();
        setActivePrimitive(command.type);
        return;
      }
      if (command.kind === 'mode') {
        setBuildMode(command.mode === 'pano_origin' && buildMode !== 'pano_origin' ? 'pano_origin' : 'select');
        return;
      }
      if (command.kind === 'toggle-snap') {
        setGridSnap(!gridSnap);
        return;
      }

      if (!selectedObject) return;
      if (command.kind === 'duplicate') duplicateObject(selectedObject.id);
      if (command.kind === 'rotate-left') rotateSelected(-15);
      if (command.kind === 'rotate-right') rotateSelected(15);
      if (command.kind === 'scale-down') scaleSelected(0.9);
      if (command.kind === 'scale-up') scaleSelected(1.1);
      if (command.kind === 'toggle-lock') toggleObjectLocked(selectedObject.id);
      if (command.kind === 'toggle-visibility') toggleObjectVisibility(selectedObject.id);
      if (command.kind === 'toggle-precision') setInspectorOpen((open) => !open);
      if (command.kind === 'delete') removeObject(selectedObject.id);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    buildMode,
    duplicateObject,
    gridSnap,
    removeObject,
    rotateSelected,
    scaleSelected,
    selectedObject,
    setActivePrimitive,
    setBuildMode,
    setGridSnap,
    toggleObjectLocked,
    toggleObjectVisibility,
  ]);

  return (
    <WorkspaceLayout
      sidebar={(
        <>
          <Panel
            title="Toybox Layers"
            actions={(
              <button
                className="rounded-md border border-zinc-200 px-2 py-1 text-xs font-medium text-zinc-600 transition hover:border-teal-400 hover:text-teal-700"
                onClick={() => setBuildMode('select')}
              >
                Select
              </button>
            )}
          >
            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {project.scene.objects.map((object) => (
                <button
                  key={object.id}
                  onClick={() => {
                    selectObject(object.id);
                    setBuildMode('select');
                  }}
                  className={`flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition ${
                    selectedObjectId === object.id
                      ? 'border-teal-500 bg-teal-50 text-teal-950 shadow-sm'
                      : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50'
                  }`}
                >
                  <Box className="h-4 w-4 shrink-0 text-zinc-400" />
                  <span className="min-w-0 flex-1 truncate">{object.name}</span>
                  <span className="text-xs text-zinc-400">{objectDisplayName(object.type)}</span>
                </button>
              ))}
            </div>
          </Panel>

          <Panel title="Origin & 360">
            <div className="space-y-3">
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                Pano origin: {project.scene.panoOrigin.map((item) => item.toFixed(1)).join(', ')}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <IconButton
                  onClick={() => setBuildMode(buildMode === 'pano_origin' ? 'select' : 'pano_origin')}
                  active={buildMode === 'pano_origin'}
                >
                  <Move3D className="h-4 w-4" />
                  Origin
                </IconButton>
                <IconButton onClick={() => void renderGrayboxPano()} disabled={isRenderingGraybox}>
                  <Download className="h-4 w-4" />
                  {isRenderingGraybox ? 'Rendering' : 'Render'}
                </IconButton>
              </div>
              <IconButton
                onClick={() => {
                  if (!grayboxAsset || !grayboxPano) return;
                  void downloadPanoImage(
                    grayboxAsset.uri,
                    grayboxPano.width,
                    grayboxPano.height,
                    grayboxAsset.name || 'global_graybox.png',
                    {
                      letterboxEnabled: project.settings.panoLetterboxExports169,
                      targetWidth: project.settings.defaultShotWidth,
                      targetHeight: project.settings.defaultShotHeight,
                    },
                    downloadDataUrl,
                  );
                }}
                disabled={!grayboxAsset || isRenderingGraybox}
                className="w-full"
              >
                <FileDown className="h-4 w-4" />
                Download Graybox PNG
              </IconButton>
              {grayboxPano && (
                <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-zinc-600">
                  Latest graybox: {grayboxPano.width}x{grayboxPano.height} equirectangular PNG
                </p>
              )}
            </div>
          </Panel>

          <Panel title="Shortcuts">
            <div className="space-y-3 text-sm text-zinc-600">
              <div className="flex items-center gap-2 text-zinc-800">
                <Keyboard className="h-4 w-4 text-teal-600" />
                <span className="font-medium">Build keys</span>
              </div>
              <ShortcutRows
                rows={[
                  ['1-0', 'Stamp slots'],
                  ['V / Esc', 'Select'],
                  ['Shift+drag', 'Orbit view'],
                  ['MMB / RMB', 'Orbit view'],
                  ['O', 'Origin'],
                  ['G', gridSnap ? 'Snap on' : 'Snap off'],
                  ['D', 'Duplicate'],
                  ['R / Shift+R', 'Rotate'],
                  ['[ / ]', 'Scale'],
                  ['L', 'Lock'],
                  ['H', 'Hide'],
                  ['I', 'Precision'],
                  ['Del', 'Delete'],
                ]}
              />
            </div>
          </Panel>

          {selectedObject && (
            <Panel
              title="Precision Drawer"
              actions={(
                <button
                  className="rounded-md border border-zinc-200 px-2 py-1 text-xs font-medium text-zinc-600 transition hover:border-teal-400 hover:text-teal-700"
                  onClick={() => setInspectorOpen((open) => !open)}
                >
                  {inspectorOpen ? 'Hide' : 'Show'}
                </button>
              )}
            >
              {inspectorOpen ? (
                <PrecisionControls
                  object={selectedObject}
                  onChange={(updates) => updateObject(selectedObject.id, updates)}
                />
              ) : (
                <p className="text-sm text-zinc-500">
                  Use the quickbar for play. Open this only when exact values matter.
                </p>
              )}
            </Panel>
          )}
        </>
      )}
    >
      <div className="relative h-full min-h-0">
        <SceneViewport
          project={project}
          selectedObjectId={selectedObjectId}
          placementType={buildMode === 'place' ? activePrimitive : undefined}
          placementLabel={primitiveLabel(activePrimitive)}
          originPlacementActive={buildMode === 'pano_origin'}
          snapToGrid={gridSnap}
          onSelectObject={selectObject}
          onPlaceObject={placeObject}
          onMoveObject={moveObjectToGroundPoint}
          onMovePanoOrigin={setPanoOrigin}
        />

        <BuildToolTray
          activePrimitive={activePrimitive}
          buildMode={buildMode}
          gridSnap={gridSnap}
          onModeChange={setBuildMode}
          onPrimitiveChange={setActivePrimitive}
          onGridSnapChange={setGridSnap}
        />

        <BuildModeBadge buildMode={buildMode} activePrimitive={activePrimitive} activePrimitiveLabel={primitiveLabel(activePrimitive)} gridSnap={gridSnap} />

        {selectedObject && (
          <SelectedQuickbar
            object={selectedObject}
            onRename={(name) => updateObject(selectedObject.id, { name })}
            onDuplicate={() => duplicateObject(selectedObject.id)}
            onDelete={() => removeObject(selectedObject.id)}
            onRotateLeft={() => rotateSelected(-15)}
            onRotateRight={() => rotateSelected(15)}
            onScaleDown={() => scaleSelected(0.9)}
            onScaleUp={() => scaleSelected(1.1)}
            onToggleLock={() => toggleObjectLocked(selectedObject.id)}
            onToggleVisibility={() => toggleObjectVisibility(selectedObject.id)}
            onOpenPrecision={() => setInspectorOpen(true)}
          />
        )}

        <div className="pointer-events-none absolute bottom-4 left-4 max-w-md rounded-md border border-white/70 bg-white/90 px-4 py-3 text-sm text-zinc-700 shadow-sm backdrop-blur">
          <Camera className="mr-2 inline h-4 w-4 text-amber-600" />
          Build the set like a tabletop, drag the amber origin, then render the graybox 360.
        </div>
      </div>
    </WorkspaceLayout>
  );
}

function BuildToolTray({
  activePrimitive,
  buildMode,
  gridSnap,
  onModeChange,
  onPrimitiveChange,
  onGridSnapChange,
}: {
  activePrimitive: SceneObjectType;
  buildMode: BuildMode;
  gridSnap: boolean;
  onModeChange: (mode: BuildMode) => void;
  onPrimitiveChange: (type: SceneObjectType) => void;
  onGridSnapChange: (value: boolean) => void;
}) {
  return (
    <div className="pointer-events-none absolute left-4 right-4 top-4 z-10 max-w-full overflow-x-auto rounded-md border border-white/70 bg-white/90 p-2 shadow-sm backdrop-blur">
      <div className="pointer-events-auto flex gap-2">
      <ToolPill active={buildMode === 'select'} onClick={() => onModeChange('select')} shortcut="V" title="Select and move">
        <MousePointer2 className="h-4 w-4" />
        Select
      </ToolPill>
      <ToolPill active={buildMode === 'pano_origin'} onClick={() => onModeChange('pano_origin')} shortcut="O" title="Drag pano origin">
        <Move3D className="h-4 w-4" />
        Origin
      </ToolPill>
      <ToolPill active={gridSnap} onClick={() => onGridSnapChange(!gridSnap)} shortcut="G" title="Toggle grid snap">
        <Grid3X3 className="h-4 w-4" />
        Snap
      </ToolPill>
      <div className="mx-1 w-px shrink-0 bg-zinc-200" />
      {BUILD_PRIMITIVE_SHORTCUTS.map(({ key, type }) => (
        <ToolPill
          key={type}
          active={buildMode === 'place' && activePrimitive === type}
          onClick={() => onPrimitiveChange(type)}
          shortcut={key}
          title={`Place ${objectDisplayName(type)}`}
        >
          <Box className="h-4 w-4" />
          {primitiveLabel(type)}
        </ToolPill>
      ))}
      <div className="mx-1 w-px shrink-0 bg-zinc-200" />
      {CLICK_ONLY_BUILD_PRIMITIVES.map((type) => (
        <ToolPill
          key={type}
          active={buildMode === 'place' && activePrimitive === type}
          onClick={() => onPrimitiveChange(type)}
          title={`Place ${objectDisplayName(type)}`}
        >
          <Box className="h-4 w-4" />
          {primitiveLabel(type)}
        </ToolPill>
      ))}
      </div>
    </div>
  );
}

function BuildModeBadge({
  buildMode,
  activePrimitive,
  activePrimitiveLabel,
  gridSnap,
}: {
  buildMode: BuildMode;
  activePrimitive: SceneObjectType;
  activePrimitiveLabel: string;
  gridSnap: boolean;
}) {
  const primitiveShortcut = getPrimitiveShortcutLabel(activePrimitive);
  const label = buildMode === 'place'
    ? `Stamping ${activePrimitiveLabel}`
    : buildMode === 'pano_origin'
      ? 'Origin'
      : 'Select';
  const accent = buildMode === 'pano_origin'
    ? 'border-amber-200 bg-amber-50 text-amber-950'
    : buildMode === 'place'
      ? 'border-teal-200 bg-teal-50 text-teal-950'
      : 'border-zinc-200 bg-white text-zinc-700';

  return (
    <div className={`pointer-events-none absolute left-4 top-20 z-10 flex max-w-[calc(100%-2rem)] flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-xs shadow-sm backdrop-blur ${accent}`}>
      <span className="font-semibold">{label}</span>
      {primitiveShortcut && buildMode === 'place' && <Kbd>{primitiveShortcut}</Kbd>}
      {buildMode !== 'select' && (
        <>
          <span className="text-current/60">Exit</span>
          <Kbd>Esc</Kbd>
          <Kbd>V</Kbd>
        </>
      )}
      <span className="text-current/60">{gridSnap ? 'Snap on' : 'Snap off'}</span>
    </div>
  );
}

function SelectedQuickbar({
  object,
  onRename,
  onDuplicate,
  onDelete,
  onRotateLeft,
  onRotateRight,
  onScaleDown,
  onScaleUp,
  onToggleLock,
  onToggleVisibility,
  onOpenPrecision,
}: {
  object: SceneObject;
  onRename: (name: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onRotateLeft: () => void;
  onRotateRight: () => void;
  onScaleDown: () => void;
  onScaleUp: () => void;
  onToggleLock: () => void;
  onToggleVisibility: () => void;
  onOpenPrecision: () => void;
}) {
  return (
    <div className="pointer-events-none absolute bottom-4 left-1/2 z-10 flex max-w-[min(760px,calc(100%-2rem))] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-md border border-zinc-200 bg-white/95 p-2 shadow-lg backdrop-blur">
      <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2">
      <TextInput
        value={object.name}
        onChange={(event) => onRename(event.target.value)}
        aria-label="Selected object name"
        className="h-9 min-w-48 bg-zinc-50"
      />
      <QuickIcon title="Duplicate" shortcut="D" onClick={onDuplicate}><Copy className="h-4 w-4" /></QuickIcon>
      <QuickIcon title="Rotate left" shortcut="Shift+R" onClick={onRotateLeft}><RotateCcw className="h-4 w-4" /></QuickIcon>
      <QuickIcon title="Rotate right" shortcut="R" onClick={onRotateRight}><RotateCcw className="h-4 w-4 scale-x-[-1]" /></QuickIcon>
      <QuickIcon title="Scale down" shortcut="[" onClick={onScaleDown}>-</QuickIcon>
      <QuickIcon title="Scale up" shortcut="]" onClick={onScaleUp}>+</QuickIcon>
      <QuickIcon title={object.locked ? 'Unlock' : 'Lock'} shortcut="L" onClick={onToggleLock}>
        {object.locked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
      </QuickIcon>
      <QuickIcon title={object.visible ? 'Hide' : 'Show'} shortcut="H" onClick={onToggleVisibility}>
        {object.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
      </QuickIcon>
      <QuickIcon title="Precision drawer" shortcut="I" onClick={onOpenPrecision}><Ruler className="h-4 w-4" /></QuickIcon>
      <QuickIcon title="Delete" shortcut="Del" onClick={onDelete} danger><Trash2 className="h-4 w-4" /></QuickIcon>
      </div>
    </div>
  );
}

function ShortcutRows({ rows }: { rows: Array<[string, string]> }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {rows.map(([shortcut, label]) => (
        <div key={`${shortcut}-${label}`} className="flex items-center justify-between gap-2 rounded-md border border-zinc-100 bg-zinc-50 px-2 py-1.5">
          <span className="truncate text-xs text-zinc-500">{label}</span>
          <Kbd>{shortcut}</Kbd>
        </div>
      ))}
    </div>
  );
}

function PrecisionControls({
  object,
  onChange,
}: {
  object: SceneObject;
  onChange: (updates: Partial<SceneObject>) => void;
}) {
  return (
    <div className="space-y-3">
      <Field label="Name">
        <TextInput value={object.name} onChange={(event) => onChange({ name: event.target.value })} />
      </Field>
      <Field label="Type">
        <Select value={object.type} onChange={(event) => onChange({ type: event.target.value as SceneObjectType })}>
          {primitiveTypes.map((type) => <option key={type} value={type}>{objectDisplayName(type)}</option>)}
        </Select>
      </Field>
      <Field label="Position">
        <Vec3Input
          value={object.transform.position}
          onChange={(position) => onChange({ transform: { ...object.transform, position } })}
        />
      </Field>
      <Field label="Rotation">
        <Vec3Input
          value={object.transform.rotation}
          step={1}
          onChange={(rotation) => onChange({ transform: { ...object.transform, rotation } })}
        />
      </Field>
      <Field label="Dimensions">
        <Vec3Input value={object.dimensions} onChange={(dimensions) => onChange({ dimensions })} />
      </Field>
    </div>
  );
}

function ToolPill({
  active,
  shortcut,
  children,
  className,
  title,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; shortcut?: string }) {
  const displayTitle = shortcut && typeof title === 'string' ? `${title} (${shortcut})` : title;

  return (
    <button
      {...props}
      aria-keyshortcuts={shortcut}
      title={displayTitle}
      className={`inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium transition ${
        active
          ? 'border-teal-500 bg-teal-500 text-white shadow-sm'
          : 'border-zinc-200 bg-white text-zinc-700 hover:border-teal-300 hover:text-teal-700'
      } ${className ?? ''}`}
    >
      {children}
      {shortcut && <ShortcutBadge active={active}>{shortcut}</ShortcutBadge>}
    </button>
  );
}

function QuickIcon({
  children,
  danger,
  shortcut,
  className,
  title,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean; shortcut?: string }) {
  const displayTitle = shortcut && typeof title === 'string' ? `${title} (${shortcut})` : title;

  return (
    <button
      {...props}
      aria-keyshortcuts={shortcut}
      title={displayTitle}
      className={`relative inline-flex h-9 w-9 items-center justify-center rounded-md border text-sm font-semibold transition ${
        danger
          ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
          : 'border-zinc-200 bg-white text-zinc-700 hover:border-teal-300 hover:text-teal-700'
      } ${className ?? ''}`}
    >
      {children}
      {shortcut && <ShortcutBadge floating danger={danger}>{shortcut}</ShortcutBadge>}
    </button>
  );
}

function ShortcutBadge({
  active,
  danger,
  floating,
  children,
}: {
  active?: boolean;
  danger?: boolean;
  floating?: boolean;
  children: React.ReactNode;
}) {
  const color = danger
    ? 'border-red-200 bg-white text-red-700'
    : active
      ? 'border-white/30 bg-white/20 text-white'
      : 'border-zinc-200 bg-zinc-50 text-zinc-500';
  return (
    <span className={`${floating ? 'absolute -right-1 -top-1' : ''} inline-flex min-w-4 items-center justify-center rounded border px-1 text-[9px] font-semibold leading-4 ${color}`}>
      {children}
    </span>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-5 items-center justify-center rounded border border-zinc-200 bg-white px-1.5 text-[10px] font-semibold leading-5 text-zinc-600 shadow-sm">
      {children}
    </kbd>
  );
}

export function WorkspaceLayout({
  sidebar,
  children,
}: {
  sidebar: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 bg-zinc-100 p-3 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]">
      <main className="order-1 min-h-[520px] overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm lg:min-h-0">{children}</main>
      <aside className="order-2 min-h-0 overflow-y-auto rounded-md border border-zinc-200 bg-white shadow-sm">{sidebar}</aside>
    </div>
  );
}

function normalizeDegrees(value: number) {
  return ((value % 360) + 360) % 360;
}

function blurActiveElement() {
  const active = document.activeElement;
  if (active instanceof HTMLElement) active.blur();
}

function primitiveLabel(type: SceneObjectType) {
  return primitiveShortNames[type] ?? objectDisplayName(type);
}
