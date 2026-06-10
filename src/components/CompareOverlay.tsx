import React, { useRef, useState, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';

export function CompareOverlay() {
  const { compareImageA, compareImageB, compareMode, compareWipePosition, compareOverlayOpacity } = useAppStore();
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Minimal Pan/Zoom state
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const isDragging = useRef(false);
  const lastMousePos = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handlePointerDown = (e: PointerEvent) => {
      isDragging.current = true;
      lastMousePos.current = { x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!isDragging.current) return;
      const dx = e.clientX - lastMousePos.current.x;
      const dy = e.clientY - lastMousePos.current.y;
      lastMousePos.current = { x: e.clientX, y: e.clientY };
      setOffset(prev => ({ x: prev.x + dx, y: prev.y + dy }));
    };

    const handlePointerUp = (e: PointerEvent) => {
      isDragging.current = false;
      el.releasePointerCapture(e.pointerId);
    };

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const zoomFactor = -e.deltaY * 0.002;
      setScale(s => Math.max(0.1, Math.min(10, s * (1 + zoomFactor))));
    };

    el.addEventListener('pointerdown', handlePointerDown);
    el.addEventListener('pointermove', handlePointerMove);
    el.addEventListener('pointerup', handlePointerUp);
    el.addEventListener('pointercancel', handlePointerUp);
    el.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      el.removeEventListener('pointerdown', handlePointerDown);
      el.removeEventListener('pointermove', handlePointerMove);
      el.removeEventListener('pointerup', handlePointerUp);
      el.removeEventListener('pointercancel', handlePointerUp);
      el.removeEventListener('wheel', handleWheel);
    };
  }, []);

  if (!compareImageA && !compareImageB) {
    return (
      <div className="absolute inset-0 bg-zinc-900 border border-zinc-800 rounded-lg flex items-center justify-center text-zinc-500 flex-col z-20">
        <p>No images loaded for comparison</p>
        <p className="text-sm mt-2">Add images in the Compare tab</p>
      </div>
    );
  }

  const transformStyle = {
    transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
    transformOrigin: '0 0'
  };

  return (
    <div className="absolute inset-0 bg-zinc-900 overflow-hidden z-20 touch-none flex items-center justify-center p-8 rounded-lg">
       <div 
         ref={containerRef}
         className="w-full h-full relative flex items-center justify-center cursor-move"
         style={{ containerType: 'size' }}
       >
         {/* Container to maintain aspect or just fill and cover */}
         <div className="absolute inset-0 flex items-center justify-center" style={transformStyle}>
           
           {compareMode === 'side' && (
             <div className="flex h-full w-full max-w-full max-h-full gap-2 items-center justify-center pointer-events-none">
               {compareImageA ? <img src={compareImageA} className="max-h-full max-w-[50%] object-contain" draggable={false} /> : <div className="max-h-full w-[50%] bg-zinc-800" />}
               {compareImageB ? <img src={compareImageB} className="max-h-full max-w-[50%] object-contain" draggable={false} /> : <div className="max-h-full w-[50%] bg-zinc-800" />}
             </div>
           )}

           {compareMode === 'overlay' && (
             <div className="relative pointer-events-none">
               {compareImageA && <img src={compareImageA} className="max-h-[80vh] object-contain" draggable={false} />}
               {compareImageB && (
                 <img 
                   src={compareImageB} 
                   className="absolute inset-0 max-h-[80vh] object-contain" 
                   style={{ opacity: compareOverlayOpacity / 100 }}
                   draggable={false}
                 />
               )}
             </div>
           )}

           {compareMode === 'wipe' && (
             <div className="relative pointer-events-none">
               {compareImageA && <img src={compareImageA} className="max-h-[80vh] object-contain" draggable={false} />}
               {compareImageB && (
                 <div 
                   className="absolute inset-0 overflow-hidden" 
                   style={{ width: `${compareWipePosition}%` }}
                 >
                   <img 
                     src={compareImageB} 
                     className="max-h-[80vh] max-w-none object-contain" 
                     draggable={false} 
                   />
                 </div>
               )}
               <div 
                 className="absolute top-0 bottom-0 w-0.5 bg-indigo-500" 
                 style={{ left: `${compareWipePosition}%`, transform: 'translateX(-50%)' }}
               />
             </div>
           )}
           
         </div>
       </div>

       <div className="absolute bottom-4 left-4 pointer-events-none bg-black/50 text-white text-xs px-3 py-1.5 rounded-md backdrop-blur">
         Zoom: {Math.round(scale * 100)}%
       </div>
    </div>
  );
}
