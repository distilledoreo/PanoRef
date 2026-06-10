import { create } from 'zustand';
import { AppState, ViewBookmark, PanoRefProject, ExportSettings, PanoramaMode, FloorPlan } from '../types';

const defaultExportSettings: ExportSettings = {
  aspectRatio: '16:9',
  width: 1920,
  height: 1080,
  fovDegrees: 90,
  eyeMode: 'left',
  stereoMode: 'left-eye-only',
};

const defaultFloorPlan: FloorPlan = {
  enabled: false,
  roomWidth: 100,
  roomLength: 100,
  cameraX: 50,
  cameraY: 50,
  cameraHeadingOffsetDegrees: 0,
  markers: [],
};

export interface AppStore extends AppState {
  setImageUrl: (url: string | null, fileName: string | null) => void;
  setPanoramaMode: (mode: PanoramaMode) => void;
  setViewerState: (yaw: number, pitch: number, fov: number) => void;
  setShowGrid: (show: boolean) => void;
  setActiveTab: (tab: AppState['activeTab']) => void;
  
  // Bookmarks
  addBookmark: (bookmark: ViewBookmark) => void;
  updateBookmark: (id: string, updates: Partial<ViewBookmark>) => void;
  removeBookmark: (id: string) => void;
  loadBookmark: (id: string) => void;
  
  // Settings
  updateExportSettings: (updates: Partial<ExportSettings>) => void;
  updateFloorPlan: (updates: Partial<FloorPlan>) => void;
  
  // Compare
  setCompareImages: (a: string | null, b: string | null) => void;
  updateCompareState: (updates: Partial<Pick<AppState, 'compareMode' | 'compareWipePosition' | 'compareOverlayOpacity'>>) => void;
  
  // Project
  loadProject: (project: PanoRefProject) => void;
  getProject: () => PanoRefProject;
}

export const useAppStore = create<AppStore>((set, get) => ({
  imageUrl: null,
  imageFileName: null,
  panoramaMode: 'mono',
  yawDegrees: 0,
  pitchDegrees: 0,
  fovDegrees: 90,
  showGrid: false,
  activeTab: 'load',
  bookmarks: [],
  exportSettings: defaultExportSettings,
  floorPlan: defaultFloorPlan,
  compareImageA: null,
  compareImageB: null,
  compareMode: 'wipe',
  compareWipePosition: 50,
  compareOverlayOpacity: 50,

  setImageUrl: (url, fileName) => set({ imageUrl: url, imageFileName: fileName }),
  setPanoramaMode: (mode) => set({ panoramaMode: mode }),
  setViewerState: (yawDegrees, pitchDegrees, fovDegrees) => set({ yawDegrees, pitchDegrees, fovDegrees }),
  setShowGrid: (show) => set({ showGrid: show }),
  setActiveTab: (tab) => set({ activeTab: tab }),

  addBookmark: (bookmark) => set((state) => ({ bookmarks: [...state.bookmarks, bookmark] })),
  updateBookmark: (id, updates) => set((state) => ({
    bookmarks: state.bookmarks.map((b) => b.id === id ? { ...b, ...updates } : b)
  })),
  removeBookmark: (id) => set((state) => ({
    bookmarks: state.bookmarks.filter((b) => b.id !== id)
  })),
  loadBookmark: (id) => {
    const bookmark = get().bookmarks.find((b) => b.id === id);
    if (bookmark) {
      set({
        yawDegrees: bookmark.yawDegrees,
        pitchDegrees: bookmark.pitchDegrees,
        fovDegrees: bookmark.fovDegrees,
      });
    }
  },

  updateExportSettings: (updates) => set((state) => ({
    exportSettings: { ...state.exportSettings, ...updates }
  })),
  updateFloorPlan: (updates) => set((state) => ({
    floorPlan: { ...state.floorPlan, ...updates }
  })),

  setCompareImages: (compareImageA, compareImageB) => set({ compareImageA, compareImageB }),
  updateCompareState: (updates) => set((state) => ({ ...state, ...updates })),

  loadProject: (project) => set({
    panoramaMode: project.panoramaMode,
    bookmarks: project.bookmarks,
    floorPlan: project.floorPlan || defaultFloorPlan,
    exportSettings: project.exportSettings,
  }),
  getProject: () => {
    const state = get();
    return {
      version: 1,
      panoramaName: state.imageFileName || undefined,
      panoramaMode: state.panoramaMode,
      bookmarks: state.bookmarks,
      floorPlan: state.floorPlan,
      exportSettings: state.exportSettings,
    };
  },
}));
