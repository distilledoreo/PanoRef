import React, { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { useAppStore } from '../../store/useAppStore';

function ImageDropzone({ label, image, onDropImage }: { label: string, image: string | null, onDropImage: (url: string) => void }) {
  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      const url = URL.createObjectURL(acceptedFiles[0]);
      onDropImage(url);
    }
  }, [onDropImage]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': [] },
    multiple: false
  } as any);

  return (
    <div 
      {...getRootProps()} 
      className={`border-2 border-dashed rounded-lg p-3 text-center cursor-pointer transition-colors relative overflow-hidden group
        ${isDragActive ? 'border-indigo-500 bg-indigo-500/10' : 'border-zinc-700 hover:border-zinc-500 bg-zinc-900'}
        ${image ? 'h-24' : 'h-32 flex flex-col items-center justify-center'}`}
    >
      <input {...getInputProps()} />
      {image ? (
        <>
           <img src={image} className="absolute inset-0 w-full h-full object-cover opacity-50 group-hover:opacity-30 transition-opacity" />
           <span className="relative z-10 text-xs font-semibold drop-shadow-md text-white">Click or drop to replace {label}</span>
        </>
      ) : (
        <div className="text-sm text-zinc-400">
           <span className="font-semibold text-zinc-300 block mb-1">{label}</span>
           Drop image here
        </div>
      )}
    </div>
  );
}

export function ComparePanel() {
  const { compareImageA, compareImageB, setCompareImages, compareMode, compareWipePosition, compareOverlayOpacity, updateCompareState } = useAppStore();

  return (
    <div className="p-4 flex flex-col h-full bg-zinc-950 text-zinc-200 gap-6">
      <div>
        <h2 className="text-sm font-semibold mb-4 text-zinc-100 uppercase tracking-tight">Compare Images</h2>
        <div className="flex flex-col gap-3">
          <ImageDropzone 
            label="Image A (Reference)" 
            image={compareImageA} 
            onDropImage={(url) => setCompareImages(url, compareImageB)} 
          />
          <ImageDropzone 
            label="Image B (Result)" 
            image={compareImageB} 
            onDropImage={(url) => setCompareImages(compareImageA, url)} 
          />
        </div>
      </div>

      {(compareImageA || compareImageB) && (
        <div className="flex flex-col gap-4">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-2">Display Mode</label>
            <div className="flex bg-zinc-900 rounded-md p-1 border border-zinc-800">
              {(['wipe', 'overlay', 'side'] as const).map(mode => (
                <button
                  key={mode}
                  onClick={() => updateCompareState({ compareMode: mode })}
                  className={`flex-1 text-xs py-1.5 capitalize rounded ${compareMode === mode ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          {compareMode === 'wipe' && (
            <div>
              <label className="flex justify-between text-xs font-medium text-zinc-400 mb-2">
                <span>Wipe Position</span>
                <span>{compareWipePosition}%</span>
              </label>
              <input 
                type="range" 
                min="0" max="100" 
                value={compareWipePosition}
                onChange={(e) => updateCompareState({ compareWipePosition: Number(e.target.value) })}
                className="w-full accent-indigo-500"
              />
            </div>
          )}

          {compareMode === 'overlay' && (
            <div>
              <label className="flex justify-between text-xs font-medium text-zinc-400 mb-2">
                <span>Overlay Opacity (Image B)</span>
                <span>{compareOverlayOpacity}%</span>
              </label>
              <input 
                type="range" 
                min="0" max="100" 
                value={compareOverlayOpacity}
                onChange={(e) => updateCompareState({ compareOverlayOpacity: Number(e.target.value) })}
                className="w-full accent-indigo-500"
              />
            </div>
          )}
          
          <button
              onClick={() => setCompareImages(null, null)}
              className="mt-4 w-full bg-red-900/30 text-red-400 hover:bg-red-900/50 py-2 rounded-md text-xs font-medium transition-colors border border-red-900/50"
          >
              Clear Images
          </button>
        </div>
      )}
    </div>
  );
}
