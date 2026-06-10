import React from 'react';
import { useAppStore } from '../store/useAppStore';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Compass, ImagePlus, Bookmark, Download, SplitSquareHorizontal } from 'lucide-react';
import { LoadImagePanel } from './panels/LoadImagePanel';
import { BookmarkPanel } from './panels/BookmarkPanel';
import { ExportPanel } from './panels/ExportPanel';
import { ComparePanel } from './panels/ComparePanel';
import { FloorPlanPanel } from './panels/FloorPlanPanel';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function TabButton({ id, icon: Icon, label, activeTab, onClick }: any) {
  const isActive = activeTab === id;
  return (
    <button
      onClick={() => onClick(id)}
      className={cn(
        "flex flex-col items-center justify-center py-3 w-full text-xs font-medium transition-colors",
        isActive 
          ? "bg-zinc-800 text-white border-l-2 border-indigo-500" 
          : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 border-l-2 border-transparent"
      )}
    >
      <Icon className="w-5 h-5 mb-1" />
      <span>{label}</span>
    </button>
  );
}

export function Sidebar() {
  const { activeTab, setActiveTab } = useAppStore();

  return (
    <div className="flex h-full w-80 bg-zinc-950 border-r border-zinc-800 shrink-0">
      <div className="w-20 bg-zinc-900 border-r border-zinc-800/50 flex flex-col shrink-0 py-2 items-center">
        <TabButton id="load" icon={ImagePlus} label="Load" activeTab={activeTab} onClick={setActiveTab} />
        <TabButton id="bookmarks" icon={Bookmark} label="Views" activeTab={activeTab} onClick={setActiveTab} />
        <TabButton id="export" icon={Download} label="Export" activeTab={activeTab} onClick={setActiveTab} />
        <TabButton id="compare" icon={SplitSquareHorizontal} label="Compare" activeTab={activeTab} onClick={setActiveTab} />
        <TabButton id="floorplan" icon={Compass} label="Map" activeTab={activeTab} onClick={setActiveTab} />
      </div>
      
      <div className="flex-1 flex flex-col overflow-y-auto">
        {activeTab === 'load' && <LoadImagePanel />}
        {activeTab === 'bookmarks' && <BookmarkPanel />}
        {activeTab === 'export' && <ExportPanel />}
        {activeTab === 'compare' && <ComparePanel />}
        {activeTab === 'floorplan' && <FloorPlanPanel />}
      </div>
    </div>
  );
}
