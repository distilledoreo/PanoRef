export type PanoramaMode = "mono" | "stereo-over-under" | "stereo-side-by-side";
export type EyeMode = "left" | "right" | "mono-average";
export type AspectRatio = "16:9" | "9:16" | "1:1" | "2.39:1" | "custom";
export type StereoExportMode =
  | "left-eye-only"
  | "right-eye-only"
  | "mono-average"
  | "stereo-over-under"
  | "stereo-side-by-side";

export interface ExportSettings {
  aspectRatio: AspectRatio;
  width: number;
  height: number;
  fovDegrees: number;
  eyeMode: EyeMode;
  stereoMode: StereoExportMode;
}

export interface ViewBookmark {
  id: string;
  name: string;
  yawDegrees: number;
  pitchDegrees: number;
  fovDegrees: number;
  aspectRatio: AspectRatio;
  width: number;
  height: number;
  eyeMode: EyeMode;
  notes?: string;
  createdAt: string;
}

export interface FloorPlanMarker {
  id: string;
  label: string;
  x: number;
  y: number;
}

export interface FloorPlan {
  enabled: boolean;
  roomWidth: number;
  roomLength: number;
  cameraX: number;
  cameraY: number;
  cameraHeadingOffsetDegrees: number;
  markers: FloorPlanMarker[];
}

export interface PanoRefProject {
  version: number;
  panoramaName?: string;
  panoramaMode: PanoramaMode;
  bookmarks: ViewBookmark[];
  floorPlan: FloorPlan;
  exportSettings: ExportSettings;
}

export interface AppState {
  // Image data
  imageUrl: string | null;
  imageFileName: string | null;
  
  // Viewer state
  panoramaMode: PanoramaMode;
  yawDegrees: number;
  pitchDegrees: number;
  fovDegrees: number;
  showGrid: boolean;

  // App UI state
  activeTab: 'load' | 'bookmarks' | 'export' | 'compare' | 'floorplan';
  
  // Data
  bookmarks: ViewBookmark[];
  exportSettings: ExportSettings;
  floorPlan: FloorPlan;
  
  // Compare state
  compareImageA: string | null;
  compareImageB: string | null;
  compareMode: 'side' | 'overlay' | 'wipe';
  compareWipePosition: number;
  compareOverlayOpacity: number;
}
