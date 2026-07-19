import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 4;

function computeMenuPosition(
  anchor: DOMRect,
  menuWidth: number,
  menuHeight: number,
): { top: number; left: number } {
  let left = anchor.right - menuWidth;
  left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(left, window.innerWidth - menuWidth - VIEWPORT_MARGIN),
  );

  const spaceBelow = window.innerHeight - anchor.bottom;
  const spaceAbove = anchor.top;
  const opensBelow = spaceBelow >= menuHeight + ANCHOR_GAP || spaceBelow >= spaceAbove;
  const top = opensBelow
    ? anchor.bottom + ANCHOR_GAP
    : anchor.top - menuHeight - ANCHOR_GAP;

  return { top, left };
}

export function AnchoredMenuPopover({
  open,
  anchorRef,
  onClose,
  children,
  className,
  role = 'menu',
  'aria-label': ariaLabel,
}: {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  role?: string;
  'aria-label'?: string;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  onCloseRef.current = onClose;

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    const menu = menuRef.current;
    if (!anchor || !menu) return;
    const anchorRect = anchor.getBoundingClientRect();
    setPosition(computeMenuPosition(anchorRect, menu.offsetWidth, menu.offsetHeight));
  }, [anchorRef]);

  useLayoutEffect(() => {
    if (!open || !menuRef.current) {
      setPosition(null);
      return;
    }

    const menu = menuRef.current;
    const observer = new ResizeObserver(() => updatePosition());
    observer.observe(menu);
    updatePosition();

    return () => observer.disconnect();
  }, [open, updatePosition, children]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onCloseRef.current();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
      }
    };

    const handleDismiss = () => onCloseRef.current();

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('resize', handleDismiss);
    window.addEventListener('scroll', handleDismiss, true);

    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('resize', handleDismiss);
      window.removeEventListener('scroll', handleDismiss, true);
    };
  }, [anchorRef, open]);

  if (!open || typeof document === 'undefined') return null;

  const menu = (
    <div
      ref={menuRef}
      role={role}
      aria-label={ariaLabel}
      className={className}
      style={{
        position: 'fixed',
        top: position?.top ?? -9999,
        left: position?.left ?? -9999,
        visibility: position ? 'visible' : 'hidden',
        zIndex: 70,
      }}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );

  return createPortal(menu, document.body);
}
