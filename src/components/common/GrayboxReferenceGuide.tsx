import React, { useEffect, useMemo, useState } from 'react';
import { Check, Copy, FileDown } from 'lucide-react';
import { LocationProject, PanoReference, ProjectAsset } from '../../domain/types';
import { STYLED_PANO } from '../../domain/copy';
import { generateGrayboxReferencePrompt } from '../../engine/prompts';
import { Field, IconButton, TextArea } from './Field';
import { StyledPanoImportButton } from './StyledPanoImportButton';

const STEPS = [
  'Download the graybox image.',
  'Write your scene idea.',
  'Copy the prompt and paste it into your image AI. Attach the graybox image.',
  `Import the finished ${STYLED_PANO.short}.`,
] as const;

export function GrayboxStylingTools({
  project,
  grayboxAsset,
  onCreativeBriefChange,
  onDownloadGraybox,
  isDownloading,
  showImport = false,
}: {
  project: LocationProject;
  grayboxAsset?: ProjectAsset;
  onCreativeBriefChange: (value: string) => void;
  onDownloadGraybox: () => void;
  isDownloading?: boolean;
  showImport?: boolean;
}) {
  const [brief, setBrief] = useState(project.description);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setBrief(project.description);
  }, [project.id]);

  const prompt = useMemo(() => generateGrayboxReferencePrompt(brief), [brief]);

  const copyPrompt = async () => {
    onCreativeBriefChange(brief);
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const saveBrief = () => {
    if (brief !== project.description) {
      onCreativeBriefChange(brief);
    }
  };

  const exportLabel = project.settings.panoLetterboxExports169
    ? '16:9 graybox'
    : 'graybox PNG';

  return (
    <div className="space-y-5">
      <Field
        label="Your scene idea"
        hint="Describe the look you want: style, time of day, materials, and mood."
      >
        <TextArea
          value={brief}
          onChange={(event) => setBrief(event.target.value)}
          onBlur={saveBrief}
          placeholder="Example: Old desert temple at sunset, warm stone, dusty air, sparse plants..."
          className="min-h-28 text-[15px] leading-relaxed"
        />
      </Field>

      <Field
        label="Prompt for your image AI"
        hint="Copy this whole block into your image AI along with the graybox file."
      >
        <TextArea
          readOnly
          value={prompt}
          className="min-h-52 bg-zinc-50 font-mono text-[13px] leading-relaxed text-zinc-700"
        />
      </Field>

      <div className={`grid grid-cols-1 gap-3 ${showImport ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
        <IconButton onClick={() => void copyPrompt()} className="w-full">
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? 'Copied' : 'Copy prompt'}
        </IconButton>
        <IconButton
          onClick={onDownloadGraybox}
          disabled={!grayboxAsset || isDownloading}
          className="w-full"
        >
          <FileDown className="h-4 w-4" />
          {isDownloading ? 'Downloading...' : `Download ${exportLabel}`}
        </IconButton>
        {showImport && <StyledPanoImportButton primary />}
      </div>
    </div>
  );
}

export function GrayboxReferencePromptBuilder({
  project,
  grayboxPano: _grayboxPano,
  grayboxAsset,
  onCreativeBriefChange,
  onDownloadGraybox,
  isDownloading,
}: {
  project: LocationProject;
  grayboxPano: PanoReference;
  grayboxAsset?: ProjectAsset;
  onCreativeBriefChange: (value: string) => void;
  onDownloadGraybox: () => void;
  isDownloading?: boolean;
}) {
  return (
    <div className="space-y-6">
      <p className="text-[15px] leading-relaxed text-zinc-700">
        Turn the graybox into a finished 360 pano using any image AI you like.
      </p>

      <ol className="space-y-3">
        {STEPS.map((step, index) => (
          <li key={step} className="flex gap-3 text-[15px] leading-snug text-zinc-800">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-100 text-xs font-semibold text-teal-800">
              {index + 1}
            </span>
            <span className="pt-0.5">{step}</span>
          </li>
        ))}
      </ol>

      <div className="border-t border-zinc-100 pt-5">
        <GrayboxStylingTools
          project={project}
          grayboxAsset={grayboxAsset}
          onCreativeBriefChange={onCreativeBriefChange}
          onDownloadGraybox={onDownloadGraybox}
          isDownloading={isDownloading}
        />
      </div>
    </div>
  );
}

export function AlignmentRetryContent({
  project,
  grayboxAsset,
  onCreativeBriefChange,
  onDownloadGraybox,
  isDownloading,
}: {
  project: LocationProject;
  grayboxAsset?: ProjectAsset;
  onCreativeBriefChange: (value: string) => void;
  onDownloadGraybox: () => void;
  isDownloading?: boolean;
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <p className="text-[15px] font-medium text-zinc-900">
          Yaw only fixes rotation. If the scene shape still feels wrong, generate again.
        </p>
        <ul className="list-disc space-y-2 pl-5 text-[15px] text-zinc-700">
          <li>Try a few more generations. One bad result can just be bad luck.</li>
          <li>Use the graybox as your main image. One other reference is usually fine — but the more you add, the easier it is to confuse the model.</li>
          <li>Use the strongest image model you have.</li>
          <li>Set aspect ratio to 2:1 if you can. 16:9 also works if the pano sits in the middle band.</li>
          <li>Use high resolution. 360 panos hold a lot of detail — 4K or higher is best.</li>
        </ul>
      </div>

      <div className="border-t border-zinc-100 pt-5">
        <p className="mb-4 text-[15px] text-zinc-700">
          Then copy the prompt, run your image AI, and import the new {STYLED_PANO.short}.
        </p>
        <GrayboxStylingTools
          project={project}
          grayboxAsset={grayboxAsset}
          onCreativeBriefChange={onCreativeBriefChange}
          onDownloadGraybox={onDownloadGraybox}
          isDownloading={isDownloading}
          showImport
        />
      </div>
    </div>
  );
}