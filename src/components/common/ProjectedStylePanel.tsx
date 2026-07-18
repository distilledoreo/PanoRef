import React, { useCallback } from 'react';
import { LocationProject, ProjectedStyleSettings, ProjectionControlPair } from '../../domain/types';
import {
  createProjectionAlignment,
  createProjectionControlPair,
  findProjectionAlignmentForPano,
  normalizeProjectedStyleSettings,
  setProjectionAlignmentForPano,
} from '../../domain/defaults';
import {
  listEligibleProjectedStylePanos,
  projectedStyleStatusLabel,
  resolveProjectedStylePano,
} from '../../engine/projectedStyle';
import {
  PROJECTOR_BLEND_MODE_LABELS,
  type ProjectorBlendMode,
  canUseDualProjectorBlend,
  resolveProjectors,
} from '../../engine/multiOriginProjection';
import { Field, IconButton, Select, TextInput } from './Field';

const BLEND_OPTIONS: ProjectorBlendMode[] = [
  'primary_only',
  'secondary_only',
  'primary_dominant',
  'secondary_dominant',
];

export function ProjectedStylePanel({
  project,
  onChange,
}: {
  project: LocationProject;
  onChange: (settings: ProjectedStyleSettings) => void;
}) {
  const settings = normalizeProjectedStyleSettings(project.settings.projectedStyle);
  const eligible = listEligibleProjectedStylePanos(project);
  const allPanos = project.panoRefs;
  const status = projectedStyleStatusLabel(project);
  const active = resolveProjectedStylePano(project);
  const resolved = resolveProjectors(project, settings);
  const dualAvailable = allPanos.length >= 2;
  const dualReady = canUseDualProjectorBlend(project, settings);

  const update = (partial: Partial<ProjectedStyleSettings>) => {
    onChange(normalizeProjectedStyleSettings({ ...settings, ...partial }));
  };

  const secondaryCandidates = allPanos.filter((pano) => pano.id !== (settings.panoId ?? active?.id));

  return (
    <div className="space-y-3" data-projected-style-panel>
      <div>
        <h3 className="text-sm font-semibold text-primary">Projected Style</h3>
        <p className="mt-1 text-xs leading-relaxed text-secondary">
          Projected appearance is most accurate near each panorama&apos;s own origin. Moving the
          capture origin after a reference pano is loaded does not move that pano — use multiple
          origins and blend modes when you capture from more than one point.
        </p>
      </div>

      <div className="rounded-lg border border-subtle bg-surface-base px-3 py-2 text-xs text-secondary">
        <div>
          <span className="font-semibold text-primary">Primary projector:</span>{' '}
          {status.panoName ?? '—'}
        </div>
        <div className="mt-0.5">
          <span className="font-semibold text-primary">Primary origin:</span> {status.originLabel}
        </div>
        {resolved.secondary && settings.blendMode !== 'primary_only' && (
          <div className="mt-0.5">
            <span className="font-semibold text-primary">Secondary:</span>{' '}
            {resolved.secondary.name}{' '}
            <span className="text-secondary">
              ({resolved.secondary.origin.map((v) => v.toFixed(1)).join(', ')} m)
            </span>
          </div>
        )}
        {status.reason && (
          <p className="mt-1 text-amber-800 dark:text-amber-200">{status.reason}</p>
        )}
      </div>

      <Field label="Primary panorama">
        <Select
          value={settings.panoId ?? active?.id ?? ''}
          onChange={(event) => {
            const value = event.target.value;
            update({ panoId: value || undefined });
          }}
          disabled={allPanos.length === 0}
        >
          <option value="">Auto (canonical styled)</option>
          {allPanos.map((pano) => (
            <option key={pano.id} value={pano.id}>
              {pano.name}
              {pano.type === 'graybox_render' ? ' (graybox)' : ''}
              {pano.isCanonical ? ' · canonical' : ''}
            </option>
          ))}
        </Select>
      </Field>

      {dualAvailable && (
        <>
          <Field
            label="Multi-origin blend"
            hint="Dominant modes fill weak regions of the dominant pano using distance from each origin (not true occlusion)."
          >
            <Select
              value={settings.blendMode ?? 'primary_only'}
              onChange={(event) => {
                update({ blendMode: event.target.value as ProjectorBlendMode });
              }}
              data-projected-blend-mode
            >
              {BLEND_OPTIONS.map((mode) => (
                <option key={mode} value={mode}>
                  {PROJECTOR_BLEND_MODE_LABELS[mode]}
                </option>
              ))}
            </Select>
          </Field>

          {settings.blendMode !== 'primary_only' && (
            <Field label="Secondary panorama">
              <Select
                value={settings.secondaryPanoId ?? resolved.secondary?.id ?? ''}
                onChange={(event) => {
                  const value = event.target.value;
                  update({ secondaryPanoId: value || undefined });
                }}
                disabled={secondaryCandidates.length === 0}
                data-projected-secondary-pano
              >
                <option value="">Auto (next eligible)</option>
                {secondaryCandidates.map((pano) => (
                  <option key={pano.id} value={pano.id}>
                    {pano.name}
                    {pano.isCanonical ? ' · canonical' : ''}
                    {` · ${pano.origin.map((v) => v.toFixed(1)).join(', ')} m`}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {settings.blendMode !== 'primary_only' && !dualReady && (
            <p className="text-xs text-amber-800 dark:text-amber-200">
              Dual blend needs two panoramas with image assets. Import and align a second styled
              panorama from a different capture origin.
            </p>
          )}
        </>
      )}

      {eligible.length === 0 && (
        <p className="text-xs text-secondary">
          Import and align a styled panorama first for best results. Graybox can be selected
          explicitly if needed.
        </p>
      )}

      <Field label={`Opacity (${Math.round(settings.opacity * 100)}%)`}>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(settings.opacity * 100)}
          onChange={(event) => update({ opacity: Number(event.target.value) / 100 })}
          className="w-full accent-[var(--accent)]"
        />
      </Field>

      <Field label="Exposure" hint="0.25–4.0">
        <TextInput
          type="number"
          min={0.25}
          max={4}
          step={0.05}
          value={settings.exposure}
          onChange={(event) => update({ exposure: Number(event.target.value) })}
        />
      </Field>

      <Field label={`Lighting contribution (${Math.round(settings.lightingContribution * 100)}%)`}>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(settings.lightingContribution * 100)}
          onChange={(event) => update({ lightingContribution: Number(event.target.value) / 100 })}
          className="w-full accent-[var(--accent)]"
        />
      </Field>

      <Field label="Unsupported-area fallback">
        <Select
          value={settings.fallbackMode}
          onChange={(event) => update({
            fallbackMode: event.target.value === 'neutral' ? 'neutral' : 'clay',
          })}
        >
          <option value="clay">Clay</option>
          <option value="neutral">Neutral</option>
        </Select>
      </Field>

      {import.meta.env.DEV && (
        <AlignmentSection
          settings={settings}
          primaryPanoId={active?.id}
          onSettingsChange={onChange}
        />
      )}
    </div>
  );
}

function AlignmentSection({
  settings,
  primaryPanoId,
  onSettingsChange,
}: {
  settings: ProjectedStyleSettings;
  primaryPanoId?: string;
  onSettingsChange: (settings: ProjectedStyleSettings) => void;
}) {
  const [expanded, setExpanded] = React.useState(false);

  const alignment = primaryPanoId
    ? findProjectionAlignmentForPano(settings, primaryPanoId)
    : undefined;

  const updateAlignment = useCallback(
    (updateFn: (current: ProjectionControlPair[]) => ProjectionControlPair[]) => {
      if (!primaryPanoId) return;
      const current = alignment?.pairs ?? [];
      const next = updateFn(current.map((p) => ({ ...p })));
      const updatedAlignment = createProjectionAlignment(primaryPanoId, primaryPanoId, next);
      onSettingsChange(setProjectionAlignmentForPano(settings, primaryPanoId, updatedAlignment));
    },
    [alignment, primaryPanoId, onSettingsChange, settings],
  );

  const addPair = useCallback(() => {
    const nextOrder = (alignment?.pairs ?? []).length;
    const newPair = createProjectionControlPair({
      order: nextOrder,
      targetUv: [0.5, 0.5],
      sourceUv: [0.5, 0.5],
    });
    updateAlignment((pairs) => [...pairs, newPair]);
  }, [alignment, updateAlignment]);

  const removePair: (pairId: string) => void = useCallback(
    (pairId: string) => {
      updateAlignment((pairs) => pairs.filter((p) => p.id !== pairId));
    },
    [updateAlignment],
  );

  const updatePair: (pairId: string, partial: Partial<ProjectionControlPair>) => void = useCallback(
    (pairId: string, partial: Partial<ProjectionControlPair>) => {
      updateAlignment((pairs) =>
        pairs.map((p) => (p.id === pairId ? { ...p, ...partial } : p)),
      );
    },
    [updateAlignment],
  );

  const pairs = alignment?.pairs ?? [];
  const markerCount = pairs.filter((p) => p.enabled).length;

  return (
    <div className="border-t border-subtle pt-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between text-xs font-semibold uppercase tracking-wide text-secondary"
      >
        <span>
          Alignment{' '}
          {pairs.length > 0 && (
            <span className="ml-1 font-normal normal-case text-muted">
              ({markerCount} marker{markerCount !== 1 ? 's' : ''})
            </span>
          )}
        </span>
        <span className="text-muted">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="mt-3 space-y-3">
          {pairs.length === 0 ? (
            <p className="text-xs text-muted">
              No alignment markers yet. Add markers to fine-tune the projection warp.
            </p>
          ) : (
            <div className="space-y-2">
              {pairs.map((pair, index) => (
                <div key={pair.id}>
                  <PairRow
                    pair={pair}
                    index={index}
                    onUpdate={updatePair}
                    onRemove={removePair}
                  />
                </div>
              ))}
            </div>
          )}

          <IconButton onClick={addPair} className="w-full">
            + Add marker
          </IconButton>

          {pairs.length > 0 && (
            <p className="text-xs text-muted">
              Target UV is the point on the graybox where the feature appears.
              Source UV is where it should sample from the styled panorama.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function PairRow({
  pair,
  index,
  onUpdate,
  onRemove,
}: {
  pair: ProjectionControlPair;
  index: number;
  onUpdate: (pairId: string, partial: Partial<ProjectionControlPair>) => void;
  onRemove: (pairId: string) => void;
}) {
  return (
    <div className="rounded-lg border border-subtle bg-surface-base px-3 py-2">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-primary">#{index + 1}</span>
          <label className="flex cursor-pointer items-center gap-1">
            <input
              type="checkbox"
              checked={pair.enabled}
              onChange={(event) => onUpdate(pair.id, { enabled: event.target.checked })}
              className="h-3.5 w-3.5 accent-[var(--accent)]"
            />
            <span className="text-xs text-muted">{pair.enabled ? 'On' : 'Off'}</span>
          </label>
        </div>
        <button
          type="button"
          onClick={() => onRemove(pair.id)}
          className="text-xs text-red-500 hover:text-red-600"
          aria-label={`Remove marker ${index + 1}`}
        >
          ✕
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-muted">
            Target U
          </span>
          <TextInput
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={pair.targetUv[0]}
            onChange={(event) =>
              onUpdate(pair.id, {
                targetUv: [Number(event.target.value), pair.targetUv[1]],
              })
            }
            className="!py-1 !text-xs"
          />
        </div>
        <div>
          <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-muted">
            Target V
          </span>
          <TextInput
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={pair.targetUv[1]}
            onChange={(event) =>
              onUpdate(pair.id, {
                targetUv: [pair.targetUv[0], Number(event.target.value)],
              })
            }
            className="!py-1 !text-xs"
          />
        </div>
        <div>
          <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-muted">
            Source U
          </span>
          <TextInput
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={pair.sourceUv[0]}
            onChange={(event) =>
              onUpdate(pair.id, {
                sourceUv: [Number(event.target.value), pair.sourceUv[1]],
              })
            }
            className="!py-1 !text-xs"
          />
        </div>
        <div>
          <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-muted">
            Source V
          </span>
          <TextInput
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={pair.sourceUv[1]}
            onChange={(event) =>
              onUpdate(pair.id, {
                sourceUv: [pair.sourceUv[0], Number(event.target.value)],
              })
            }
            className="!py-1 !text-xs"
          />
        </div>
      </div>
    </div>
  );
}
