import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Circle,
  Columns3,
  Copy,
  DoorOpen,
  Eye,
  EyeOff,
  FileDown,
  Globe,
  Grid3X3,
  Layers,
  Lock,
  Mountain,
  Move3D,
  RotateCcw,
  RotateCw,
  Ruler,
  Square,
  SquareStack,
  Sun,
  Trash2,
  TreeDeciduous,
  Unlock,
  User,
  Wrench,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { SceneObject, SceneObjectType, Vec3 } from '../../domain/types';
import { objectDisplayName } from '../../domain/defaults';
import { getLatestGrayboxPano, getPanoAsset } from '../../domain/selectors';
import {
  CLICK_ONLY_BUILD_PRIMITIVES,
  HOTKEYED_BUILD_PRIMITIVES,
  resolveBuildShortcut,
} from '../../engine/buildShortcuts';
import { downloadPanoImage } from '../../engine/panoImage';
import { downloadDataUrl } from '../../engine/projectIO';
import { BuildMode, useContinuityStore } from '../../state/useContinuityStore';
import { useThemeStore } from '../../state/useThemeStore';
import { resolveWorkspacePrimaryAction } from '../../engine/workflow';
import { ContextualPanel } from '../common/ContextualPanel';
import { Field, Select, TextInput } from '../common/Field';
import { PrecisionDrawer } from '../common/PrecisionDrawer';
import { PrimaryCTA } from '../common/PrimaryCTA';
import { Vec3Input } from '../common/Vec3Input';
import { SceneViewport } from '../viewers/SceneViewport';
import { FullBleedLayout } from './WorkspaceShell';

const primitiveTypes: SceneObjectType[] = [
  ...HOTKEYED_BUILD_PRIMITIVES,
  ...CLICK_ONLY_BUILD_PRIMITIVES,
];

const trayItems: Array<{ type: SceneObjectType; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { type: 'box', label: 'Block', icon: Box },
  { type: 'floor', label: 'Plane', icon: Square },
  { type: 'wall', label: 'Wall', icon: Layers },
  { type: 'doorway', label: 'Doorway', icon: DoorOpen },
  { type: 'tree_blob', label: 'Tree', icon: TreeDeciduous },
  { type: 'column', label: 'Cylinder', icon: Circle },
  { type: 'stairs', label: 'Stairs', icon: SquareStack },
  { type: 'sun_marker', label: 'Light', icon: Sun },
  { type: 'arch', label: 'Arch', icon: DoorOpen },
  { type: 'terrain_mass', label: 'Terrain', icon: Mountain },
  { type: 'background_card', label: 'Backdrop', icon: Columns3 },
  { type: 'human_dummy', label: 'Person', icon: User },
];
const primaryTrayItems = trayItems.slice(0, 8);
const overflowTrayItems = trayItems.slice(8);

