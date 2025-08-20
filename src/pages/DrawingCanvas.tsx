import { useEffect, useRef, useState, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Canvas as FabricCanvas, FabricImage } from "fabric";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Pencil, Eraser, Undo, Trash2, ArrowRight, ArrowLeft, RotateCcw } from "lucide-react";

// Action types for drawing history - each action can be replayed to rebuild the mask
type DrawAction = {
  type: "draw" | "erase";
  points: { x: number; y: number }[];
  strokeWidth: number;
};

const DrawingCanvas = () => {
  const location = useLocation();
  const navigate = useNavigate();
  
  // Canvas refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  
  // Fabric canvas instances
  const [fabricCanvas, setFabricCanvas] = useState<FabricCanvas | null>(null);
  const [overlayCanvas, setOverlayCanvas] = useState<FabricCanvas | null>(null);
  
  // Canvas contexts
  const [maskContext, setMaskContext] = useState<CanvasRenderingContext2D | null>(null);
  const [overlayContext, setOverlayContext] = useState<CanvasRenderingContext2D | null>(null);
  
  // State
  const [activeTool, setActiveTool] = useState<"draw" | "erase">("draw");
  const [actionHistory, setActionHistory] = useState<DrawAction[]>([]);
  const [brushWidth, setBrushWidth] = useState([15]);
  const [backgroundImage, setBackgroundImage] = useState<FabricImage | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPath, setCurrentPath] = useState<{ x: number; y: number }[]>([]);
  const [imageScale, setImageScale] = useState(1);
  const [imageBounds, setImageBounds] = useState({ x: 0, y: 0, width: 350, height: 400 });
  
  const imageData = location.state?.imageData;

  // Initialize canvases with binary mask approach
  useEffect(() => {
    if (!canvasRef.current || !overlayCanvasRef.current || !maskCanvasRef.current || !imageData) return;

    // Initialize main canvas for image display with zoom/pan enabled
    const canvas = new FabricCanvas(canvasRef.current, {
      width: 350,
      height: 400,
      backgroundColor: "#ffffff",
      selection: false,
      allowTouchScrolling: true,
    });

    // Initialize overlay canvas for drawing interaction with zoom/pan
    const overlay = new FabricCanvas(overlayCanvasRef.current, {
      width: 350,
      height: 400,
      backgroundColor: "transparent",
      selection: false,
      allowTouchScrolling: true,
    });

    // Get overlay context for manual rendering of selection overlay
    const overlayCtx = overlayCanvasRef.current.getContext('2d');
    if (overlayCtx) {
      setOverlayContext(overlayCtx);
    }

    // Initialize mask canvas (offscreen binary mask)
    const maskCanvas = maskCanvasRef.current;
    maskCanvas.width = 350;
    maskCanvas.height = 400;
    const maskCtx = maskCanvas.getContext('2d');
    
    if (maskCtx) {
      // Clear mask to transparent (no selection initially)
      maskCtx.clearRect(0, 0, 350, 400);
      maskCtx.lineCap = 'round';
      maskCtx.lineJoin = 'round';
      setMaskContext(maskCtx);
    }

    // Load the background image
    FabricImage.fromURL(imageData).then((img) => {
      const scaleX = 350 / img.width;
      const scaleY = 400 / img.height;
      const scale = Math.min(scaleX, scaleY);
      
      const scaledWidth = img.width * scale;
      const scaledHeight = img.height * scale;
      const left = (350 - scaledWidth) / 2;
      const top = (400 - scaledHeight) / 2;
      
      img.set({
        scaleX: scale,
        scaleY: scale,
        left,
        top,
        selectable: false,
        evented: false,
        excludeFromExport: false
      });
      
      // Store image bounds for drawing area
      setImageBounds({
        x: left,
        y: top,
        width: scaledWidth,
        height: scaledHeight
      });
      
      canvas.add(img);
      canvas.sendObjectToBack(img);
      setBackgroundImage(img);
      canvas.renderAll();
      
      // Initialize empty history
      setActionHistory([]);
    });

    // Disable drawing mode - we handle drawing manually
    canvas.isDrawingMode = false;
    overlay.isDrawingMode = false;

    // Setup zoom/pan with synchronization between canvases
    const setupSyncedZoomPan = () => {
      let isDragging = false;
      let lastPosX = 0;
      let lastPosY = 0;

      // Zoom handling for overlay canvas (main interaction layer)
      overlay.on('mouse:wheel', (opt) => {
        const delta = opt.e.deltaY;
        let zoom = overlay.getZoom();
        zoom *= 0.999 ** delta;
        
        if (zoom > 3) zoom = 3;
        if (zoom < 0.5) zoom = 0.5;
        
        const pointer = overlay.getPointer(opt.e);
        overlay.zoomToPoint(pointer, zoom);
        
        // Sync with main canvas
        canvas.zoomToPoint(pointer, zoom);
        canvas.setViewportTransform([...overlay.viewportTransform!]);
        canvas.requestRenderAll();
        
        setImageScale(zoom);
        opt.e.preventDefault();
        opt.e.stopPropagation();
      });

      // Pan handling for overlay canvas
      overlay.on('mouse:down', (opt) => {
        const evt = opt.e;
        if (evt.altKey === true || evt.ctrlKey === true) {
          isDragging = true;
          overlay.selection = false;
          const pointer = overlay.getPointer(evt);
          lastPosX = pointer.x;
          lastPosY = pointer.y;
        }
      });

      overlay.on('mouse:move', (opt) => {
        if (isDragging) {
          const pointer = overlay.getPointer(opt.e);
          const vpt = overlay.viewportTransform;
          if (vpt) {
            vpt[4] += pointer.x - lastPosX;
            vpt[5] += pointer.y - lastPosY;
            overlay.requestRenderAll();
            
            // Sync with main canvas
            canvas.setViewportTransform([...vpt]);
            canvas.requestRenderAll();
            
            lastPosX = pointer.x;
            lastPosY = pointer.y;
          }
        }
      });

      overlay.on('mouse:up', () => {
        if (isDragging) {
          overlay.setViewportTransform(overlay.viewportTransform!);
          canvas.setViewportTransform([...overlay.viewportTransform!]);
          isDragging = false;
          overlay.selection = true;
        }
      });
    };

    setupSyncedZoomPan();

    setFabricCanvas(canvas);
    setOverlayCanvas(overlay);

    return () => {
      canvas.dispose();
      overlay.dispose();
    };
  }, [imageData]);

  // Function to draw stroke on mask with proper composite operation
  const drawOnMask = useCallback((points: { x: number; y: number }[], strokeWidth: number, isErase: boolean) => {
    if (!maskContext || points.length < 2) return;

    maskContext.lineWidth = strokeWidth;
    maskContext.strokeStyle = 'white'; // Binary mask uses white for selected areas
    
    // Set composite operation: draw adds to mask, erase removes from mask
    maskContext.globalCompositeOperation = isErase ? 'destination-out' : 'source-over';

    maskContext.beginPath();
    maskContext.moveTo(points[0].x, points[0].y);
    
    for (let i = 1; i < points.length; i++) {
      maskContext.lineTo(points[i].x, points[i].y);
    }
    
    maskContext.stroke();
  }, [maskContext]);

  // Function to render selection overlay using mask
  const renderSelectionOverlay = useCallback(() => {
    if (!overlayContext || !maskCanvasRef.current) return;

    // Clear overlay
    overlayContext.clearRect(0, 0, 350, 400);
    
    // Create red selection overlay
    overlayContext.fillStyle = 'rgba(239, 68, 68, 0.35)'; // Fixed opacity red
    overlayContext.fillRect(0, 0, 350, 400);
    
    // Use mask to clip the red overlay (only show red where mask is opaque)
    overlayContext.globalCompositeOperation = 'destination-in';
    overlayContext.drawImage(maskCanvasRef.current, 0, 0);
    
    // Reset composite operation
    overlayContext.globalCompositeOperation = 'source-over';
  }, [overlayContext]);

  // Rebuild mask from action history (used for undo)
  const rebuildMaskFromHistory = useCallback(() => {
    if (!maskContext) return;

    // Clear mask
    maskContext.clearRect(0, 0, 350, 400);
    
    // Replay all actions to rebuild mask
    actionHistory.forEach(action => {
      drawOnMask(action.points, action.strokeWidth, action.type === 'erase');
    });
    
    // Update overlay
    renderSelectionOverlay();
  }, [maskContext, actionHistory, drawOnMask, renderSelectionOverlay]);

  // Handle mouse/touch events for drawing
  useEffect(() => {
    if (!overlayCanvas) return;

    const handleMouseDown = (e: any) => {
      // Don't start drawing if user is panning (alt/ctrl key)
      if (e.e.altKey || e.e.ctrlKey) return;
      
      setIsDrawing(true);
      const pointer = overlayCanvas.getPointer(e.e);
      setCurrentPath([{ x: pointer.x, y: pointer.y }]);
    };

    const handleMouseMove = (e: any) => {
      if (!isDrawing || e.e.altKey || e.e.ctrlKey) return;
      
      const pointer = overlayCanvas.getPointer(e.e);
      const newPath = [...currentPath, { x: pointer.x, y: pointer.y }];
      setCurrentPath(newPath);
      
      // Draw current stroke on mask in real-time
      if (newPath.length >= 2) {
        const lastTwoPoints = newPath.slice(-2);
        drawOnMask(lastTwoPoints, brushWidth[0], activeTool === 'erase');
        renderSelectionOverlay();
      }
    };

    const handleMouseUp = () => {
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
    };

    // Add event listeners
    overlayCanvas.on('mouse:down', handleMouseDown);
    overlayCanvas.on('mouse:move', handleMouseMove);
    overlayCanvas.on('mouse:up', handleMouseUp);

    return () => {
      overlayCanvas.off('mouse:down', handleMouseDown);
      overlayCanvas.off('mouse:move', handleMouseMove);
      overlayCanvas.off('mouse:up', handleMouseUp);
    };
  }, [overlayCanvas, isDrawing, currentPath, brushWidth, activeTool, drawOnMask, renderSelectionOverlay]);

  // Handle tool changes
  const handleToolChange = (tool: "draw" | "erase") => {
    setActiveTool(tool);
  };

  // Handle undo - remove last action and rebuild mask
  const handleUndo = () => {
    if (actionHistory.length > 0) {
      const newHistory = actionHistory.slice(0, -1);
      setActionHistory(newHistory);
    }
  };

  // Update mask when history changes (for undo)
  useEffect(() => {
    rebuildMaskFromHistory();
  }, [actionHistory, rebuildMaskFromHistory]);

  // Handle clear all - reset mask and history
  const handleClearAll = () => {
    setActionHistory([]);
  };

  // Reset zoom and pan to fit image
  const handleResetView = () => {
    if (!fabricCanvas || !overlayCanvas || !backgroundImage) return;
    
    // Reset both canvases to default view
    fabricCanvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    overlayCanvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    fabricCanvas.setZoom(1);
    overlayCanvas.setZoom(1);
    setImageScale(1);
    
    fabricCanvas.renderAll();
    overlayCanvas.renderAll();
  };

  // Generate final image by combining original image with selection overlay
  const generateFinalImage = useCallback(() => {
    if (!fabricCanvas || !overlayCanvasRef.current) return null;

    // Create a temporary canvas to combine image and selection
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = 350;
    tempCanvas.height = 400;
    const tempCtx = tempCanvas.getContext('2d');
    
    if (!tempCtx) return null;

    // Draw the fabric canvas (image) to temp canvas
    const fabricCanvasData = fabricCanvas.toDataURL();
    const img = new Image();
    img.onload = () => {
      tempCtx.drawImage(img, 0, 0);
      // Draw the selection overlay on top
      tempCtx.drawImage(overlayCanvasRef.current!, 0, 0);
    };
    img.src = fabricCanvasData;
    
    return tempCanvas.toDataURL();
  }, [fabricCanvas]);

  const handleNext = () => {
    const finalImage = generateFinalImage();
    navigate('/dimensions', { 
      state: { 
        originalImage: imageData,
        annotatedImage: finalImage || imageData
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
          <Button onClick={() => navigate('/')}>
            Go Back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-surface p-4">
      <div className="max-w-md mx-auto pt-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-6 animate-fade-in">
          <Button variant="ghost" size="icon" onClick={handleBack}>
            <ArrowLeft size={20} />
          </Button>
          <h1 className="text-xl font-bold text-foreground">
            Draw Selection
          </h1>
          <div className="w-10" />
        </div>

        {/* Canvas Container - Stack canvases for layering */}
        <div className="relative bg-surface rounded-xl shadow-card overflow-hidden mb-6 animate-bounce-in">
          {/* Background image canvas */}
          <canvas
            ref={canvasRef}
            className="absolute inset-0"
            style={{ display: 'block' }}
          />
          {/* Selection overlay canvas */}
          <canvas
            ref={overlayCanvasRef}
            className="absolute inset-0 touch-none"
            style={{ display: 'block', pointerEvents: 'auto' }}
          />
          {/* Hidden mask canvas for binary mask storage */}
          <canvas
            ref={maskCanvasRef}
            style={{ display: 'none' }}
          />
        </div>

        {/* Drawing Tools */}
        <div className="grid grid-cols-5 gap-3 mb-6">
          <Button
            variant={activeTool === "draw" ? "default" : "tool"}
            size="tool"
            onClick={() => handleToolChange("draw")}
            className="aspect-square"
          >
            <Pencil size={20} />
          </Button>
          <Button
            variant={activeTool === "erase" ? "default" : "tool"}
            size="tool"
            onClick={() => handleToolChange("erase")}
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
          {imageScale !== 1 && (
            <p className="text-xs text-text-soft mt-2">
              Zoom: {Math.round(imageScale * 100)}% • Hold Alt/Ctrl + drag to pan
            </p>
          )}
        </div>

        {/* Next Button */}
        <Button
          onClick={handleNext}
          size="lg"
          className="w-full"
        >
          <ArrowRight size={20} />
          Continue to Dimensions
        </Button>
      </div>
    </div>
  );
};

export default DrawingCanvas;