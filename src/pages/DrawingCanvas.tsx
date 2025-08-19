import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Canvas as FabricCanvas, PencilBrush, FabricImage } from "fabric";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Pencil, Eraser, Undo, Trash2, ArrowRight, ArrowLeft } from "lucide-react";

const DrawingCanvas = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fabricCanvas, setFabricCanvas] = useState<FabricCanvas | null>(null);
  const [activeTool, setActiveTool] = useState<"draw" | "erase">("draw");
  const [history, setHistory] = useState<any[]>([]);
  const [brushWidth, setBrushWidth] = useState([15]);
  const [backgroundImage, setBackgroundImage] = useState<FabricImage | null>(null);
  const imageData = location.state?.imageData;

  useEffect(() => {
    if (!canvasRef.current || !imageData) return;

    const canvas = new FabricCanvas(canvasRef.current, {
      width: 350,
      height: 400,
      backgroundColor: "#ffffff",
    });

    // Load the background image
    FabricImage.fromURL(imageData).then((img) => {
      const scaleX = 350 / img.width;
      const scaleY = 400 / img.height;
      const scale = Math.min(scaleX, scaleY);
      
      img.set({
        scaleX: scale,
        scaleY: scale,
        left: (350 - img.width * scale) / 2,
        top: (400 - img.height * scale) / 2,
        selectable: false,
        evented: false,
        excludeFromExport: false
      });
      
      canvas.add(img);
      canvas.sendObjectToBack(img);
      setBackgroundImage(img);
      canvas.renderAll();
      
      // Save initial state (empty selection)
      setTimeout(() => {
        setHistory([]);
      }, 100);
    });

    // Configure drawing brush for selection with destination-over for proper blending
    canvas.freeDrawingBrush = new PencilBrush(canvas);
    canvas.freeDrawingBrush.color = "rgba(239, 68, 68, 0.4)";
    canvas.freeDrawingBrush.width = brushWidth[0];
    canvas.isDrawingMode = true;

    setFabricCanvas(canvas);

    return () => {
      canvas.dispose();
    };
  }, [imageData]);

  useEffect(() => {
    if (!fabricCanvas) return;

    if (activeTool === "draw") {
      fabricCanvas.isDrawingMode = true;
      fabricCanvas.freeDrawingBrush.color = "rgba(239, 68, 68, 0.4)";
    } else if (activeTool === "erase") {
      fabricCanvas.isDrawingMode = true;
      fabricCanvas.freeDrawingBrush.color = "rgba(255, 255, 255, 1)";
    }
    fabricCanvas.freeDrawingBrush.width = brushWidth[0];
  }, [activeTool, fabricCanvas, brushWidth]);

  const handleToolChange = (tool: "draw" | "erase") => {
    setActiveTool(tool);
    if (fabricCanvas) {
      fabricCanvas.freeDrawingBrush.width = brushWidth[0];
    }
  };

  const handleUndo = () => {
    if (history.length > 0 && fabricCanvas && backgroundImage) {
      const newHistory = [...history];
      newHistory.pop();
      
      // Clear canvas and re-add background
      fabricCanvas.clear();
      fabricCanvas.add(backgroundImage);
      fabricCanvas.sendObjectToBack(backgroundImage);
      
      // Re-add all stroke objects from history
      newHistory.forEach(strokeData => {
        fabricCanvas.add(strokeData);
      });
      
      fabricCanvas.renderAll();
      setHistory(newHistory);
    }
  };

  const handleClearAll = () => {
    if (fabricCanvas && backgroundImage) {
      fabricCanvas.clear();
      fabricCanvas.add(backgroundImage);
      fabricCanvas.sendObjectToBack(backgroundImage);
      fabricCanvas.renderAll();
      setHistory([]);
    }
  };

  const handleNext = () => {
    if (fabricCanvas) {
      // Save the canvas state and navigate to dimensions
      const canvasData = fabricCanvas.toDataURL();
      navigate('/dimensions', { 
        state: { 
          originalImage: imageData,
          annotatedImage: canvasData 
        } 
      });
    }
  };

  const handleBack = () => {
    navigate('/');
  };

  // Save to history on path created
  useEffect(() => {
    if (!fabricCanvas) return;

    const saveToHistory = (e: any) => {
      // Only save stroke objects, not the background image
      if (e.path && e.path !== backgroundImage) {
        setHistory(prev => [...prev, e.path]);
      }
    };

    const handlePathCreated = (e: any) => {
      if (activeTool === "erase") {
        // For eraser, remove overlapping strokes instead of adding white strokes
        const eraserPath = e.path;
        const objectsToRemove: any[] = [];
        
        fabricCanvas.getObjects().forEach((obj: any) => {
          if (obj !== backgroundImage && obj !== eraserPath && obj.type === 'path') {
            // Check if this object intersects with the eraser path
            if (obj.intersectsWithObject(eraserPath)) {
              objectsToRemove.push(obj);
            }
          }
        });
        
        // Remove the eraser path itself and intersecting objects
        fabricCanvas.remove(eraserPath);
        objectsToRemove.forEach(obj => {
          fabricCanvas.remove(obj);
          // Remove from history too
          setHistory(prev => prev.filter(historyObj => historyObj !== obj));
        });
        
        fabricCanvas.renderAll();
      } else {
        saveToHistory(e);
      }
    };

    fabricCanvas.on('path:created', handlePathCreated);
    
    return () => {
      fabricCanvas.off('path:created', handlePathCreated);
    };
  }, [fabricCanvas, backgroundImage, activeTool]);

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

        {/* Canvas Container */}
        <div className="relative bg-surface rounded-xl shadow-card overflow-hidden mb-6 animate-bounce-in">
          <canvas
            ref={canvasRef}
            className="touch-none"
            style={{ display: 'block' }}
          />
        </div>

        {/* Drawing Tools */}
        <div className="grid grid-cols-4 gap-3 mb-6">
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
            disabled={history.length === 0}
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