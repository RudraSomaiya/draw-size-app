import { useEffect, useRef, useState, useCallback, useLayoutEffect } from "react";

import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Pencil, Eraser, Undo, Trash2, ArrowRight, ArrowLeft, RotateCcw } from "lucide-react";

// Action types for drawing history - store in image-space so we can rebuild independent of view transform
type DrawAction = {
  type: "draw" | "erase";
  points: { x: number; y: number }[]; // image-space points
  strokeWidth: number; // image-space width
};

// Transform matrix for zoom/pan operations (image space -> screen space)
type TransformMatrix = {
  scale: number;
  translateX: number;
  translateY: number;
};

// Image display rect for proper centering and clipping
type ImageRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const DrawingCanvas = () => {
  const location = useLocation();
  const navigate = useNavigate();
  
  // Canvas refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const isPanningRef = useRef<boolean>(false);
  const lastPanRef = useRef<{ x: number; y: number } | null>(null);

  // State
  const [activeTool, setActiveTool] = useState<"draw" | "erase">("draw");
  const [actionHistory, setActionHistory] = useState<DrawAction[]>([]);
  const [brushWidth, setBrushWidth] = useState([15]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPath, setCurrentPath] = useState<{ x: number; y: number }[]>([]);
  const [transform, setTransform] = useState<TransformMatrix>({ scale: 1, translateX: 0, translateY: 0 });
  const [imageRect, setImageRect] = useState<ImageRect>({ x: 0, y: 0, width: 0, height: 0 });
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [loadedImage, setLoadedImage] = useState<HTMLImageElement | null>(null);

  const imageData = location.state?.imageData;

  // Screen to image coordinate conversion using inverse transform
  const screenToImage = useCallback((screenX: number, screenY: number) => {
    const { scale, translateX, translateY } = transform;
    const imageX = (screenX - translateX) / scale;
    const imageY = (screenY - translateY) / scale;
    return { x: imageX, y: imageY };
  }, [transform]);

  // Clamp transform to keep image at least partially within viewport and scale within bounds
  const clampTransform = useCallback((t: TransformMatrix, imgW: number, imgH: number, vw: number, vh: number, ignoreMinScale: boolean = false): TransformMatrix => {
    const minScale = 0.75;
    const maxScale = 6;
    let scale = Math.min(maxScale, ignoreMinScale ? t.scale : Math.max(minScale, t.scale));

    const imageScreenW = imgW * scale;
    const imageScreenH = imgH * scale;

    // When image is larger than viewport, allow panning within bounds. If smaller, lock to center.
    const minTX = imageScreenW > vw ? vw - imageScreenW : (vw - imageScreenW) / 2;
    const maxTX = imageScreenW > vw ? 0 : (vw - imageScreenW) / 2;
    const minTY = imageScreenH > vh ? vh - imageScreenH : (vh - imageScreenH) / 2;
    const maxTY = imageScreenH > vh ? 0 : (vh - imageScreenH) / 2;

    let translateX = Math.min(maxTX, Math.max(minTX, t.translateX));
    let translateY = Math.min(maxTY, Math.max(minTY, t.translateY));

    return { scale, translateX, translateY };
  }, []);

  // Initialize canvas and load image
  useEffect(() => {
    if (!canvasRef.current || !maskCanvasRef.current || !imageData || !containerRef.current) return;

    // Calculate viewport size (fit container card)
    const container = containerRef.current;
    const rect = container.getBoundingClientRect();
    const viewportWidth = Math.min(rect.width * 0.92, 800);
    const viewportHeight = Math.min(rect.height * 0.72, 600);

    setViewportSize({ width: viewportWidth, height: viewportHeight });

    // Load image
    const img = new Image();
    img.onload = () => {
      setLoadedImage(img);

      // Setup canvas sizes
      const canvas = canvasRef.current!;
      const maskCanvas = maskCanvasRef.current!;
      // Temporarily set; we will sync to client size after layout
      canvas.width = viewportWidth;
      canvas.height = viewportHeight;
      maskCanvas.width = img.width;
      maskCanvas.height = img.height;

      // Initial render and fit after layout settles (double RAF)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          fitToContainer();
          renderCanvas();
        });
      });
    };
    img.src = imageData;
  }, [imageData, clampTransform]);

  // Helper: fit image to the current canvas wrapper size
  const fitToContainer = useCallback(() => {
    if (!loadedImage || !canvasRef.current) return;
    const c = canvasRef.current;
    const wrap = canvasWrapRef.current;
    const rect = wrap?.getBoundingClientRect();
    const cw = Math.floor(rect?.width ?? wrap?.clientWidth ?? c.clientWidth ?? c.width);
    const ch = Math.floor(rect?.height ?? wrap?.clientHeight ?? c.clientHeight ?? c.height);
    if (!cw || !ch) return;
    if (c.width !== cw || c.height !== ch) {
      c.width = cw; c.height = ch;
    }
    const fitScale = Math.min(cw / loadedImage.width, ch / loadedImage.height);
    const tx = (cw - loadedImage.width * fitScale) / 2;
    const ty = (ch - loadedImage.height * fitScale) / 2;
    // Set exact centered fit (no clamping during fit)
    setTransform({ scale: fitScale, translateX: tx, translateY: ty });
  }, [loadedImage, clampTransform]);

  // Ensure canvas backing store matches its displayed size and keep image centered on wrapper resize
  useEffect(() => {
    const onWinResize = () => fitToContainer();
    // Sync once on mount/updates
    fitToContainer();
    // Observe the wrapper for size changes
    const ro = new ResizeObserver(() => fitToContainer());
    if (canvasWrapRef.current) ro.observe(canvasWrapRef.current);
    window.addEventListener('resize', onWinResize);
    return () => {
      window.removeEventListener('resize', onWinResize);
      ro.disconnect();
    };
  }, [loadedImage, fitToContainer]);

  // Recompute and center when image becomes available or viewportSize baseline changes
  useEffect(() => { fitToContainer();  }, [loadedImage, viewportSize.width, viewportSize.height, fitToContainer]);

  // Fit synchronously before paint when image becomes available
  useLayoutEffect(() => {
    if (!loadedImage) return;
    fitToContainer();
  }, [loadedImage, fitToContainer]);

  // Rendering is triggered by input handlers and initial load fit

  // Render function
  const renderCanvas = useCallback(() => {
    if (!canvasRef.current || !loadedImage) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d')!;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Apply transform
    ctx.save();
    ctx.translate(transform.translateX, transform.translateY);
    ctx.scale(transform.scale, transform.scale);

    // Draw base image at origin in image space (no additional offsets)
    ctx.drawImage(loadedImage, 0, 0, loadedImage.width, loadedImage.height);

    // Build red translucent overlay on an offscreen canvas clipped by the mask
    if (maskCanvasRef.current) {
      const maskCanvas = maskCanvasRef.current;
      const overlay = document.createElement('canvas');
      overlay.width = loadedImage.width;
      overlay.height = loadedImage.height;
      const octx = overlay.getContext('2d')!;
      // Fill red
      octx.fillStyle = 'rgba(239, 68, 68, 0.35)';
      octx.fillRect(0, 0, overlay.width, overlay.height);
      // Clip overlay by mask
      octx.globalCompositeOperation = 'destination-in';
      octx.drawImage(maskCanvas, 0, 0, overlay.width, overlay.height);
      octx.globalCompositeOperation = 'source-over';
      // Composite overlay over the base image
      ctx.drawImage(overlay, 0, 0, loadedImage.width, loadedImage.height);
    }

    ctx.restore();
  }, [loadedImage, transform]);

  // Ensure canvas re-renders on every transform or image change
  useEffect(() => {
    renderCanvas();
  }, [renderCanvas, transform, loadedImage]);

  // Post-clamp any transform change using current viewport to prevent drifting off-screen
  useEffect(() => {
    if (!loadedImage || !canvasRef.current) return;
    const wrap = canvasWrapRef.current;
    const rect = wrap?.getBoundingClientRect();
    const vw = Math.floor(rect?.width ?? wrap?.clientWidth ?? canvasRef.current.clientWidth ?? canvasRef.current.width);
    const vh = Math.floor(rect?.height ?? wrap?.clientHeight ?? canvasRef.current.clientHeight ?? canvasRef.current.height);
    if (!vw || !vh) return;
    const clamped = clampTransform(transform, loadedImage.width, loadedImage.height, vw, vh, true);
    const close = (a: number, b: number) => Math.abs(a - b) < 0.25; // avoid loops on tiny diffs
    if (!close(clamped.scale, transform.scale) || !close(clamped.translateX, transform.translateX) || !close(clamped.translateY, transform.translateY)) {
      setTransform(clamped);
    }
  }, [transform, loadedImage, clampTransform]);

  // Draw on mask function
  const drawOnMask = useCallback((points: { x: number; y: number }[], strokeWidthScreen: number, isErase: boolean) => {
    if (!maskCanvasRef.current || !loadedImage || points.length < 2) return;

    const maskCtx = maskCanvasRef.current.getContext('2d')!;
    maskCtx.lineCap = 'round';
    maskCtx.lineJoin = 'round';

    // Convert stroke width from screen to image space (uniform scale)
    const strokeWidth = Math.max(1, strokeWidthScreen / transform.scale);
    maskCtx.lineWidth = strokeWidth;

    // Set composite operation: draw adds to mask (opaque white), erase clears from mask
    maskCtx.globalCompositeOperation = isErase ? 'destination-out' : 'source-over';
    maskCtx.strokeStyle = 'white';

    maskCtx.beginPath();
    const p0 = screenToImage(points[0].x, points[0].y);
    maskCtx.moveTo(p0.x, p0.y);
    for (let i = 1; i < points.length; i++) {
      const pi = screenToImage(points[i].x, points[i].y);
      maskCtx.lineTo(pi.x, pi.y);
    }
    maskCtx.stroke();
    renderCanvas();
  }, [loadedImage, screenToImage, renderCanvas, transform.scale]);

  // Draw on mask using image-space coordinates directly
  const drawOnMaskImageSpace = useCallback((points: { x: number; y: number }[], strokeWidthImage: number, isErase: boolean) => {
    if (!maskCanvasRef.current || !loadedImage || points.length < 2) return;
    const maskCtx = maskCanvasRef.current.getContext('2d')!;
    maskCtx.lineCap = 'round';
    maskCtx.lineJoin = 'round';
    maskCtx.lineWidth = Math.max(1, strokeWidthImage);
    maskCtx.globalCompositeOperation = isErase ? 'destination-out' : 'source-over';
    maskCtx.strokeStyle = 'white';
    maskCtx.beginPath();
    maskCtx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      maskCtx.lineTo(points[i].x, points[i].y);
    }
    maskCtx.stroke();
    renderCanvas();
  }, [loadedImage, renderCanvas]);

  // Mouse/touch event handlers
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (!canvasRef.current || !loadedImage) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Track pointers for gestures
    pointersRef.current.set(e.pointerId, { x, y });

    const isModifierPan = e.altKey || e.ctrlKey || e.metaKey;
    const isTouch = e.pointerType === 'touch';

    if (isModifierPan) {
      isPanningRef.current = true;
      lastPanRef.current = { x, y };
      e.preventDefault();
      return;
    }

    if (isTouch && pointersRef.current.size >= 2) {
      // Start pinch/pan gesture, do not draw
      isPanningRef.current = true;
      lastPanRef.current = { x, y };
      e.preventDefault();
      return;
    }

    // Otherwise, potential drawing if inside intrinsic image bounds
    const imgPoint = screenToImage(x, y);
    if (imgPoint.x >= 0 && imgPoint.x <= loadedImage.width && imgPoint.y >= 0 && imgPoint.y <= loadedImage.height) {
      setIsDrawing(true);
      setCurrentPath([{ x, y }]);
      e.preventDefault();
    }
  }, [loadedImage, screenToImage]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x, y });
    }

    // Gesture: pinch to zoom and two-finger pan
    if (isPanningRef.current) {
      const points = Array.from(pointersRef.current.values());
      if (points.length >= 2 && loadedImage) {
        const [p1, p2] = points;
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;
        const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        // Store previous state on first detection
        const prev = (handlePointerMove as any)._prevGesture as undefined | { midX: number; midY: number; dist: number; scale: number; tx: number; ty: number };
        if (!prev) {
          (handlePointerMove as any)._prevGesture = { midX, midY, dist, scale: transform.scale, tx: transform.translateX, ty: transform.translateY };
        } else {
          const scaleFactor = dist / (prev.dist || dist || 1);
          let newScale = transform.scale * scaleFactor;
          // Zoom centered at midpoint
          const imgPt = screenToImage(prev.midX, prev.midY);
          newScale = Math.min(6, Math.max(0.75, newScale));
          const newTX = prev.midX - imgPt.x * newScale;
          const newTY = prev.midY - imgPt.y * newScale;
          const clamped = clampTransform({ scale: newScale, translateX: newTX, translateY: newTY }, loadedImage.width, loadedImage.height, viewportSize.width, viewportSize.height);
          setTransform(clamped);
          (handlePointerMove as any)._prevGesture = { midX, midY, dist, scale: clamped.scale, tx: clamped.translateX, ty: clamped.translateY };
        }
        e.preventDefault();
        return;
      }

      // Mouse/one-finger pan
      if (lastPanRef.current && loadedImage) {
        const dx = x - lastPanRef.current.x;
        const dy = y - lastPanRef.current.y;
        const next = clampTransform({ scale: transform.scale, translateX: transform.translateX + dx, translateY: transform.translateY + dy }, loadedImage.width, loadedImage.height, viewportSize.width, viewportSize.height);
        setTransform(next);
        lastPanRef.current = { x, y };
        e.preventDefault();
        return;
      }
    }

    // Drawing
    if (!isPanningRef.current && isDrawing) {
      const newPath = [...currentPath, { x, y }];
      setCurrentPath(newPath);
      if (newPath.length >= 2) {
        const lastTwoPoints = newPath.slice(-2);
        drawOnMask(lastTwoPoints, brushWidth[0], activeTool === 'erase');
      }
      e.preventDefault();
    }
  }, [brushWidth, activeTool, currentPath, isDrawing, drawOnMask, transform, loadedImage, viewportSize, clampTransform]);

  const handlePointerUp = useCallback((e?: React.PointerEvent) => {
    if (e && pointersRef.current.has(e.pointerId)) {
      pointersRef.current.delete(e.pointerId);
    }

    // End panning when no pointers or on mouse up
    if (pointersRef.current.size === 0) {
      isPanningRef.current = false;
      lastPanRef.current = null;
      (handlePointerMove as any)._prevGesture = undefined;
    }

    if (!isDrawing || currentPath.length < 2) {
      setIsDrawing(false);
      setCurrentPath([]);
      return;
    }

    // Save action to history (convert to image-space coords and width)
    const imagePoints = currentPath.map(p => screenToImage(p.x, p.y));
    const imageStrokeWidth = Math.max(1, brushWidth[0] / transform.scale);
    const action: DrawAction = {
      type: activeTool,
      points: imagePoints,
      strokeWidth: imageStrokeWidth
    };

    setActionHistory(prev => [...prev, action]);
    setIsDrawing(false);
    setCurrentPath([]);
  }, [isDrawing, currentPath, activeTool, brushWidth, handlePointerMove, screenToImage, transform.scale]);

  // Tool handlers
  const handleUndo = () => {
    if (actionHistory.length > 0) {
      setActionHistory(prev => prev.slice(0, -1));
      // Rebuild mask from remaining actions
      rebuildMask(actionHistory.slice(0, -1));
    }
  };

  const handleClearAll = () => {
    setActionHistory([]);
    if (maskCanvasRef.current && loadedImage) {
      const ctx = maskCanvasRef.current.getContext('2d')!;
      ctx.clearRect(0, 0, loadedImage.width, loadedImage.height);
      renderCanvas();
    }
  };

  const handleResetView = () => {
    if (!loadedImage || !canvasRef.current) return;
    const vw = canvasRef.current.clientWidth || canvasRef.current.width;
    const vh = canvasRef.current.clientHeight || canvasRef.current.height;
    const fitScale = Math.min(vw / loadedImage.width, vh / loadedImage.height);
    const tx = (vw - loadedImage.width * fitScale) / 2;
    const ty = (vh - loadedImage.height * fitScale) / 2;
    // Set exact centered fit (no clamping during reset)
    setTransform({ scale: fitScale, translateX: tx, translateY: ty });
  };

  const rebuildMask = useCallback((actions: DrawAction[]) => {
    if (!maskCanvasRef.current || !loadedImage) return;

    const ctx = maskCanvasRef.current.getContext('2d')!;
    ctx.clearRect(0, 0, loadedImage.width, loadedImage.height);

    actions.forEach(action => {
      drawOnMaskImageSpace(action.points, action.strokeWidth, action.type === 'erase');
    });
  }, [drawOnMaskImageSpace, loadedImage]);

  // Re-render when transform changes
  useEffect(() => {
    renderCanvas();
  }, [renderCanvas, transform]);

  // Wheel to zoom at cursor
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!loadedImage || !canvasRef.current) return;
    e.preventDefault();
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const delta = -e.deltaY; // up to zoom in
    const factor = Math.exp(delta * 0.0015);
    let newScale = transform.scale * factor;
    newScale = Math.min(6, Math.max(0.75, newScale));
    const imgPt = screenToImage(x, y);
    const newTX = x - imgPt.x * newScale;
    const newTY = y - imgPt.y * newScale;
    const clamped = clampTransform({ scale: newScale, translateX: newTX, translateY: newTY }, loadedImage.width, loadedImage.height, viewportSize.width, viewportSize.height);
    setTransform(clamped);
  }, [loadedImage, transform.scale, screenToImage, viewportSize, clampTransform]);

  // Start panning with Alt/Ctrl + drag
  const onPointerDownWrapper = useCallback((e: React.PointerEvent) => {
    handlePointerDown(e);
    if (e.altKey || e.ctrlKey || e.metaKey) {
      isPanningRef.current = true;
      const rect = (e.target as HTMLElement).getBoundingClientRect();
      lastPanRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }
  }, [handlePointerDown]);

  const handleNext = () => {
    navigate('/dimensions', { 
      state: { 
        originalImage: imageData,
        annotatedImage: imageData // For now, just pass original
      } 
    });
  };

  const handleBack = () => {
    navigate('/');
  };

  if (!imageData) {
    return (
      <div className="min-h-screen bg-gradient-surface flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-text-soft mb-4">No image selected</p>
          <Button onClick={() => navigate('/')}>Go Back</Button>
        </div>
      </div>
    );
  }

  return (
    <div 
      ref={containerRef}
      className="min-h-screen bg-gradient-surface p-4"
      style={{ 
        userSelect: 'none', 
        touchAction: 'none',
        WebkitUserSelect: 'none',
        MozUserSelect: 'none'
      }}
    >
      <div className="max-w-md mx-auto pt-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-6 animate-fade-in">
          <Button variant="ghost" size="icon" onClick={handleBack}>
            <ArrowLeft size={20} />
          </Button>
          <h1 className="text-xl font-bold text-foreground">Draw Selection</h1>
          <div className="w-10" />
        </div>

        {/* Canvas Container */}
        <div ref={canvasWrapRef} className="relative w-full min-h-[60vh] bg-surface rounded-xl shadow-card overflow-hidden mb-6 animate-bounce-in mx-auto">
          <canvas
            ref={canvasRef}
            className="absolute inset-0 touch-none"
            onPointerDown={onPointerDownWrapper}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onPointerLeave={handlePointerUp}
            onWheel={handleWheel}
            style={{ cursor: activeTool === 'draw' ? 'crosshair' : 'grab' }}
          />
          <canvas ref={maskCanvasRef} style={{ display: 'none' }} />
        </div>

        {/* Drawing Tools */}
        <div className="grid grid-cols-5 gap-3 mb-6">
          <Button
            variant={activeTool === "draw" ? "default" : "tool"}
            size="tool"
            onClick={() => setActiveTool("draw")}
            className="aspect-square"
          >
            <Pencil size={20} />
          </Button>
          <Button
            variant={activeTool === "erase" ? "default" : "tool"}
            size="tool"
            onClick={() => setActiveTool("erase")}
            className="aspect-square"
          >
            <Eraser size={20} />
          </Button>
          <Button
            variant="tool"
            size="tool"
            onClick={handleUndo}
            disabled={actionHistory.length === 0}
            className="aspect-square"
          >
            <Undo size={20} />
          </Button>
          <Button
            variant="tool"
            size="tool"
            onClick={handleClearAll}
            className="aspect-square"
          >
            <Trash2 size={20} />
          </Button>
          <Button
            variant="tool"
            size="tool"
            onClick={handleResetView}
            className="aspect-square"
            title="Reset View"
          >
            <RotateCcw size={20} />
          </Button>
        </div>

        {/* Brush Width Slider */}
        <div className="mb-6 bg-surface rounded-xl p-4 shadow-card">
          <label className="block text-sm font-medium text-foreground mb-3">
            Selection Size: {brushWidth[0]}px
          </label>
          <Slider
            value={brushWidth}
            onValueChange={setBrushWidth}
            max={50}
            min={5}
            step={1}
            className="w-full"
          />
        </div>

        {/* Next Button */}
        <Button onClick={handleNext} size="lg" className="w-full">
          <ArrowRight size={20} />
          Continue to Dimensions
        </Button>
      </div>
    </div>
  );
};

export default DrawingCanvas;