export function BuildWorkspace() {
  const theme = useThemeStore((state) => state.theme);
  const [precisionOpen, setPrecisionOpen] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [showSceneGuides, setShowSceneGuides] = useState(false);
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
  const primaryAction = useMemo(
    () => resolveWorkspacePrimaryAction({ project, workspace: 'build', shotCameraFlying: false }),
    [project],
  );

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
      if (command.kind === 'toggle-precision') setPrecisionOpen((open) => !open);
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

  useEffect(() => {
    if (!selectedObject) {
      setPrecisionOpen(false);
      setLayersOpen(false);
    }
  }, [selectedObject]);

  return (
    <FullBleedLayout>
      <div className="relative h-full min-h-0">
        <SceneViewport
          project={project}
          selectedObjectId={selectedObjectId}
          placementType={buildMode === 'place' ? activePrimitive : undefined}
          placementLabel={primitiveLabel(activePrimitive)}
          originPlacementActive={buildMode === 'pano_origin'}
          showSceneGuides={showSceneGuides}
          showTransformGizmo={Boolean(selectedObject && buildMode === 'select')}
          snapToGrid={gridSnap}
          onSelectObject={selectObject}
          onPlaceObject={placeObject}
          onMoveObject={moveObjectToGroundPoint}
          onMovePanoOrigin={setPanoOrigin}
        />

        <div className="pointer-events-none absolute right-5 top-5 z-10">
          <button
            type="button"
            title={showSceneGuides ? 'Hide scene guides' : 'Show camera guides'}
            onClick={() => setShowSceneGuides((visible) => !visible)}
            className={`pointer-events-auto inline-flex h-8 w-8 items-center justify-center rounded-lg border transition ${
              showSceneGuides
                ? 'border-[var(--accent)] bg-accent-soft text-accent'
                : 'border-subtle bg-surface-overlay/90 text-secondary hover:border-accent hover:text-accent'
            }`}
          >
            {showSceneGuides ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          </button>
        </div>

        {selectedObject && (
          <div className="pointer-events-none absolute right-5 top-14 z-10">
            <ContextualPanel>
              <div className="flex items-center gap-2">
                <TextInput
                  value={selectedObject.name}
                  onChange={(event) => updateObject(selectedObject.id, { name: event.target.value })}
                  aria-label="Selected object name"
                  className="h-8 min-w-36 border-subtle bg-surface-muted"
                />
                <button
                  type="button"
                  onClick={() => setPrecisionOpen(true)}
                  title="Precision drawer (I)"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-subtle text-secondary transition hover:border-accent hover:text-accent"
                >
                  <Ruler className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setLayersOpen((open) => !open)}
                  title="Scene layers"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-subtle text-secondary transition hover:border-accent hover:text-accent"
                >
                  <Layers className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                <QuickAction title="Rotate left (Shift+R)" onClick={() => rotateSelected(-15)}><RotateCcw className="h-3.5 w-3.5" /></QuickAction>
                <QuickAction title="Rotate right (R)" onClick={() => rotateSelected(15)}><RotateCw className="h-3.5 w-3.5" /></QuickAction>
                <QuickAction title="Scale down ([)" onClick={() => scaleSelected(0.9)}><ZoomOut className="h-3.5 w-3.5" /></QuickAction>
                <QuickAction title="Scale up (])" onClick={() => scaleSelected(1.1)}><ZoomIn className="h-3.5 w-3.5" /></QuickAction>
                <QuickAction title="Duplicate (D)" onClick={() => duplicateObject(selectedObject.id)}><Copy className="h-3.5 w-3.5" /></QuickAction>
                <QuickAction title={selectedObject.locked ? 'Unlock (L)' : 'Lock (L)'} onClick={() => toggleObjectLocked(selectedObject.id)}>
                  {selectedObject.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
                </QuickAction>
                <QuickAction title={selectedObject.visible ? 'Hide (H)' : 'Show (H)'} onClick={() => toggleObjectVisibility(selectedObject.id)}>
                  {selectedObject.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                </QuickAction>
                <QuickAction title="Delete" danger onClick={() => removeObject(selectedObject.id)}><Trash2 className="h-3.5 w-3.5" /></QuickAction>
              </div>
              {layersOpen && (
                <div className="mt-3 max-h-40 space-y-1 overflow-y-auto border-t border-subtle pt-3">
                  {project.scene.objects.map((object) => (
                    <button
                      key={object.id}
                      type="button"
                      onClick={() => selectObject(object.id)}
                      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition ${
                        selectedObjectId === object.id ? 'bg-accent-soft text-accent' : 'text-secondary hover:bg-surface-muted'
                      }`}
                    >
                      <Box className="h-3 w-3 shrink-0" />
                      <span className="truncate">{object.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </ContextualPanel>
          </div>
        )}

        <BuildObjectTray
          activePrimitive={activePrimitive}
          buildMode={buildMode}
          gridSnap={gridSnap}
          onModeChange={setBuildMode}
          onPrimitiveChange={setActivePrimitive}
          onGridSnapChange={setGridSnap}
        />

        <div className="pointer-events-none absolute bottom-6 right-6 z-10">
          <PrimaryCTA
            icon={<Globe className="h-5 w-5" />}
            label={isRenderingGraybox ? 'Rendering...' : 'Render 360 Reference'}
            onClick={() => void renderGrayboxPano()}
            disabled={isRenderingGraybox}
            highlighted={primaryAction?.id === 'render-graybox'}
            appearance={theme === 'dark' ? 'glow-outline' : 'solid'}
          />
        </div>

        {buildMode === 'pano_origin' && (
          <div className="pointer-events-none absolute left-5 top-20 z-10">
            <ContextualPanel className="text-sm text-secondary">
              <Move3D className="mr-1.5 inline h-4 w-4 text-amber-500" />
              Drag the origin marker (O to exit)
            </ContextualPanel>
          </div>
        )}

        {buildMode === 'place' && (
          <div className="pointer-events-none absolute left-5 top-20 z-10">
            <ContextualPanel className="text-sm text-secondary">
              Click the floor to place {primitiveLabel(activePrimitive)}
            </ContextualPanel>
          </div>
        )}
      </div>

      <PrecisionDrawer
        open={precisionOpen && Boolean(selectedObject)}
        title="Precision"
        onClose={() => setPrecisionOpen(false)}
      >
        {selectedObject && (
          <div className="space-y-4">
            <PrecisionControls
              object={selectedObject}
              onChange={(updates) => updateObject(selectedObject.id, updates)}
            />
            {grayboxAsset && grayboxPano && (
              <button
                type="button"
                onClick={() => void downloadPanoImage(
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
                )}
                disabled={isRenderingGraybox}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-subtle px-3 py-2 text-sm text-secondary transition hover:border-accent hover:text-accent"
              >
                <FileDown className="h-4 w-4" />
                Download Graybox PNG
              </button>
            )}
          </div>
        )}
      </PrecisionDrawer>
    </FullBleedLayout>
  );
}

function BuildObjectTray({
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
  const [toolsOpen, setToolsOpen] = useState(false);

  return (
    <div className="pointer-events-none absolute bottom-6 left-6 z-10 max-w-[calc(100%-2rem)]">
      {toolsOpen && (
        <div className="pointer-events-auto mb-2 w-72 rounded-[var(--radius-card)] border border-subtle bg-surface-overlay p-3 shadow-soft backdrop-blur">
          <div className="mb-2 grid grid-cols-3 gap-2">
            <TrayButton active={buildMode === 'select'} label="Select" compact onClick={() => onModeChange('select')}>
              <Move3D className="h-4 w-4" />
            </TrayButton>
            <TrayButton active={buildMode === 'pano_origin'} label="Origin" compact onClick={() => onModeChange('pano_origin')}>
              <Grid3X3 className="h-4 w-4" />
            </TrayButton>
            <TrayButton active={gridSnap} label="Snap" compact onClick={() => onGridSnapChange(!gridSnap)}>
              <Grid3X3 className="h-4 w-4" />
            </TrayButton>
          </div>
          <div className="grid grid-cols-2 gap-2 border-t border-subtle pt-2">
            {overflowTrayItems.map(({ type, label, icon: Icon }) => (
              <div key={type}>
                <TrayButton
                  active={buildMode === 'place' && activePrimitive === type}
                  label={label}
                  compact
                  onClick={() => onPrimitiveChange(type)}
                >
                  <Icon className="h-4 w-4" />
                </TrayButton>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="pointer-events-auto rounded-[22px] border border-subtle bg-surface-overlay px-3 py-2.5 shadow-[var(--tray-glow)] backdrop-blur dark:border-[var(--accent)]/25">
        <div className="flex items-center gap-1">
          {primaryTrayItems.map(({ type, label, icon: Icon }) => (
            <div key={type}>
              <TrayButton
                active={buildMode === 'place' && activePrimitive === type}
                label={label}
                onClick={() => onPrimitiveChange(type)}
              >
                <Icon className="h-5 w-5" />
              </TrayButton>
            </div>
          ))}
          <TrayButton active={toolsOpen} label="More" onClick={() => setToolsOpen((open) => !open)}>
            <Wrench className="h-5 w-5" />
          </TrayButton>
        </div>
      </div>
    </div>
  );
}

function TrayButton({
  active,
  label,
  compact,
  children,
  onClick,
}: {
  active?: boolean;
  label: string;
  compact?: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex shrink-0 flex-col items-center gap-1 rounded-xl px-2 py-1.5 transition ${
        compact ? 'w-full' : 'w-16'
      } ${
        active ? 'bg-accent-soft text-accent' : 'text-secondary hover:bg-surface-muted hover:text-primary'
      }`}
    >
      {children}
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  );
}

function QuickAction({
  children,
  title,
  danger,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-lg border transition ${
        danger
          ? 'border-red-200 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400'
          : 'border-subtle text-secondary hover:border-accent hover:text-accent'
      }`}
    >
      {children}
    </button>
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

function normalizeDegrees(value: number) {
  return ((value % 360) + 360) % 360;
}

function blurActiveElement() {
  const active = document.activeElement;
  if (active instanceof HTMLElement) active.blur();
}

function primitiveLabel(type: SceneObjectType) {
  const tray = trayItems.find((item) => item.type === type);
  return tray?.label ?? objectDisplayName(type);
}
