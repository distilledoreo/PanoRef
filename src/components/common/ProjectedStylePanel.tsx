import React from 'react';
import { LocationProject, ProjectedStyleSettings } from '../../domain/types';
import {
  listEligibleProjectedStylePanos,
  normalizeProjectedStyleSettings,
  projectedStyleStatusLabel,
  resolveProjectedStylePano,
} from '../../engine/projectedStyle';
import { useContinuityStore } from '../../state/useContinuityStore';
import { Field, Select, TextInput, Toggle } from './Field';

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
  const occlusionStatus = useContinuityStore((state) => state.projectedOcclusionStatus);
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

  const occlusionStatusLabel = {
    disabled: 'Disabled',
    generating: 'Generating…',
    ready: 'Ready',
    failed: 'Unavailable — using legacy projection',
  }[occlusionStatus];

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

      <Field label="Secondary panorama">
        <Select
          value={settings.secondaryPanoId ?? ''}
          onChange={(event) => {
            const value = event.target.value;
            update({ secondaryPanoId: value || undefined });
          }}
          disabled={allPanos.length === 0}
        >
          <option value="">None</option>
          {allPanos
            .filter((pano) => pano.id !== (settings.panoId ?? active?.id))
            .map((pano) => (
              <option key={pano.id} value={pano.id}>
                {pano.name}
                {pano.type === 'graybox_render' ? ' (graybox)' : ''}
              </option>
            ))}
        </Select>
      </Field>

      {settings.secondaryPanoId && (
        <Field label="Blend mode">
          <Select
            value={settings.blendMode ?? 'both'}
            onChange={(event) => update({
              blendMode: event.target.value === 'primary'
                ? 'primary'
                : event.target.value === 'secondary' ? 'secondary' : 'both',
            })}
          >
            <option value="both">Both (nearest fills)</option>
            <option value="primary">Primary only</option>
            <option value="secondary">Secondary only</option>
          </Select>
        </Field>
      )}

      <Field
        label="Geometry occlusion"
        hint="Behaves like a real 360° projector. Surfaces hidden behind other geometry do not receive this panorama."
      >
        <Toggle
          checked={settings.occlusionEnabled ?? true}
          onChange={(value) => update({ occlusionEnabled: value })}
        />
      </Field>

      {settings.occlusionEnabled && (
        <div className="rounded-lg border border-subtle bg-surface-base px-3 py-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-primary">Occlusion status</span>
            <span
              data-occlusion-status={occlusionStatus}
              className={
                occlusionStatus === 'ready' ? 'text-green-700 dark:text-green-300'
                  : occlusionStatus === 'failed' ? 'text-amber-700 dark:text-amber-300'
                    : 'text-secondary'
              }>{occlusionStatusLabel}</span>
          </div>

          <div className="mt-2">
            <Field label="Coverage preview">
              <Toggle
                checked={settings.occlusionDebugMode === 'coverage'}
                onChange={(value) => update({ occlusionDebugMode: value ? 'coverage' : 'off' })}
              />
            </Field>
            <p className="mt-1 text-[11px] leading-snug text-secondary">
              Cyan: visible from primary only · Magenta: secondary only · White: both · Red: neither · Gray: unavailable.
            </p>
          </div>

          <details className="mt-2">
            <summary className="cursor-pointer select-none text-primary">Precision</summary>
            <div className="mt-2 space-y-2">
              <Field label={`Occlusion bias (${settings.occlusionBiasMeters?.toFixed(3)} m)`}>
                <input
                  type="range"
                  min={0}
                  max={0.5}
                  step={0.005}
                  value={settings.occlusionBiasMeters ?? 0.04}
                  onChange={(event) => update({ occlusionBiasMeters: Number(event.target.value) })}
                  className="w-full accent-[var(--accent)]"
                />
              </Field>
              <Field label={`Edge softness (${settings.occlusionSoftness?.toFixed(2)})`}>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.05}
                  value={settings.occlusionSoftness ?? 1}
                  onChange={(event) => update({ occlusionSoftness: Number(event.target.value) })}
                  className="w-full accent-[var(--accent)]"
                />
              </Field>
              <button
                type="button"
                className="text-[11px] text-accent underline"
                onClick={() => update({ occlusionBiasMeters: 0.04, occlusionSoftness: 1 })}
              >
                Reset precision
              </button>
            </div>
          </details>
        </div>
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
