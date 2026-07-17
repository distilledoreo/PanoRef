import React from 'react';
import { LocationProject, ProjectedStyleSettings } from '../../domain/types';
import {
  findProjectionAlignmentForPano,
  listEligibleProjectedStylePanos,
  normalizeProjectedStyleSettings,
  projectedStyleStatusLabel,
  projectionAlignmentStatusForPano,
  resolveProjectedStylePano,
} from '../../engine/projectedStyle';
import { Field, Select, TextInput } from './Field';

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

  const currentAlignment = active ? findProjectionAlignmentForPano(settings, active.id) : undefined;
  const alignmentStatus = active && currentAlignment
    ? projectionAlignmentStatusForPano(project, active.id)
    : undefined;

  const update = (partial: Partial<ProjectedStyleSettings>) => {
    onChange(normalizeProjectedStyleSettings({ ...settings, ...partial }));
  };

  return (
    <div className="space-y-3" data-projected-style-panel>
      <div>
        <h3 className="text-sm font-semibold text-primary">Projected Style</h3>
        <p className="mt-1 text-xs leading-relaxed text-secondary">
          Projected appearance is most accurate near the panorama origin. Moving away may reveal
          stretching or duplicated imagery around occlusions.
        </p>
      </div>

      <div className="rounded-lg border border-subtle bg-surface-base px-3 py-2 text-xs text-secondary">
        <div>
          <span className="font-semibold text-primary">Projected from:</span>{' '}
          {status.panoName ?? '—'}
        </div>
        <div className="mt-0.5">
          <span className="font-semibold text-primary">Origin:</span> {status.originLabel}
        </div>
        {status.reason && (
          <p className="mt-1 text-amber-800 dark:text-amber-200">{status.reason}</p>
        )}
      </div>

      <Field label="Panorama">
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

      {currentAlignment && alignmentStatus && (
        <div className="rounded-lg border border-subtle bg-surface-base px-3 py-2 text-xs text-secondary">
          <div className="flex items-center gap-2">
            <span className={`font-semibold ${
              alignmentStatus.state === 'valid' ? 'text-green-600 dark:text-green-400' :
              alignmentStatus.state === 'stale' ? 'text-amber-600 dark:text-amber-400' :
              'text-primary'
            }`}>
              Projection Assist
            </span>
            <span className="text-muted">·</span>
            <span>{alignmentStatus.message}</span>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-muted">{alignmentStatus.enabledPairCount} active pair{alignmentStatus.enabledPairCount !== 1 ? 's' : ''}</span>
          </div>
        </div>
      )}

      {currentAlignment && (
        <>
          <Field label={`Strength (${Math.round((currentAlignment.strength ?? 1) * 100)}%)`}>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round((currentAlignment.strength ?? 1) * 100)}
              onChange={(event) => {
                const strength = Number(event.target.value) / 100;
                onChange(normalizeProjectedStyleSettings({
                  ...settings,
                  alignments: settings.alignments?.map((a) =>
                    a.sourcePanoId === active?.id ? { ...a, strength } : a
                  ),
                }));
              }}
              className="w-full accent-[var(--accent)]"
            />
          </Field>

          <button
            type="button"
            onClick={() => {
              if (!window.confirm('Remove the local fit for this panorama?')) return;
              onChange(normalizeProjectedStyleSettings({
                ...settings,
                alignments: settings.alignments?.filter((a) => a.sourcePanoId !== active?.id),
              }));
            }}
            className="w-full rounded-lg border border-red-200 px-3 py-2 text-xs font-medium text-red-600 transition hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/40"
          >
            Remove local fit
          </button>
        </>
      )}
    </div>
  );
}
