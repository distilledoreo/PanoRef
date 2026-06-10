import React from 'react';
import { useAppStore } from '../../store/useAppStore';
import { BookmarkPlus, Play, Trash2, Copy } from 'lucide-react';
import { AspectRatio } from '../../types';

function generateId() {
  return Math.random().toString(36).substring(2, 9);
}

export function BookmarkPanel() {
  const { bookmarks, addBookmark, removeBookmark, loadBookmark, yawDegrees, pitchDegrees, fovDegrees, exportSettings } = useAppStore();

  const handleSaveView = () => {
    addBookmark({
      id: generateId(),
      name: `View ${bookmarks.length + 1}`,
      yawDegrees,
      pitchDegrees,
      fovDegrees,
      aspectRatio: exportSettings.aspectRatio,
      width: exportSettings.width,
      height: exportSettings.height,
      eyeMode: 'left',
      createdAt: new Date().toISOString(),
    });
  };

  return (
    <div className="p-4 flex flex-col h-full bg-zinc-950 text-zinc-200">
      <h2 className="text-sm font-semibold mb-4 text-zinc-100 uppercase tracking-tight">Saved Views</h2>
      
      <button 
        onClick={handleSaveView}
        className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white py-2 px-3 rounded-md text-sm font-medium transition-colors mb-6"
      >
        <BookmarkPlus className="w-4 h-4" />
        Save Current View
      </button>

      <div className="flex-1 overflow-y-auto pr-1 -mr-1">
        {bookmarks.length === 0 ? (
          <p className="text-zinc-500 text-sm italic text-center mt-10">No saved views yet</p>
        ) : (
          <div className="flex flex-col gap-3">
            {bookmarks.map((b) => (
              <div key={b.id} className="bg-zinc-900 border border-zinc-800 rounded-md p-3 flex flex-col gap-2">
                <div className="flex justify-between items-center">
                  <span className="font-medium text-sm text-zinc-200">{b.name}</span>
                  <div className="flex gap-1">
                    <button 
                      onClick={() => loadBookmark(b.id)}
                      className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-md transition-colors"
                      title="Load View"
                    >
                      <Play className="w-3.5 h-3.5" />
                    </button>
                    <button 
                      onClick={() => removeBookmark(b.id)}
                      className="p-1.5 text-zinc-400 hover:text-red-400 hover:bg-zinc-800 rounded-md transition-colors"
                      title="Delete View"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <div className="text-xs text-zinc-500 font-mono grid grid-cols-2 gap-1">
                  <span>Y: {b.yawDegrees.toFixed(1)}°</span>
                  <span>P: {b.pitchDegrees.toFixed(1)}°</span>
                  <span>FOV: {b.fovDegrees.toFixed(1)}°</span>
                  <span>{b.aspectRatio}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
