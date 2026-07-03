import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import { PanoReference } from '../../domain/types';
import { Field, IconButton, TextInput } from './Field';

export function ReferenceAlignmentPanel({
  activePano,
  compareOpacity,
  onYawChange,
  onOpacityChange,
  onAcceptAlignment,
  onShowRetryTips,
  alignmentAccepted,
  highlightNextStep = false,
}: {
  activePano: PanoReference;
  compareOpacity: number;
  onYawChange: (yawDegrees: number) => void;
  onOpacityChange: (opacity: number) => void;
  onAcceptAlignment: () => void;
  onShowRetryTips: () => void;
  alignmentAccepted: boolean;
  highlightNextStep?: boolean;
}) {
  const yaw = normalizeSignedYaw(activePano.rotation[1]);
  const shellClass = highlightNextStep
    ? 'space-y-4 rounded-lg border-2 border-emerald-400 bg-emerald-50/80 p-3 shadow-[0_0_0_3px_rgba(16,185,129,0.12)]'
    : 'space-y-4 rounded-md border border-teal-200 bg-teal-50/50 p-3';

  return (
    <div className={shellClass}>
      {highlightNextStep && (
        <span className="inline-flex rounded-full bg-emerald-600 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
          Next step
        </span>
      )}
      <div>
        <h3 className="text-sm font-semibold text-teal-950">Check pano alignment</h3>
        <p className="mt-1 text-sm leading-relaxed text-teal-900">
          Does the styled pano line up with the 3D scene well enough? Lower opacity to see the graybox underneath.
        </p>
      </div>

      <ol className="space-y-2 text-sm text-teal-950">
        <li className="flex gap-2"><span className="font-semibold">1.</span><span>Look around the pano viewer.</span></li>
        <li className="flex gap-2"><span className="font-semibold">2.</span><span>Slide opacity down to compare with the graybox.</span></li>
        <li className="flex gap-2"><span className="font-semibold">3.</span><span>Rotate yaw until walls and landmarks match.</span></li>
        <li className="flex gap-2"><span className="font-semibold">4.</span><span>Say if it is good enough or if you need to retry.</span></li>
      </ol>

      <Field label="Yaw" hint="Spin the styled pano left or right to line it up.">
        <TextInput
          type="number"
          step="1"
          value={yaw}
          onChange={(event) => onYawChange(Number(event.target.value))}
        />
      </Field>
      <input
        type="range"
        min="-180"
        max="180"
        step="1"
        value={yaw}
        onChange={(event) => onYawChange(Number(event.target.value))}
        className="w-full accent-teal-500"
      />
      <div className="grid grid-cols-3 gap-2">
        {[-5, 5].map((delta) => (
          <IconButton key={delta} onClick={() => onYawChange(yaw + delta)} className="px-2">
            {delta > 0 ? '+' : ''}{delta}°
          </IconButton>
        ))}
        <IconButton onClick={() => onYawChange(0)} className="px-2">
          Reset
        </IconButton>
      </div>

      <Field label="Graybox fade" hint="Lower this to see the graybox under the styled pano.">
        <TextInput
          type="number"
          step="5"
          min="0"
          max="100"
          value={Math.round(compareOpacity * 100)}
          onChange={(event) => onOpacityChange(clamp01(Number(event.target.value) / 100))}
        />
      </Field>
      <input
        type="range"
        min="0"
        max="100"
        step="1"
        value={Math.round(compareOpacity * 100)}
        onChange={(event) => onOpacityChange(clamp01(Number(event.target.value) / 100))}
        className="w-full accent-teal-500"
      />

      {alignmentAccepted ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Alignment confirmed. You can move on to Shots.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-2">
          <IconButton
            onClick={onAcceptAlignment}
            highlighted={highlightNextStep}
            className={`w-full ${highlightNextStep ? '' : 'border-teal-500 bg-teal-500 text-white hover:bg-teal-600'}`}
          >
            <CheckCircle2 className="h-4 w-4" />
            Looks good enough
          </IconButton>
          <IconButton onClick={onShowRetryTips} className="w-full">
            Still misaligned — try again
          </IconButton>
        </div>
      )}
    </div>
  );
}

function normalizeSignedYaw(value: number) {
  return ((((value + 180) % 360) + 360) % 360) - 180;
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(1, value));
}