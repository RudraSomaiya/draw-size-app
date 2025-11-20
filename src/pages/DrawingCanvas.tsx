import React, { useEffect, useRef, useState, useCallback, useLayoutEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Pencil, Eraser, Undo, Redo, Trash2, ArrowRight, ArrowLeft, RotateCcw } from "lucide-react";

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
  const sourceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const isPanningRef = useRef<boolean>(false);
  const lastPanRef = useRef<{ x: number; y: number } | null>(null);
  const lastGestureRef = useRef<{ midX: number; midY: number; dist: number; scale: number; tx: number; ty: number } | null>(null);

  // State
  const [activeTool, setActiveTool] = useState<"add" | "subtract">("add"); // quick select / deselect
  const [isDrawing, setIsDrawing] = useState(false);
  const [brushSize, setBrushSize] = useState(30);
  const undoStack = useRef<ImageData[]>([]);
  const redoStack = useRef<ImageData[]>([]);
  const [transform, setTransform] = useState<TransformMatrix>({ scale: 1, translateX: 0, translateY: 0 });
  const [imageRect, setImageRect] = useState<ImageRect>({ x: 0, y: 0, width: 0, height: 0 });
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [loadedImage, setLoadedImage] = useState<HTMLImageElement | null>(null);
  const [showBrushPreview, setShowBrushPreview] = useState(false);

  const imageData = location.state?.imageData;
  const imageId: string | undefined = location.state?.imageId;
  const restoredActionHistory = location.state?.actionHistory || [];
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
    if (!sourceCanvasRef.current) {
      sourceCanvasRef.current = document.createElement('canvas');
    }

    const img = new Image();
    img.onload = () => {
      setLoadedImage(img);
      
      const canvas = canvasRef.current!;
      const maskCanvas = maskCanvasRef.current!;
      const srcCanvas = sourceCanvasRef.current!;
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
      srcCanvas.width = img.width;
      srcCanvas.height = img.height;

      const sctx = srcCanvas.getContext('2d')!;
      sctx.clearRect(0, 0, img.width, img.height);
      sctx.drawImage(img, 0, 0);

      const fitScale = Math.min(viewportWidth / img.width, viewportHeight / img.height);
      const tx = (viewportWidth - img.width * fitScale) / 2;
      const ty = (viewportHeight - img.height * fitScale) / 2;
      
      setTransform({ scale: fitScale, translateX: tx, translateY: ty });
      setImageRect({ x: tx, y: ty, width: img.width * fitScale, height: img.height * fitScale });
    };
    img.src = imageData;
  }, [imageData]);

  // Initialize dims state and persist it when provided
  useEffect(() => {
    if (!imageId) return;
    if (initialRealDimensions) {
      setDims(initialRealDimensions);
      try { localStorage.setItem(`dims:${imageId}`, JSON.stringify(initialRealDimensions)); } catch {}
    }
  }, [imageId, initialRealDimensions]);

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

  // Color-aware brush: apply selection/deselection around a point in image-space
  // Uses a small connected region grow (flood-fill style) constrained by brush radius
  const applyBrush = useCallback((imgX: number, imgY: number, isAdd: boolean) => {
    if (!loadedImage || !maskCanvasRef.current || !sourceCanvasRef.current) return;

    const maskCanvas = maskCanvasRef.current;
    const srcCanvas = sourceCanvasRef.current;
    const srcCtx = srcCanvas.getContext('2d');
    const maskCtx = maskCanvas.getContext('2d');
    if (!srcCtx || !maskCtx) return;

    const radius = Math.max(4, brushSize / 2);
    const x0 = Math.max(0, Math.floor(imgX - radius));
    const y0 = Math.max(0, Math.floor(imgY - radius));
    const x1 = Math.min(loadedImage.width - 1, Math.ceil(imgX + radius));
    const y1 = Math.min(loadedImage.height - 1, Math.ceil(imgY + radius));
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    if (w <= 0 || h <= 0) return;

    const srcData = srcCtx.getImageData(x0, y0, w, h);
    const maskData = maskCtx.getImageData(x0, y0, w, h);
    const s = srcData.data;
    const m = maskData.data;

    const cx = Math.round(imgX) - x0;
    const cy = Math.round(imgY) - y0;
    const cIndex = (cy * w + cx) * 4;
    const cr = s[cIndex];
    const cg = s[cIndex + 1];
    const cb = s[cIndex + 2];

    // Slightly looser threshold so cement / wall tones are captured
    const threshold = 60; // color distance threshold
    const r2 = radius * radius;

    // Connected flood-fill within radius & color threshold
    const visited = new Uint8Array(w * h);
    const queue: number[] = [];
    const push = (qx: number, qy: number) => {
      if (qx < 0 || qx >= w || qy < 0 || qy >= h) return;
      const dx = qx - cx;
      const dy = qy - cy;
      if (dx * dx + dy * dy > r2) return;
      const qIndex = qy * w + qx;
      if (visited[qIndex]) return;
      visited[qIndex] = 1;
      queue.push(qx, qy);
    };

    push(cx, cy);

    while (queue.length) {
      const qy = queue.pop()!;
      const qx = queue.pop()!;
      const idx = (qy * w + qx) * 4;

      const r = s[idx];
      const g = s[idx + 1];
      const b = s[idx + 2];
      const dr = r - cr;
      const dg = g - cg;
      const db = b - cb;
      const dist2 = dr * dr + dg * dg + db * db;
      if (dist2 > threshold * threshold) {
        continue;
      }

      if (isAdd) {
        // Mark selected: solid red mask
        m[idx] = 255;
        m[idx + 1] = 0;
        m[idx + 2] = 0;
        m[idx + 3] = 255;
      } else {
        // Deselect: clear alpha
        m[idx + 3] = 0;
      }

      // Explore 4-neighbors
      push(qx + 1, qy);
      push(qx - 1, qy);
      push(qx, qy + 1);
      push(qx, qy - 1);
    }

    maskCtx.putImageData(maskData, x0, y0);
  }, [brushSize, loadedImage]);

  // Render canvas with image and mask overlay
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

    if (maskCanvasRef.current) {
      ctx.globalAlpha = 0.4;
      ctx.drawImage(maskCanvasRef.current, 0, 0);
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }, [loadedImage, transform]);

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

    // Left mouse button for quick select / deselect
    if (e.button === 0) {
      const imgPoint = screenToImage(x, y);
      if (
        imgPoint.x >= 0 && imgPoint.x <= loadedImage.width &&
        imgPoint.y >= 0 && imgPoint.y <= loadedImage.height &&
        maskCanvasRef.current && sourceCanvasRef.current
      ) {
        const maskCtx = maskCanvasRef.current.getContext('2d')!;
        const snapshot = maskCtx.getImageData(0, 0, loadedImage.width, loadedImage.height);
        undoStack.current.push(snapshot);
        redoStack.current = [];
        setIsDrawing(true);
        applyBrush(imgPoint.x, imgPoint.y, activeTool === 'add');
      }
    }
  }, [loadedImage, screenToImage, activeTool, renderCanvas, applyBrush]);

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

    if (!isPanningRef.current && isDrawing) {
      const imgPoint = screenToImage(x, y);
      applyBrush(imgPoint.x, imgPoint.y, activeTool === 'add');
      e.preventDefault();
      renderCanvas();
    }
  }, [transform, isDrawing, loadedImage, screenToImage, viewportSize, clampTransform, renderCanvas, activeTool, applyBrush]);

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
    setIsDrawing(false);
  }, [isDrawing]);

  // Tool handlers
  const handleUndo = () => {
    if (!maskCanvasRef.current || undoStack.current.length === 0 || !loadedImage) return;
    const maskCtx = maskCanvasRef.current.getContext('2d')!;
    const current = maskCtx.getImageData(0, 0, loadedImage.width, loadedImage.height);
    redoStack.current.push(current);
    const prev = undoStack.current.pop();
    if (prev) {
      maskCtx.putImageData(prev, 0, 0);
      renderCanvas();
    }
  };

  const handleRedo = () => {
    if (!maskCanvasRef.current || redoStack.current.length === 0 || !loadedImage) return;
    const maskCtx = maskCanvasRef.current.getContext('2d')!;
    const current = maskCtx.getImageData(0, 0, loadedImage.width, loadedImage.height);
    undoStack.current.push(current);
    const next = redoStack.current.pop();
    if (next) {
      maskCtx.putImageData(next, 0, 0);
      renderCanvas();
    }
  };

  const handleClearAll = () => {
    if (!maskCanvasRef.current || !loadedImage) return;
    const ctx = maskCanvasRef.current.getContext('2d')!;
    const current = ctx.getImageData(0, 0, loadedImage.width, loadedImage.height);
    undoStack.current.push(current);
    redoStack.current = [];
    ctx.clearRect(0, 0, loadedImage.width, loadedImage.height);
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

  // Calculate mask coverage percentage (from selection mask)
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
                variant={activeTool === 'add' ? 'default' : 'outline'}
                onClick={() => setActiveTool('add')}
                className="h-16 flex flex-col gap-2"
              >
                <Pencil size={24} />
                <span className="text-sm">Quick Select</span>
              </Button>
              <Button
                variant={activeTool === 'subtract' ? 'default' : 'outline'}
                onClick={() => setActiveTool('subtract')}
                className="h-16 flex flex-col gap-2"
              >
                <Eraser size={24} />
                <span className="text-sm">Quick Deselect</span>
              </Button>
            </div>
          </div>

          {/* Brush Size */}
          <div className="mb-8">
            <h3 className="text-lg font-semibold text-foreground mb-4">Brush Size</h3>
            <div className="space-y-2">
              <Slider
                value={[brushSize]}
                onValueChange={(v) => setBrushSize(v[0] || brushSize)}
                min={5}
                max={100}
                step={1}
              />
              <div className="text-sm text-text-soft">{brushSize.toFixed(0)} px</div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="mb-8">
            <h3 className="text-lg font-semibold text-foreground mb-4">Actions</h3>
            <div className="space-y-3">
              <Button
                variant="outline"
                onClick={handleUndo}
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
                cursor: activeTool === 'add' || activeTool === 'subtract' ? 'crosshair' : 'grab',
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
