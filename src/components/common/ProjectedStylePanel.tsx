import React, { useEffect, useMemo, useState } from 'react';
import { LocationProject, PanoReference, ProjectedStyleSettings, ProjectionAlignment } from '../../domain/types';
import {
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
import {
  projectionAlignmentDiagnosticsForAlignment,
  projectionAlignmentDiagnosticsKey,
  type ProjectionAlignmentDiagnostics,
} from '../../engine/projectionAlignmentDiagnostics';
import {
  projectionAlignmentStatusForAlignment,
  type ProjectionAlignmentStatus,
} from '../../engine/projectionAlignmentStatus';
import { ProjectionAlignmentEditor } from '../reference/ProjectionAlignmentEditor';
import { Field, Select, TextInput } from './Field';

const BLEND_OPTIONS: ProjectorBlendMode[] = [
  'primary_only',
  'secondary_only',
  'primary_dominant',
  'secondary_dominant',
];

function safeConfirm(message: string): boolean {
  return typeof window === 'undefined' || window.confirm(message);
}

function alignmentActionLabel(status: ProjectionAlignmentStatus): string {
  if (status.state === 'none') return 'Fix local mismatches';
  if (status.state === 'stale') return 'Repair local fit';
  if (status.state === 'conflicting' || status.state === 'error') return 'Review matches';
  return 'Edit local fit';
}

function alignmentStatusClass(status: ProjectionAlignmentStatus): string {
  if (status.state === 'ready') return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200';
  if (status.state === 'none') return 'bg-surface-base text-secondary';
  return 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200';
}

function ProjectorAlignmentCard({
  project,
  pano,
  role,
  alignment,
  onEdit,
  onStrengthChange,
  onRemove,
}: {
  project: LocationProject;
  pano: PanoReference;
  role: 'Primary' | 'Secondary';
  alignment?: ProjectionAlignment;
  onEdit: () => void;
  onStrengthChange: (strength: number) => void;
  onRemove: () => void;
}) {
  const diagnosticsKey = useMemo(
    () => projectionAlignmentDiagnosticsKey(project, pano.id, alignment),
    [project, pano.id, alignment],
  );
  const [diagnosticsState, setDiagnosticsState] = useState<{
    key: string;
    value?: ProjectionAlignmentDiagnostics;
  }>({ key: '' });
  const diagnostics = diagnosticsState.key === diagnosticsKey ? diagnosticsState.value : undefined;

  useEffect(() => {
    let cancelled = false;
    if (!alignment) {
      setDiagnosticsState({ key: diagnosticsKey });
      return () => {
        cancelled = true;
      };
    }

    const value = projectionAlignmentDiagnosticsForAlignment(project, alignment);
    if (!cancelled) setDiagnosticsState({ key: diagnosticsKey, value });
    return () => {
      cancelled = true;
    };
  }, [diagnosticsKey]);

  const status = useMemo(
    () => alignment
      ? projectionAlignmentStatusForAlignment(project, pano.id, alignment, diagnostics)
      : {
          state: 'none' as const,
          pairCount: 0,
          enabledPairCount: 0,
          conflictCount: 0,
          message: 'No local fit',
        },
    [project, pano.id, alignment, diagnostics],
  );
  const hasAsset = Boolean(project.assets.assets[pano.imageAssetId]?.uri);
  const canEdit = pano.type !== 'graybox_render' && hasAsset;
  const strengthPercent = Math.round((alignment?.strength ?? 1) * 100);
  const statusLabel = status.state === 'conflicting' ? 'Some matches conflict' : status.message;

  return (
    <section
      className="rounded-lg border border-subtle bg-surface-base p-3"
      data-projection-alignment-card={pano.id}
      data-projector-role={role.toLowerCase()}
    >
      <div className="flex items-start gap-3">
        <div className="mr-auto min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-secondary">{role} local fit</div>
          <h4 className="mt-0.5 truncate text-sm font-semibold text-primary">{pano.name}</h4>
          <p className="mt-0.5 text-[11px] text-secondary">
            Capture origin: {pano.origin.map((value) => value.toFixed(1)).join(', ')} m
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold ${alignmentStatusClass(status)}`}
          data-projection-alignment-status={status.state}
        >
          {statusLabel}
        </span>
      </div>

      {alignment && (
        <Field label={`Local fit strength (${strengthPercent}%)`}>
          <input
            type="range"
            min={0}
            max={100}
            value={strengthPercent}
            onChange={(event) => onStrengthChange(Number(event.target.value) / 100)}
            className="w-full accent-[var(--accent)]"
            aria-label={`${role} local fit strength`}
          />
        </Field>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onEdit}
          disabled={!canEdit}
          className="inline-flex min-h-10 items-center justify-center rounded-lg border border-subtle px-3 py-2 text-xs font-semibold text-primary transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
          data-projection-alignment-edit={pano.id}
        >
          {canEdit ? alignmentActionLabel(status) : 'Needs an image asset'}
        </button>
        {alignment && (
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex min-h-10 items-center justify-center rounded-lg px-3 py-2 text-xs font-medium text-secondary transition hover:text-red-600"
            data-projection-alignment-remove={pano.id}
          >
            Remove local fit
          </button>
        )}
      </div>
    </section>
  );
}

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
  const [editorSourcePanoId, setEditorSourcePanoId] = useState<string>();

  const update = (partial: Partial<ProjectedStyleSettings>) => {
    onChange(normalizeProjectedStyleSettings({ ...settings, ...partial }));
  };

  const secondaryCandidates = allPanos.filter((pano) => pano.id !== (settings.panoId ?? active?.id));
  const primaryAlignment = resolved.primary
    ? findProjectionAlignmentForPano(settings, resolved.primary.id)
    : undefined;
  const secondaryAlignment = resolved.secondary
    ? findProjectionAlignmentForPano(settings, resolved.secondary.id)
    : undefined;
  const secondaryActive = Boolean(resolved.secondary && resolved.blendMode !== 'primary_only');

  const openAlignmentEditor = (sourcePanoId: string) => setEditorSourcePanoId(sourcePanoId);
  const applyAlignment = (sourcePanoId: string, alignment: ProjectionAlignment | undefined) => {
    const nextSettings = setProjectionAlignmentForPano(settings, sourcePanoId, alignment);
    onChange(nextSettings);
    setEditorSourcePanoId(undefined);
  };
  const changeAlignmentStrength = (sourcePanoId: string, strength: number) => {
    const alignment = findProjectionAlignmentForPano(settings, sourcePanoId);
    if (!alignment) return;
    applyAlignment(sourcePanoId, { ...alignment, strength });
  };
  const removeAlignment = (pano: PanoReference) => {
    if (!safeConfirm(`Remove local matches for ${pano.name}?`)) return;
    applyAlignment(pano.id, undefined);
  };

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

      {(resolved.primary || secondaryActive) && (
        <section className="space-y-2" aria-label="Projection Assist local fits">
          <div>
            <h4 className="text-sm font-semibold text-primary">Projection Assist</h4>
            <p className="mt-1 text-xs leading-relaxed text-secondary">
              Match each projector to the graybox it should follow. Fits belong to their source panorama and stay independent when you switch or blend projectors.
            </p>
          </div>
          {resolved.primary && (
            <ProjectorAlignmentCard
              project={project}
              pano={resolved.primary}
              role="Primary"
              alignment={primaryAlignment}
              onEdit={() => openAlignmentEditor(resolved.primary!.id)}
              onStrengthChange={(strength) => changeAlignmentStrength(resolved.primary!.id, strength)}
              onRemove={() => removeAlignment(resolved.primary!)}
            />
          )}
          {secondaryActive && resolved.secondary && (
            <ProjectorAlignmentCard
              project={project}
              pano={resolved.secondary}
              role="Secondary"
              alignment={secondaryAlignment}
              onEdit={() => openAlignmentEditor(resolved.secondary!.id)}
              onStrengthChange={(strength) => changeAlignmentStrength(resolved.secondary!.id, strength)}
              onRemove={() => removeAlignment(resolved.secondary!)}
            />
          )}
        </section>
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

      <ProjectionAlignmentEditor
        open={Boolean(editorSourcePanoId)}
        project={project}
        initialSourcePanoId={editorSourcePanoId ?? ''}
        onApply={applyAlignment}
        onClose={() => setEditorSourcePanoId(undefined)}
      />

    </div>
  );
}
