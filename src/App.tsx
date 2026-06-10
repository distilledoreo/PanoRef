import React, { useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { PanoramaViewer } from './components/PanoramaViewer';
import { CompareOverlay } from './components/CompareOverlay';
import { FloorPlanOverlay } from './components/FloorPlanOverlay';
import { useAppStore } from './store/useAppStore';
import { exportCrop } from './lib/exportRender';

function generateId() {
  return Math.random().toString(36).substring(2, 9);
}

export default function App() {
  const { 
    activeTab, 
    addBookmark, 
    imageUrl, 
    panoramaMode, 
    yawDegrees, 
    pitchDegrees, 
    fovDegrees, 
    exportSettings,
    bookmarks,
    loadBookmark
  } = useAppStore();

  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      // Ignore if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const key = e.key.toLowerCase();

      if (key === 'b') {
        e.preventDefault();
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
      } else if (key === 'e') {
        e.preventDefault();
        if (!imageUrl) return;
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
        }
      } else if (key === 'r') {
        e.preventDefault();
        useAppStore.getState().setViewerState(0, 0, 90);
      } else if (key >= '1' && key <= '9') {
        const index = parseInt(key) - 1;
        if (index >= 0 && index < bookmarks.length) {
          loadBookmark(bookmarks[index].id);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [imageUrl, panoramaMode, yawDegrees, pitchDegrees, fovDegrees, exportSettings, bookmarks, addBookmark, loadBookmark]);

  return (
    <div className="flex h-screen w-full bg-zinc-950 text-white overflow-hidden font-sans selection:bg-indigo-500/30">
      <Sidebar />
      <main className="flex-1 relative">
        <PanoramaViewer />
        {activeTab === 'compare' && <CompareOverlay />}
        {activeTab === 'floorplan' && <FloorPlanOverlay />}
      </main>
    </div>
  );
}
