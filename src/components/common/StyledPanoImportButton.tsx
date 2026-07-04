import React, { useRef } from 'react';
import { ImagePlus } from 'lucide-react';
import { STYLED_PANO } from '../../domain/copy';
import { preparePanoImport } from '../../engine/panoImage';
import { readFileAsDataUrl } from '../../engine/projectIO';
import { useContinuityStore } from '../../state/useContinuityStore';
import { IconButton } from './Field';

export function StyledPanoImportButton({
  label = STYLED_PANO.importAction,
  className,
  primary = false,
  highlighted = false,
}: {
  label?: string;
  className?: string;
  primary?: boolean;
  highlighted?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const importCanonicalPano = useContinuityStore((state) => state.importCanonicalPano);

  const importFile = async (file?: File) => {
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    const dimensions = await getImageDimensions(dataUrl);
    const prepared = await preparePanoImport(dataUrl, dimensions.width, dimensions.height);
    importCanonicalPano({
      name: file.name,
      dataUrl: prepared.dataUrl,
      width: prepared.width,
      height: prepared.height,
      importNote: prepared.analysis.wasLetterboxed
        ? `Imported from ${dimensions.width}×${dimensions.height} letterboxed 16:9; extracted ${prepared.width}×${prepared.height} equirectangular region.`
        : undefined,
    });
  };

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(event) => void importFile(event.target.files?.[0])}
      />
      <IconButton
        onClick={() => fileRef.current?.click()}
        highlighted={highlighted}
        className={`w-full ${primary && !highlighted ? 'border-[var(--accent)] bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]' : ''} ${className ?? ''}`}
      >
        <ImagePlus className="h-4 w-4" />
        {label}
      </IconButton>
    </>
  );
}

function getImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve({ width: 4096, height: 2048 });
    image.src = dataUrl;
  });
}
