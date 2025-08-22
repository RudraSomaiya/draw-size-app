import { useEffect, useRef, useState, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Pencil, Eraser, Undo, Trash2, ArrowRight, ArrowLeft, RotateCcw } from "lucide-react";

// Action types for drawing history - each action can be replayed to rebuild the mask
type DrawAction = {
  type: "draw" | "erase";
  points: { x: number; y: number }[];
  strokeWidth: number;
};

// Transform matrix for zoom/pan operations
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

  // Initialize canvas and load image
  useEffect(() => {
    if (!canvasRef.current || !maskCanvasRef.current || !imageData || !containerRef.current) return;

    // Calculate viewport size (92% width, max 72% height or 600px)
    const container = containerRef.current;
    const rect = container.getBoundingClientRect();
    const viewportWidth = Math.min(rect.width * 0.92, 400);
    const viewportHeight = Math.min(rect.height * 0.72, 600);
    
    setViewportSize({ width: viewportWidth, height: viewportHeight });

    // Load image
    const img = new Image();
    img.onload = () => {
      // Calculate image display rect (aspect-fit, centered)
      const imgAspect = img.width / img.height;
      const viewportAspect = viewportWidth / viewportHeight;
      
      let displayWidth, displayHeight, displayX, displayY;
      
      if (imgAspect > viewportAspect) {
        // Image is wider - fit by width
        displayWidth = viewportWidth;
        displayHeight = viewportWidth / imgAspect;
      } else {
        // Image is taller - fit by height
        displayHeight = viewportHeight;
        displayWidth = viewportHeight * imgAspect;
      }
      
      displayX = (viewportWidth - displayWidth) / 2;
      displayY = (viewportHeight - displayHeight) / 2;
      
      setImageRect({ x: displayX, y: displayY, width: displayWidth, height: displayHeight });
      setLoadedImage(img);
      
      // Setup canvas sizes
      const canvas = canvasRef.current!;
      const maskCanvas = maskCanvasRef.current!;
      
      canvas.width = viewportWidth;
      canvas.height = viewportHeight;
      maskCanvas.width = img.width;
      maskCanvas.height = img.height;
      
      // Initial render
      renderCanvas();
    };
    img.src = imageData;
  }, [imageData]);

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
    
    // Draw image
    ctx.drawImage(loadedImage, imageRect.x, imageRect.y, imageRect.width, imageRect.height);
    
    // Draw red overlay from mask
    if (maskCanvasRef.current) {
      const maskCanvas = maskCanvasRef.current;
      
      // Create red overlay
      ctx.fillStyle = 'rgba(239, 68, 68, 0.35)';
      ctx.fillRect(imageRect.x, imageRect.y, imageRect.width, imageRect.height);
      
      // Use mask to clip overlay
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(maskCanvas, imageRect.x, imageRect.y, imageRect.width, imageRect.height);
      ctx.globalCompositeOperation = 'source-over';
    }
    
    ctx.restore();
  }, [loadedImage, imageRect, transform]);

  // Draw on mask function
  const drawOnMask = useCallback((points: { x: number; y: number }[], strokeWidth: number, isErase: boolean) => {
    if (!maskCanvasRef.current || !loadedImage || points.length < 2) return;

    const maskCtx = maskCanvasRef.current.getContext('2d')!;
    maskCtx.lineWidth = strokeWidth;
    maskCtx.lineCap = 'round';
    maskCtx.lineJoin = 'round';
    
    // Set composite operation: draw adds to mask, erase removes from mask
    maskCtx.globalCompositeOperation = isErase ? 'destination-out' : 'source-over';
    maskCtx.strokeStyle = 'white';

    maskCtx.beginPath();
    // Convert screen coordinates to image coordinates
    const scale = imageRect.width / loadedImage.width;
    const offsetX = imageRect.x / scale;
    const offsetY = imageRect.y / scale;
    
    const firstPoint = screenToImage(points[0].x, points[0].y);
    maskCtx.moveTo((firstPoint.x - offsetX) / scale, (firstPoint.y - offsetY) / scale);
    
    for (let i = 1; i < points.length; i++) {
      const point = screenToImage(points[i].x, points[i].y);
      maskCtx.lineTo((point.x - offsetX) / scale, (point.y - offsetY) / scale);
    }
    
    maskCtx.stroke();
    renderCanvas();
  }, [imageRect, loadedImage, screenToImage, renderCanvas]);

  // Mouse/touch event handlers
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (!canvasRef.current || !loadedImage) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Check if point is inside image bounds
    const imgPoint = screenToImage(x, y);
    if (imgPoint.x >= imageRect.x && imgPoint.x <= imageRect.x + imageRect.width &&
        imgPoint.y >= imageRect.y && imgPoint.y <= imageRect.y + imageRect.height) {
      setIsDrawing(true);
      setCurrentPath([{ x, y }]);
      e.preventDefault();
    }
  }, [screenToImage, imageRect, loadedImage]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDrawing || !canvasRef.current) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const newPath = [...currentPath, { x, y }];
    setCurrentPath(newPath);
    
    // Draw stroke in real-time
    if (newPath.length >= 2) {
      const lastTwoPoints = newPath.slice(-2);
      drawOnMask(lastTwoPoints, brushWidth[0], activeTool === 'erase');
    }
    
    e.preventDefault();
  }, [isDrawing, currentPath, brushWidth, activeTool, drawOnMask]);

  const handlePointerUp = useCallback(() => {
    if (!isDrawing || currentPath.length < 2) {
      setIsDrawing(false);
      setCurrentPath([]);
      return;
    }

    // Save action to history
    const action: DrawAction = {
      type: activeTool,
      points: currentPath,
      strokeWidth: brushWidth[0]
    };
    
    setActionHistory(prev => [...prev, action]);
    setIsDrawing(false);
    setCurrentPath([]);
  }, [isDrawing, currentPath, activeTool, brushWidth]);

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
    setTransform({ scale: 1, translateX: 0, translateY: 0 });
  };

  const rebuildMask = useCallback((actions: DrawAction[]) => {
    if (!maskCanvasRef.current || !loadedImage) return;
    
    const ctx = maskCanvasRef.current.getContext('2d')!;
    ctx.clearRect(0, 0, loadedImage.width, loadedImage.height);
    
    actions.forEach(action => {
      drawOnMask(action.points, action.strokeWidth, action.type === 'erase');
    });
  }, [drawOnMask, loadedImage]);

  // Re-render when transform changes
  useEffect(() => {
    renderCanvas();
  }, [renderCanvas, transform]);

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
        <div className="relative bg-surface rounded-xl shadow-card overflow-hidden mb-6 animate-bounce-in mx-auto"
             style={{ width: viewportSize.width, height: viewportSize.height }}>
          <canvas
            ref={canvasRef}
            className="absolute inset-0 touch-none"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
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