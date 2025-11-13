import React, { useEffect, useRef, useState, useCallback, useLayoutEffect } from "react";
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
  const lastGestureRef = useRef<{ midX: number; midY: number; dist: number; scale: number; tx: number; ty: number } | null>(null);

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
  const [showBrushPreview, setShowBrushPreview] = useState(false);

  const imageData = location.state?.imageData;
  const restoredActionHistory = location.state?.actionHistory || [];

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

  // Restore action history when component loads (will be completed after rebuildMask is defined)
  useEffect(() => {
    if (restoredActionHistory.length > 0) {
      setActionHistory(restoredActionHistory);
    }
  }, [restoredActionHistory]);

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
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.5;
      ctx.drawImage(maskCanvasRef.current, 0, 0);
      ctx.globalAlpha = 1;
    }
    
    ctx.restore();
  }, [loadedImage, transform]);

  // Drawing functions
  const drawOnMaskImageSpace = useCallback((points: { x: number; y: number }[], strokeWidth: number, isErase: boolean = false) => {
    if (!maskCanvasRef.current || points.length < 2) return;

    const ctx = maskCanvasRef.current.getContext('2d')!;
    ctx.globalCompositeOperation = isErase ? 'destination-out' : 'source-over';
    ctx.strokeStyle = isErase ? 'rgba(0,0,0,1)' : 'rgba(255,0,0,0.8)';
    ctx.lineWidth = strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();
  }, []);

  const drawOnMask = useCallback((screenPoints: { x: number; y: number }[], strokeWidth: number, isErase: boolean = false) => {
    const imagePoints = screenPoints.map(p => screenToImage(p.x, p.y));
    const imageStrokeWidth = Math.max(1, strokeWidth / transform.scale);
    drawOnMaskImageSpace(imagePoints, imageStrokeWidth, isErase);
    renderCanvas();
  }, [screenToImage, transform.scale, drawOnMaskImageSpace, renderCanvas]);

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

    // Left mouse button for drawing
    if (e.button === 0) {
      const imgPoint = screenToImage(x, y);
      if (imgPoint.x >= 0 && imgPoint.x <= loadedImage.width && imgPoint.y >= 0 && imgPoint.y <= loadedImage.height) {
        setIsDrawing(true);
        setCurrentPath([{ x, y }]);
      }
    }
  }, [loadedImage, screenToImage]);

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
      if (imgPoint.x >= 0 && imgPoint.x <= loadedImage.width && imgPoint.y >= 0 && imgPoint.y <= loadedImage.height) {
        const newPath = [...currentPath, { x, y }];
        setCurrentPath(newPath);
        if (newPath.length >= 2) {
          drawOnMask(newPath.slice(-2), brushWidth[0], activeTool === "erase");
        }
        e.preventDefault();
      }
    }
  }, [transform, isDrawing, currentPath, brushWidth, activeTool, loadedImage, screenToImage, drawOnMask, viewportSize, clampTransform]);

  const handlePointerUp = useCallback((e?: React.PointerEvent) => {
    if (e && pointersRef.current.has(e.pointerId)) {
      pointersRef.current.delete(e.pointerId);
    }

    if (pointersRef.current.size === 0) {
      isPanningRef.current = false;
      lastPanRef.current = null;
      lastGestureRef.current = null;
    }

    if (!isDrawing || currentPath.length < 2) {
      setIsDrawing(false);
      setCurrentPath([]);
      return;
    }

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
  }, [isDrawing, currentPath, activeTool, brushWidth, screenToImage, transform.scale]);

  // Tool handlers
  const handleUndo = () => {
    if (actionHistory.length > 0) {
      setActionHistory(prev => prev.slice(0, -1));
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

  // Rebuild mask when action history is restored
  useEffect(() => {
    if (restoredActionHistory.length > 0 && loadedImage) {
      rebuildMask(restoredActionHistory);
    }
  }, [restoredActionHistory, loadedImage, rebuildMask]);

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

  // Calculate mask coverage percentage
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
        actionHistory: actionHistory
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
            <h1 className="text-2xl font-bold text-foreground">Draw Selection</h1>
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
                <span className="text-sm">Draw</span>
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

          {/* Brush Size Control */}
          <div className="mb-8">
            <h3 className="text-lg font-semibold text-foreground mb-4">
              Selection Size: {brushWidth[0]}px
            </h3>
            
            <div className="flex justify-center mb-6">
              <div className="relative h-20 flex items-center justify-center">
                <div
                  className={`border-2 border-primary rounded-full bg-primary/20 transition-all duration-200 ${
                    showBrushPreview ? 'opacity-100 scale-100' : 'opacity-0 scale-75'
                  }`}
                  style={{
                    width: Math.min(brushWidth[0], 60),
                    height: Math.min(brushWidth[0], 60),
                  }}
                />
              </div>
            </div>
            
            <div
              onPointerEnter={() => setShowBrushPreview(true)}
              onPointerLeave={() => setShowBrushPreview(false)}
            >
              <Slider
                value={brushWidth}
                onValueChange={(value) => {
                  setBrushWidth(value);
                  setShowBrushPreview(true);
                }}
                onPointerUp={() => setShowBrushPreview(false)}
                max={50}
                min={5}
                step={1}
                className="w-full"
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="mb-8">
            <h3 className="text-lg font-semibold text-foreground mb-4">Actions</h3>
            <div className="space-y-3">
              <Button
                variant="outline"
                onClick={handleUndo}
                disabled={actionHistory.length === 0}
                className="w-full justify-start"
              >
                <Undo size={20} className="mr-2" />
                Undo
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
