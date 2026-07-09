import { create } from 'zustand';

export type AppMode = 'continuity' | 'panoViewer';

const STORAGE_KEY = 'panoref-app-mode';

function readStoredMode(): AppMode | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (value === 'continuity' || value === 'panoViewer') return value;
  } catch {
    // ignore storage failures
  }
  return null;
}

function writeStoredMode(mode: AppMode) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // ignore storage failures
  }
}

interface AppModeState {
  /** null = user has not chosen a mode yet this install/session */
  appMode: AppMode | null;
  setAppMode: (mode: AppMode) => void;
}

const initialMode = readStoredMode();

export const useAppModeStore = create<AppModeState>((set) => ({
  appMode: initialMode,
  setAppMode: (mode) => {
    writeStoredMode(mode);
    set({ appMode: mode });
  },
}));
