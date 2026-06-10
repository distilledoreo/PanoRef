import React from 'react';
import { useAppStore } from '../store/useAppStore';

export function FloorPlanOverlay() {
  const { floorPlan, yawDegrees, fovDegrees, bookmarks } = useAppStore();

  if (!floorPlan.enabled) return null;

  // Let's draw a top-down view.
  // Room coordinates: (0,0) is bottom-left? Let's say top-left is (0,0).
  // x is width, y is length.
  
  // We need to scale the room to fit the overlay, but keep it a reasonable size in the corner or center.
  // Let's make it a floating widget.
  
  const CANVAS_SIZE = 300;
  const maxDim = Math.max(floorPlan.roomWidth, floorPlan.roomLength);
  const scale = (CANVAS_SIZE * 0.8) / (maxDim || 1); // 80% of canvas to leave padding

  const cx = CANVAS_SIZE / 2;
  const cy = CANVAS_SIZE / 2;
  
  // Center the room
  const rx = cx - (floorPlan.roomWidth * scale) / 2;
  const ry = cy - (floorPlan.roomLength * scale) / 2;

  // Camera pos relative to room bounds (assuming 0,0 is top-left of room)
  const camX = rx + (floorPlan.cameraX * scale);
  const camY = ry + (floorPlan.cameraY * scale);

  // Heading calculation: Top is 0 degrees? Let's say -Y is 0 degrees (North).
  // SVG coordinates: angle 0 = up, 90 = right, etc.
  const getAngleRad = (yaw: number) => {
    const totalYaw = yaw + floorPlan.cameraHeadingOffsetDegrees;
    // In three js, -yaw rotates right or left? Let's assume standard compass bearing.
    // 0 is North (-Y), 90 is East (+X).
    // angle in radians for standard math (0 is +X): angle = 90 - compass;
    const compass = totalYaw;
    return (compass - 90) * (Math.PI / 180);
  };

  const drawCone = (yaw: number, fov: number, color: string, opacity: number) => {
    const r = CANVAS_SIZE * 0.4; // cone length
    const radCenter = getAngleRad(yaw);
    const radFovHalf = (fov / 2) * (Math.PI / 180);
    
    // Path: M camX camY L x1 y1 A r r 0 0 1 x2 y2 Z
    // SVG x is cos, y is sin
    const x1 = camX + r * Math.cos(radCenter - radFovHalf);
    const y1 = camY + r * Math.sin(radCenter - radFovHalf);
    const x2 = camX + r * Math.cos(radCenter + radFovHalf);
    const y2 = camY + r * Math.sin(radCenter + radFovHalf);
    
    return (
      <path 
        d={`M ${camX} ${camY} L ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2} Z`}
        fill={color}
        fillOpacity={opacity}
        stroke="none"
      />
    );
  };
  
  const drawRay = (yaw: number) => {
    const r = CANVAS_SIZE * 0.4;
    const radCenter = getAngleRad(yaw);
    const x1 = camX + r * Math.cos(radCenter);
    const y1 = camY + r * Math.sin(radCenter);
    return (
      <line x1={camX} y1={camY} x2={x1} y2={y1} stroke="rgba(255, 255, 255, 0.4)" strokeWidth="1" strokeDasharray="3 3" />
    );
  };

  return (
    <div className="absolute top-4 right-4 bg-zinc-950/80 border border-zinc-800 rounded-lg shadow-xl backdrop-blur-md p-4 z-20 pointer-events-none">
      <div className="text-xs font-semibold text-zinc-300 mb-2 uppercase tracking-tight">Top-Down Map</div>
      <svg width={CANVAS_SIZE} height={CANVAS_SIZE} className="bg-black/50 rounded border border-zinc-800/50">
        <defs>
          <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
        
        {/* Room */}
        <rect 
          x={rx} 
          y={ry} 
          width={floorPlan.roomWidth * scale} 
          height={floorPlan.roomLength * scale} 
          fill="rgba(79, 70, 229, 0.1)" 
          stroke="rgba(79, 70, 229, 0.5)" 
          strokeWidth="2"
        />

        {/* Bookmark rays */}
        {bookmarks.map(b => (
          <g key={b.id}>
             {drawRay(b.yawDegrees)}
          </g>
        ))}

        {/* Camera FOV */}
        {drawCone(yawDegrees, fovDegrees, "rgba(255, 255, 255, 1)", 0.2)}
        
        {/* Camera Point */}
        <circle cx={camX} cy={camY} r="4" fill="#6366f1" />
        <circle cx={camX} cy={camY} r="1.5" fill="#fff" />
      </svg>
      <div className="text-[10px] text-zinc-500 mt-2 flex justify-between">
        <span>Room: {floorPlan.roomWidth}x{floorPlan.roomLength}</span>
        <span>Cam: ({floorPlan.cameraX}, {floorPlan.cameraY})</span>
      </div>
    </div>
  );
}
