import React, { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { useAppStore } from '../../store/useAppStore';
import { PanoramaMode } from '../../types';
import { Save } from 'lucide-react';

export function LoadImagePanel() {
  const { setImageUrl, panoramaMode, setPanoramaMode, loadProject, getProject, imageFileName } = useAppStore();

  const handleSaveProject = () => {
    const project = getProject();
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `panoref_${project.panoramaName?.split('.')[0] || 'project'}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;
    const file = acceptedFiles[0];

    // If it's a JSON project file
    if (file.name.endsWith('.json')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const project = JSON.parse(e.target?.result as string);
          if (project.version) {
            loadProject(project);
            alert("Project loaded! Please also drag in the matching panorama image if it is missing.");
          }
        } catch (err) {
          alert("Failed to parse project file.");
        }
      };
      reader.readAsText(file);
      return;
    }

    // Otherwise treat as image
    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result) {
        setImageUrl(e.target.result as string, file.name);
      }
    };
    reader.readAsDataURL(file);
  }, [setImageUrl, loadProject]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.jpg', '.jpeg', '.png', '.webp'],
      'application/json': ['.json']
    },
    multiple: false
  } as any);

  return (
    <div className="p-4 flex flex-col h-full bg-zinc-950 text-zinc-200">
      <h2 className="text-sm font-semibold mb-4 text-zinc-100 uppercase tracking-tight">Load & Save</h2>
      
      <div 
        {...getRootProps()} 
        className={`border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-colors ${isDragActive ? 'border-indigo-500 bg-indigo-500/10' : 'border-zinc-700 hover:border-zinc-500 bg-zinc-900'}`}
      >
        <input {...getInputProps()} />
        <p className="text-sm text-zinc-400">
          Drag & drop an equirectangular image or project JSON here, or click to select
        </p>
      </div>
      
      {imageFileName && (
        <div className="mt-4 text-xs text-zinc-500 bg-zinc-900 border border-zinc-800 p-2 rounded truncate" title={imageFileName}>
          Loaded: <span className="text-zinc-300 font-medium">{imageFileName}</span>
        </div>
      )}

      <div className="mt-8">
        <label className="block text-xs font-medium text-zinc-400 mb-2">Panorama Mode</label>
        <div className="flex flex-col gap-2">
          {(['mono', 'stereo-over-under', 'stereo-side-by-side'] as PanoramaMode[]).map((mode) => (
            <label key={mode} className="flex items-center gap-2 text-sm text-zinc-300">
              <input 
                type="radio" 
                name="panoramaMode" 
                value={mode} 
                checked={panoramaMode === mode}
                onChange={() => setPanoramaMode(mode)}
                className="text-indigo-500 bg-zinc-800 border-zinc-700"
              />
              {mode === 'mono' ? 'Mono' : mode === 'stereo-over-under' ? 'Stereo (Over/Under)' : 'Stereo (Side-by-Side)'}
            </label>
          ))}
        </div>
      </div>
      
      <div className="mt-auto pt-6 border-t border-zinc-800">
         <button 
          onClick={handleSaveProject}
          className="w-full flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-white py-2 px-3 rounded-md text-sm font-medium transition-colors border border-zinc-700"
        >
          <Save className="w-4 h-4" />
          Save Project JSON
        </button>
      </div>
    </div>
  );
}
