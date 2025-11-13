import React, { useEffect, useRef, useState, useCallback, useLayoutEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Pencil, Eraser, Undo, Redo, Trash2, ArrowRight, ArrowLeft, RotateCcw, Eye, EyeOff } from "lucide-react";

// Rectangle annotation type in image-space
type RectAnno = {
  id: string;
  x: number; // top-left in image pixels
  y: number;
  width: number;
  height: number;
  color?: string;
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
  const lastGestureRef = useRef<{ midX: number; midY: number; dist: number; scale: number; tx: number; ty: number } | null>(null);

  // State
  const [activeTool, setActiveTool] = useState<"draw" | "erase">("draw"); // draw = rectangle tool
  const [rects, setRects] = useState<RectAnno[]>([]);
  const [tempRect, setTempRect] = useState<RectAnno | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [showLabels, setShowLabels] = useState(true);
  const undoStack = useRef<RectAnno[][]>([]);
  const redoStack = useRef<RectAnno[][]>([]);
  const [transform, setTransform] = useState<TransformMatrix>({ scale: 1, translateX: 0, translateY: 0 });
  const [imageRect, setImageRect] = useState<ImageRect>({ x: 0, y: 0, width: 0, height: 0 });
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [loadedImage, setLoadedImage] = useState<HTMLImageElement | null>(null);
  const [showBrushPreview, setShowBrushPreview] = useState(false);

  const imageData = location.state?.imageData;
  const imageId: string | undefined = location.state?.imageId;
  const restoredActionHistory = location.state?.actionHistory || [];
  const restoredRects = (location.state?.rects as RectAnno[] | undefined) || [];
  const initialRealDimensions = location.state?.realDimensions as { width: number; height: number; unit: string } | undefined;
  const [dims, setDims] = useState<{ width: number; height: number; unit: string } | undefined>(initialRealDimensions);

  // Screen to image coordinate conversion using inverse transform
  const screenToImage = useCallback((screenX: number, screenY: number) => {
    const { scale, translateX, translateY } = transform;
    const imageX = (screenX - translateX) / scale;
    const imageY = (screenY - translateY) / scale;
    return { x: imageX, y: imageY };
  }, [transform]);

  // Clamp transform to keep image at least partially within viewport and scale within bounds
  const clampTransform = useCallback((t: TransformMatrix, imgW: number, imgH: number, vw: number, vh: number, ignoreMinScale: boolean = false): TransformMatrix => {
    const fitScale = Math.min(vw / imgW, vh / imgH);
    const minScale = ignoreMinScale ? 0.1 : fitScale;
    const maxScale = 6;
    let scale = Math.min(maxScale, Math.max(minScale, t.scale));

    const imageScreenW = imgW * scale;
    const imageScreenH = imgH * scale;

    const eps = 0.5;
    const slack = 24;
    const minTX = imageScreenW > vw ? vw - imageScreenW - eps : (vw - imageScreenW) / 2 - slack;
    const maxTX = imageScreenW > vw ? 0 + eps : (vw - imageScreenW) / 2 + slack;
    const minTY = imageScreenH > vh ? vh - imageScreenH - eps : (vh - imageScreenH) / 2 - slack;
    const maxTY = imageScreenH > vh ? 0 + eps : (vh - imageScreenH) / 2 + slack;

    let translateX = Math.min(maxTX, Math.max(minTX, t.translateX));
    let translateY = Math.min(maxTY, Math.max(minTY, t.translateY));

    return { scale, translateX, translateY };
  }, []);

  // Initialize canvas and load image
  useEffect(() => {
    if (!canvasRef.current || !imageData) return;
    
    if (!maskCanvasRef.current) {
      maskCanvasRef.current = document.createElement('canvas');
    }

    const img = new Image();
    img.onload = () => {
      setLoadedImage(img);
      
      const canvas = canvasRef.current!;
      const maskCanvas = maskCanvasRef.current!;
      const canvasWrap = canvasWrapRef.current!;
      
      // Use actual canvas wrapper dimensions
      const rect = canvasWrap.getBoundingClientRect();
      const viewportWidth = rect.width;
      const viewportHeight = rect.height;
      
      setViewportSize({ width: viewportWidth, height: viewportHeight });
      
      // Set canvas dimensions to match the display size
      canvas.width = viewportWidth;
      canvas.height = viewportHeight;
      canvas.style.width = `${viewportWidth}px`;
      canvas.style.height = `${viewportHeight}px`;
      
      maskCanvas.width = img.width;
      maskCanvas.height = img.height;

      const fitScale = Math.min(viewportWidth / img.width, viewportHeight / img.height);
      const tx = (viewportWidth - img.width * fitScale) / 2;
      const ty = (viewportHeight - img.height * fitScale) / 2;
      
      setTransform({ scale: fitScale, translateX: tx, translateY: ty });
      setImageRect({ x: tx, y: ty, width: img.width * fitScale, height: img.height * fitScale });
    };
    img.src = imageData;
  }, [imageData]);

  // Restore rectangles when provided via navigation state
  useEffect(() => {
    if (restoredRects.length > 0) {
      setRects(restoredRects);
    }
  }, [restoredRects]);

  // Initialize dims state and persist it when provided
  useEffect(() => {
    if (!imageId) return;
    if (initialRealDimensions) {
      setDims(initialRealDimensions);
      try { localStorage.setItem(`dims:${imageId}`, JSON.stringify(initialRealDimensions)); } catch {}
    }
  }, [imageId, initialRealDimensions]);

  // Load rects from localStorage if available for this imageId
  useEffect(() => {
    if (!imageId) return;
    try {
      const raw = localStorage.getItem(`rects:${imageId}`);
      if (raw) {
        const parsed = JSON.parse(raw) as RectAnno[];
        if (parsed && parsed.length > 0) setRects(parsed);
      }
    } catch {}
  }, [imageId]);

  // Load dims from localStorage if not provided
  useEffect(() => {
    if (!imageId) return;
    if (dims) return;
    try {
      const raw = localStorage.getItem(`dims:${imageId}`);
      if (raw) {
        const parsed = JSON.parse(raw) as { width: number; height: number; unit: string };
        setDims(parsed);
      }
    } catch {}
  }, [imageId, dims]);

  // Save rects to localStorage on change
  useEffect(() => {
    if (!imageId) return;
    try {
      localStorage.setItem(`rects:${imageId}`,(JSON.stringify(rects)));
    } catch {}
  }, [imageId, rects]);

  // Render canvas with image and rectangles overlay
  const renderCanvas = useCallback(() => {
    if (!canvasRef.current || !loadedImage) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d')!;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const { scale, translateX, translateY } = transform;
    
    ctx.save();
    ctx.translate(translateX, translateY);
    ctx.scale(scale, scale);
    ctx.drawImage(loadedImage, 0, 0);
    
    // Draw rectangles (existing)
    for (const r of rects) {
      ctx.save();
      ctx.strokeStyle = r.color || 'rgba(255,0,0,0.9)';
      ctx.fillStyle = 'rgba(255,0,0,0.15)';
      ctx.lineWidth = 2 / Math.max(1, 1);
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.width, r.height);
      ctx.fill();
      ctx.stroke();
      // Labels
      if (showLabels && dims) {
        const metersPerPixelX = dims.width / loadedImage.width;
        const metersPerPixelY = dims.height / loadedImage.height;
        const wM = Math.max(0, r.width * metersPerPixelX);
        const hM = Math.max(0, r.height * metersPerPixelY);
        const label = `${wM.toFixed(2)}m × ${hM.toFixed(2)}m`;
        ctx.font = '14px sans-serif';
        const pad = 4;
        const metrics = ctx.measureText(label);
        const lw = metrics.width + pad * 2;
        const lh = 18 + pad * 2;
        const lx = r.x + 4;
        const ly = r.y - lh - 4 < 0 ? r.y + 4 : r.y - lh - 4;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(lx, ly, lw, lh);
        ctx.fillStyle = 'white';
        ctx.fillText(label, lx + pad, ly + 14 + pad/2);
      }
      ctx.restore();
    }
    // Draw temp rectangle when dragging
    if (tempRect) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,0,0,0.9)';
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 2 / Math.max(1, 1);
      ctx.strokeRect(tempRect.x, tempRect.y, tempRect.width, tempRect.height);
      ctx.restore();
    }
    
    ctx.restore();
  }, [loadedImage, transform, rects, tempRect, showLabels, dims]);

  // Rect helpers
  const makeRectFromPoints = (ax: number, ay: number, bx: number, by: number): RectAnno => {
    const x = Math.min(ax, bx);
    const y = Math.min(ay, by);
    const w = Math.abs(bx - ax);
    const h = Math.abs(by - ay);
    return { id: crypto.randomUUID(), x, y, width: w, height: h, color: 'rgba(255,0,0,0.9)' };
  };
  const hitTestRect = (rx: number, ry: number): number => {
    for (let i = rects.length - 1; i >= 0; i--) {
      const r = rects[i];
      if (rx >= r.x && rx <= r.x + r.width && ry >= r.y && ry <= r.y + r.height) return i;
    }
    return -1;
  };

  // Event handlers
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (!loadedImage) return;

    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    pointersRef.current.set(e.pointerId, { x, y });

    // Right mouse button (button 2) for panning
    if (e.button === 2 || pointersRef.current.size > 1) {
      isPanningRef.current = true;
      lastPanRef.current = { x, y };
      e.preventDefault();
      return;
    }

    // Left mouse button for draw/erase
    if (e.button === 0) {
      const imgPoint = screenToImage(x, y);
      if (imgPoint.x >= 0 && imgPoint.x <= loadedImage.width && imgPoint.y >= 0 && imgPoint.y <= loadedImage.height) {
        if (activeTool === 'erase') {
          const idx = hitTestRect(imgPoint.x, imgPoint.y);
          if (idx !== -1) {
            undoStack.current.push([...rects]);
            redoStack.current = [];
            const next = [...rects];
            next.splice(idx, 1);
            setRects(next);
            renderCanvas();
          }
        } else {
          setIsDrawing(true);
          setTempRect({ id: 'temp', x: imgPoint.x, y: imgPoint.y, width: 0, height: 0, color: 'rgba(255,0,0,0.9)' });
        }
      }
    }
  }, [loadedImage, screenToImage, activeTool, rects, renderCanvas]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!loadedImage) return;

    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x, y });
    }

    if (isPanningRef.current && lastPanRef.current) {
      const dx = x - lastPanRef.current.x;
      const dy = y - lastPanRef.current.y;
      
      const wrap = canvasWrapRef.current;
      const rect = wrap?.getBoundingClientRect();
      const vw = Math.round(rect?.width ?? viewportSize.width);
      const vh = Math.round(rect?.height ?? viewportSize.height);
      
      const newTransform = {
        ...transform,
        translateX: transform.translateX + dx,
        translateY: transform.translateY + dy
      };
      
      const clamped = clampTransform(newTransform, loadedImage.width, loadedImage.height, vw, vh, true);
      setTransform(clamped);
      lastPanRef.current = { x, y };
      e.preventDefault();
      return;
    }

    if (!isPanningRef.current && isDrawing && tempRect) {
      const imgPoint = screenToImage(x, y);
      const r = makeRectFromPoints(tempRect.x, tempRect.y, imgPoint.x, imgPoint.y);
      setTempRect({ ...r, id: 'temp' });
      e.preventDefault();
      renderCanvas();
    }
  }, [transform, isDrawing, tempRect, loadedImage, screenToImage, viewportSize, clampTransform, renderCanvas]);

  const handlePointerUp = useCallback((e?: React.PointerEvent) => {
    if (e && pointersRef.current.has(e.pointerId)) {
      pointersRef.current.delete(e.pointerId);
    }

    if (pointersRef.current.size === 0) {
      isPanningRef.current = false;
      lastPanRef.current = null;
      lastGestureRef.current = null;
    }

    if (!isDrawing) return;
    if (tempRect && tempRect.width > 2 && tempRect.height > 2) {
      undoStack.current.push([...rects]);
      redoStack.current = [];
      setRects(prev => [...prev, { ...tempRect, id: crypto.randomUUID() }]);
    }
    setTempRect(null);
    setIsDrawing(false);
  }, [isDrawing, tempRect, rects]);

  // Tool handlers
  const handleUndo = () => {
    if (rects.length === 0) return;
    redoStack.current.push([...rects]);
    const prev = undoStack.current.pop();
    if (prev) setRects(prev);
  };

  const handleRedo = () => {
    const next = redoStack.current.pop();
    if (next) {
      undoStack.current.push([...rects]);
      setRects(next);
    }
  };

  const handleClearAll = () => {
    if (rects.length === 0) return;
    undoStack.current.push([...rects]);
    redoStack.current = [];
    setRects([]);
    if (maskCanvasRef.current && loadedImage) {
      const ctx = maskCanvasRef.current.getContext('2d')!;
      ctx.clearRect(0, 0, loadedImage.width, loadedImage.height);
    }
    renderCanvas();
  };

  const handleResetView = () => {
    if (!loadedImage || !canvasRef.current) return;
    const vw = canvasRef.current.clientWidth || canvasRef.current.width;
    const vh = canvasRef.current.clientHeight || canvasRef.current.height;
    const fitScale = Math.min(vw / loadedImage.width, vh / loadedImage.height);
    const tx = (vw - loadedImage.width * fitScale) / 2;
    const ty = (vh - loadedImage.height * fitScale) / 2;
    setTransform({ scale: fitScale, translateX: tx, translateY: ty });
  };

  const rebuildMask = useCallback(() => {
    if (!maskCanvasRef.current || !loadedImage) return;
    const ctx = maskCanvasRef.current.getContext('2d')!;
    ctx.clearRect(0, 0, loadedImage.width, loadedImage.height);
    // Fill rectangles onto mask for future coverage calculation
    ctx.fillStyle = 'rgba(255,0,0,1)';
    rects.forEach(r => ctx.fillRect(r.x, r.y, r.width, r.height));
  }, [loadedImage, rects]);

  // Rebuild mask when rects change
  useEffect(() => {
    rebuildMask();
    renderCanvas();
  }, [rects, rebuildMask, renderCanvas]);

  useEffect(() => {
    renderCanvas();
  }, [renderCanvas, transform, loadedImage]);

  // Handle window resize to update canvas dimensions
  useLayoutEffect(() => {
    const handleResize = () => {
      if (!canvasRef.current || !canvasWrapRef.current || !loadedImage) return;
      
      const canvas = canvasRef.current;
      const canvasWrap = canvasWrapRef.current;
      const rect = canvasWrap.getBoundingClientRect();
      
      canvas.width = rect.width;
      canvas.height = rect.height;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      
      setViewportSize({ width: rect.width, height: rect.height });
      renderCanvas();
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [loadedImage, renderCanvas]);

  // Add wheel zoom handler
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!loadedImage || !canvasWrapRef.current) return;

    e.preventDefault();
    
    const rect = canvasWrapRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.min(6, Math.max(0.1, transform.scale * zoomFactor));
    
    // Zoom around mouse position
    const imgPoint = screenToImage(mouseX, mouseY);
    const newTX = mouseX - imgPoint.x * newScale;
    const newTY = mouseY - imgPoint.y * newScale;
    
    const vw = rect.width;
    const vh = rect.height;
    const clamped = clampTransform({ scale: newScale, translateX: newTX, translateY: newTY }, loadedImage.width, loadedImage.height, vw, vh, true);
    setTransform(clamped);
  }, [loadedImage, transform, screenToImage, clampTransform]);

  const onPointerDownWrapper = useCallback((e: React.PointerEvent) => {
    handlePointerDown(e);
  }, [handlePointerDown]);

  // Calculate mask coverage percentage (from rects mask)
  const calculateMaskCoverage = useCallback(() => {
    if (!maskCanvasRef.current || !loadedImage) return 0;
    
    const maskCanvas = maskCanvasRef.current;
    const ctx = maskCanvas.getContext('2d')!;
    const imageData = ctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
    const pixels = imageData.data;
    
    let coveredPixels = 0;
    const totalPixels = maskCanvas.width * maskCanvas.height;
    
    // Count non-transparent pixels (drawn areas)
    for (let i = 3; i < pixels.length; i += 4) { // Check alpha channel
      if (pixels[i] > 0) { // If alpha > 0, pixel is covered
        coveredPixels++;
      }
    }
    
    return (coveredPixels / totalPixels) * 100;
  }, [loadedImage]);

  const handleNext = () => {
    const coveragePercentage = calculateMaskCoverage();
    
    navigate('/dimensions', { 
      state: { 
        originalImage: imageData,
        annotatedImage: imageData,
        maskCoverage: coveragePercentage,
        rects: rects,
        imageId,
        realDimensions: dims
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
      className="min-h-screen bg-gradient-surface overflow-hidden"
      style={{ 
        userSelect: 'none',
        WebkitUserSelect: 'none',
        MozUserSelect: 'none'
      }}
    >
      <div className="flex h-screen">
        {/* Left Sidebar - Tools Panel */}
        <div className="w-80 bg-surface border-r border-border p-6 flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <Button variant="ghost" size="icon" onClick={handleBack}>
              <ArrowLeft size={24} />
            </Button>
            <h1 className="text-2xl font-bold text-foreground">Annotate</h1>
          </div>

          {/* Tool Selection */}
          <div className="mb-8">
            <h3 className="text-lg font-semibold text-foreground mb-4">Tools</h3>
            <div className="grid grid-cols-2 gap-3">
              <Button
                variant={activeTool === 'draw' ? 'default' : 'outline'}
                onClick={() => setActiveTool('draw')}
                className="h-16 flex flex-col gap-2"
              >
                <Pencil size={24} />
                <span className="text-sm">Rectangle</span>
              </Button>
              <Button
                variant={activeTool === 'erase' ? 'default' : 'outline'}
                onClick={() => setActiveTool('erase')}
                className="h-16 flex flex-col gap-2"
              >
                <Eraser size={24} />
                <span className="text-sm">Erase</span>
              </Button>
            </div>
          </div>

          {/* Label toggle */}
          <div className="mb-8">
            <h3 className="text-lg font-semibold text-foreground mb-4">Labels</h3>
            <div className="grid grid-cols-2 gap-3">
              <Button
                variant={showLabels ? 'default' : 'outline'}
                onClick={() => setShowLabels(true)}
                className="h-12"
              >
                <Eye className="mr-2" size={18} /> Show
              </Button>
              <Button
                variant={!showLabels ? 'default' : 'outline'}
                onClick={() => setShowLabels(false)}
                className="h-12"
              >
                <EyeOff className="mr-2" size={18} /> Hide
              </Button>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="mb-8">
            <h3 className="text-lg font-semibold text-foreground mb-4">Actions</h3>
            <div className="space-y-3">
              <Button
                variant="outline"
                onClick={handleUndo}
                disabled={rects.length === 0}
                className="w-full justify-start"
              >
                <Undo size={20} className="mr-2" />
                Undo
              </Button>
              <Button
                variant="outline"
                onClick={handleRedo}
                className="w-full justify-start"
              >
                <Redo size={20} className="mr-2" />
                Redo
              </Button>
              <Button
                variant="outline"
                onClick={handleClearAll}
                className="w-full justify-start"
              >
                <Trash2 size={20} className="mr-2" />
                Clear All
              </Button>
              <Button
                variant="outline"
                onClick={handleResetView}
                className="w-full justify-start"
              >
                <RotateCcw size={20} className="mr-2" />
                Reset View
              </Button>
            </div>
          </div>

          {/* Continue Button */}
          <div className="mt-auto">
            <Button onClick={handleNext} size="lg" className="w-full">
              <ArrowRight size={20} className="mr-2" />
              Continue to Dimensions
            </Button>
          </div>
        </div>

        {/* Main Canvas Area */}
        <div className="flex-1 relative">
          <div 
            ref={canvasWrapRef} 
            className="w-full h-full bg-surface-soft overflow-hidden"
          >
            <canvas
              ref={canvasRef}
              className="w-full h-full"
              onPointerDown={onPointerDownWrapper}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onPointerLeave={handlePointerUp}
              onWheel={handleWheel}
              style={{ 
                cursor: activeTool === 'draw' ? 'crosshair' : 'grab',
                touchAction: 'none'
              }}
              onContextMenu={(e) => e.preventDefault()}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default DrawingCanvas;
