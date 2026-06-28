import React from 'react';
import { Box, Camera, Download, FileDown, Trash2 } from 'lucide-react';
import { SceneObjectType } from '../../domain/types';
import { objectDisplayName } from '../../domain/defaults';
import { getLatestGrayboxPano, getPanoAsset } from '../../domain/selectors';
import { downloadDataUrl } from '../../engine/projectIO';
import { useContinuityStore } from '../../state/useContinuityStore';
import { Field, IconButton, Panel, Select, TextInput } from '../common/Field';
import { Vec3Input } from '../common/Vec3Input';
import { SceneViewport } from '../viewers/SceneViewport';

const primitiveTypes: SceneObjectType[] = [
  'floor',
  'wall',
  'box',
  'arch',
  'doorway',
  'column',
  'stairs',
  'tree_blob',
  'terrain_mass',
  'background_card',
  'human_dummy',
  'sun_marker',
];

export function BuildWorkspace() {
  const {
    project,
    selectedObjectId,
    addObject,
    selectObject,
    updateObject,
    removeObject,
    setPanoOrigin,
    renderGrayboxPano,
    isRenderingGraybox,
  } = useContinuityStore();
  const selectedObject = project.scene.objects.find((object) => object.id === selectedObjectId);
  const grayboxPano = getLatestGrayboxPano(project);
  const grayboxAsset = getPanoAsset(project, grayboxPano);

  return (
    <WorkspaceLayout
      sidebar={(
        <>
          <Panel title="Primitive Kit">
            <div className="grid grid-cols-2 gap-2">
              {primitiveTypes.map((type) => (
                <IconButton key={type} onClick={() => addObject(type)} title={`Add ${objectDisplayName(type)}`}>
                  <Box className="h-4 w-4" />
                  <span className="truncate">{objectDisplayName(type)}</span>
                </IconButton>
              ))}
            </div>
          </Panel>

          <Panel title="Scene Objects">
            <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
              {project.scene.objects.map((object) => (
                <button
                  key={object.id}
                  onClick={() => selectObject(object.id)}
                  className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition ${
                    selectedObjectId === object.id
                      ? 'border-cyan-400 bg-cyan-950/60 text-cyan-100'
                      : 'border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-600'
                  }`}
                >
                  <span className="truncate">{object.name}</span>
                  <span className="text-xs text-slate-500">{object.type}</span>
                </button>
              ))}
            </div>
          </Panel>

          <Panel title="Pano Origin">
            <div className="space-y-3">
              <Field label="Origin Position" hint="The 360 graybox pano renders from this point.">
                <Vec3Input value={project.scene.panoOrigin} onChange={setPanoOrigin} />
              </Field>
              <IconButton onClick={() => void renderGrayboxPano()} disabled={isRenderingGraybox} className="w-full">
                <Download className="h-4 w-4" />
                {isRenderingGraybox ? 'Rendering 360 Pano...' : 'Render Graybox 360'}
              </IconButton>
              <IconButton
                onClick={() => grayboxAsset && downloadDataUrl(grayboxAsset.uri, grayboxAsset.name || 'global_graybox.png')}
                disabled={!grayboxAsset || isRenderingGraybox}
                className="w-full"
              >
                <FileDown className="h-4 w-4" />
                Download Graybox PNG
              </IconButton>
              {grayboxPano && (
                <p className="rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-400">
                  Latest graybox: {grayboxPano.width}x{grayboxPano.height} equirectangular PNG
                </p>
              )}
            </div>
          </Panel>

          {selectedObject && (
            <Panel
              title="Inspector"
              actions={(
                <button
                  className="rounded-md p-1.5 text-slate-400 hover:bg-red-950 hover:text-red-300"
                  onClick={() => removeObject(selectedObject.id)}
                  title="Delete selected object"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            >
              <div className="space-y-3">
                <Field label="Name">
                  <TextInput
                    value={selectedObject.name}
                    onChange={(event) => updateObject(selectedObject.id, { name: event.target.value })}
                  />
                </Field>
                <Field label="Type">
                  <Select
                    value={selectedObject.type}
                    onChange={(event) => updateObject(selectedObject.id, { type: event.target.value as SceneObjectType })}
                  >
                    {primitiveTypes.map((type) => <option key={type} value={type}>{objectDisplayName(type)}</option>)}
                  </Select>
                </Field>
                <Field label="Position">
                  <Vec3Input
                    value={selectedObject.transform.position}
                    onChange={(position) => updateObject(selectedObject.id, {
                      transform: { ...selectedObject.transform, position },
                    })}
                  />
                </Field>
                <Field label="Rotation Degrees">
                  <Vec3Input
                    value={selectedObject.transform.rotation}
                    step={1}
                    onChange={(rotation) => updateObject(selectedObject.id, {
                      transform: { ...selectedObject.transform, rotation },
                    })}
                  />
                </Field>
                <Field label="Dimensions">
                  <Vec3Input
                    value={selectedObject.dimensions}
                    onChange={(dimensions) => updateObject(selectedObject.id, { dimensions })}
                  />
                </Field>
              </div>
            </Panel>
          )}
        </>
      )}
    >
      <SceneViewport project={project} selectedObjectId={selectedObjectId} onSelectObject={selectObject} />
      <div className="border-t border-slate-800 bg-slate-950 px-5 py-3 text-sm text-slate-400">
        <Camera className="mr-2 inline h-4 w-4 text-cyan-300" />
        Build a primitive set, place the pano origin, then render the graybox 360 reference.
      </div>
    </WorkspaceLayout>
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
    <div className="grid h-full min-h-0 grid-cols-[360px_minmax(0,1fr)]">
      <aside className="min-h-0 overflow-y-auto border-r border-slate-800 bg-slate-950">{sidebar}</aside>
      <main className="min-h-0 overflow-hidden bg-slate-950">{children}</main>
    </div>
  );
}
