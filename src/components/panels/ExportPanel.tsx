import React, { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { exportCrop } from '../../lib/exportRender';
import { MonitorDown, Images } from 'lucide-react';
import { AspectRatio, StereoExportMode } from '../../types';

const ASPECT_RATIOS: Record<AspectRatio, number> = {
  "16:9": 16 / 9,
  "9:16": 9 / 16,
  "1:1": 1,
  "2.39:1": 2.39,
  "custom": 1,
};

export function ExportPanel() {
  const { exportSettings, updateExportSettings, imageUrl, panoramaMode, yawDegrees, pitchDegrees, fovDegrees, bookmarks } = useAppStore();
  const [isExporting, setIsExporting] = useState(false);

  const handleRatioChange = (ratio: AspectRatio) => {
    const r = ASPECT_RATIOS[ratio];
    if (ratio !== 'custom') {
      const width = ratio === '9:16' ? 1080 : 1920;
      const height = Math.round(width / r);
      updateExportSettings({ aspectRatio: ratio, width, height });
    } else {
      updateExportSettings({ aspectRatio: ratio });
    }
  };

  const doExportSingle = async () => {
    if (!imageUrl) return;
    setIsExporting(true);
    try {
      await exportCrop({
        imageUrl,
        panoramaMode,
        yawDegrees,
        pitchDegrees,
        fovDegrees,
        width: exportSettings.width,
        height: exportSettings.height,
        stereoMode: exportSettings.stereoMode,
      });
    } catch(err) {
      console.error(err);
      alert("Export failed");
    }
    setIsExporting(false);
  };
  
  const doExportAll = async () => {
    if (!imageUrl || bookmarks.length === 0) return;
    setIsExporting(true);
    try {
      for (const b of bookmarks) {
        await exportCrop({
          imageUrl,
          panoramaMode,
          yawDegrees: b.yawDegrees,
          pitchDegrees: b.pitchDegrees,
          fovDegrees: b.fovDegrees,
          width: b.width,
          height: b.height,
          stereoMode: exportSettings.stereoMode,
          name: b.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()
        });
      }
    } catch(err) {
      console.error(err);
      alert("Export failed");
    }
    setIsExporting(false);
  };

  return (
    <div className="p-4 flex flex-col h-full bg-zinc-950 text-zinc-200">
      <h2 className="text-sm font-semibold mb-4 text-zinc-100 uppercase tracking-tight">Export Settings</h2>
      
      <div className="flex flex-col gap-4 mb-6">
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1">Aspect Ratio</label>
          <select 
            value={exportSettings.aspectRatio}
            onChange={(e) => handleRatioChange(e.target.value as AspectRatio)}
            className="w-full bg-zinc-900 border border-zinc-700 rounded-md py-1.5 px-2 text-sm text-zinc-200"
          >
            <option value="16:9">16:9 (Landscape)</option>
            <option value="9:16">9:16 (Portrait)</option>
            <option value="1:1">1:1 (Square)</option>
            <option value="2.39:1">2.39:1 (Cinematic)</option>
            <option value="custom">Custom</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Width (px)</label>
            <input 
              type="number" 
              value={exportSettings.width}
              onChange={(e) => updateExportSettings({ width: parseInt(e.target.value) || 0 })}
              disabled={exportSettings.aspectRatio !== 'custom'}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-md py-1.5 px-2 text-sm text-zinc-200 disabled:opacity-50"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Height (px)</label>
            <input 
              type="number" 
              value={exportSettings.height}
              onChange={(e) => updateExportSettings({ height: parseInt(e.target.value) || 0 })}
              disabled={exportSettings.aspectRatio !== 'custom'}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-md py-1.5 px-2 text-sm text-zinc-200 disabled:opacity-50"
            />
          </div>
        </div>

        {panoramaMode !== 'mono' && (
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Stereo Export Eye</label>
            <select 
              value={exportSettings.stereoMode}
              onChange={(e) => updateExportSettings({ stereoMode: e.target.value as StereoExportMode })}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-md py-1.5 px-2 text-sm text-zinc-200"
            >
              <option value="left-eye-only">Left Eye (Reference)</option>
              <option value="right-eye-only">Right Eye</option>
            </select>
            <p className="text-xs text-zinc-500 mt-1">Left eye is standard for AI reference frames.</p>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 mt-auto">
        <button 
          onClick={doExportSingle}
          disabled={!imageUrl || isExporting}
          className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white py-2 px-3 rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <MonitorDown className="w-4 h-4" />
          Export Current View
        </button>
        
        <button 
          onClick={doExportAll}
          disabled={!imageUrl || isExporting || bookmarks.length === 0}
          className="w-full flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-white py-2 px-3 rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-zinc-700"
        >
          <Images className="w-4 h-4" />
          Export All Bookmarks
        </button>
      </div>
    </div>
  );
}
