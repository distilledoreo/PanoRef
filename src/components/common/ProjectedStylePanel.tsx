import React from 'react';
import { LocationProject, ProjectedStyleSettings } from '../../domain/types';
import {
  normalizeProjectedStyleSettings,
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
import { Field, Select, TextInput } from './Field';

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

    </div>
  );
}
