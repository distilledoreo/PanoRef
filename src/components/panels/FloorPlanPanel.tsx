import React from 'react';
import { useAppStore } from '../../store/useAppStore';

export function FloorPlanPanel() {
  const { floorPlan, updateFloorPlan } = useAppStore();

  if (!floorPlan.enabled) {
    return (
      <div className="p-4 flex flex-col h-full bg-zinc-950 text-zinc-200 items-center justify-center text-center">
        <h2 className="text-sm font-semibold mb-2 text-zinc-100 uppercase tracking-tight">Floor Plan</h2>
        <p className="text-xs text-zinc-400 mb-6 px-4">Track your camera position and view direction in a 2D space.</p>
        <button 
          onClick={() => updateFloorPlan({ enabled: true })}
          className="bg-indigo-600 hover:bg-indigo-700 text-white py-2 px-4 rounded-md text-sm font-medium transition-colors"
        >
          Enable Floor Plan
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 flex flex-col h-full bg-zinc-950 text-zinc-200">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-sm font-semibold text-zinc-100 uppercase tracking-tight">Map Settings</h2>
        <button 
          onClick={() => updateFloorPlan({ enabled: false })}
          className="text-xs text-zinc-500 hover:text-red-400"
        >
          Disable
        </button>
      </div>

      <div className="flex flex-col gap-4">
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1">Room Dimensions (units)</label>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="text-xs text-zinc-500 mb-1 block">Width</span>
              <input 
                type="number" 
                value={floorPlan.roomWidth}
                onChange={(e) => updateFloorPlan({ roomWidth: Number(e.target.value) || 10 })}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-md py-1.5 px-2 text-sm text-zinc-200"
              />
            </div>
            <div>
              <span className="text-xs text-zinc-500 mb-1 block">Length</span>
              <input 
                type="number" 
                value={floorPlan.roomLength}
                onChange={(e) => updateFloorPlan({ roomLength: Number(e.target.value) || 10 })}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-md py-1.5 px-2 text-sm text-zinc-200"
              />
            </div>
          </div>
        </div>

        <div>
           <label className="block text-xs font-medium text-zinc-400 mb-1">Camera Position (x, y)</label>
           <div className="grid grid-cols-2 gap-2">
            <input 
              type="number" 
              value={floorPlan.cameraX}
              onChange={(e) => updateFloorPlan({ cameraX: Number(e.target.value) })}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-md py-1.5 px-2 text-sm text-zinc-200"
            />
            <input 
              type="number" 
              value={floorPlan.cameraY}
              onChange={(e) => updateFloorPlan({ cameraY: Number(e.target.value) })}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-md py-1.5 px-2 text-sm text-zinc-200"
            />
          </div>
        </div>

        <div>
           <label className="block text-xs font-medium text-zinc-400 mb-1">Camera Heading Offset (°)</label>
           <input 
              type="number" 
              value={floorPlan.cameraHeadingOffsetDegrees}
              onChange={(e) => updateFloorPlan({ cameraHeadingOffsetDegrees: Number(e.target.value) })}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-md py-1.5 px-2 text-sm text-zinc-200"
              placeholder="e.g. 90, to align zero yaw"
            />
            <p className="text-[10px] text-zinc-500 mt-1 leading-tight">Offset so that Yaw 0° matches the physical room forward direction.</p>
        </div>
      </div>
    </div>
  );
}
