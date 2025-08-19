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
  const [history, setHistory] = useState<string[]>([]);
  const [brushWidth, setBrushWidth] = useState([15]);
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
        evented: false
      });
      
      canvas.add(img);
      canvas.sendObjectToBack(img);
      canvas.renderAll();
    });

    // Configure drawing brush for selection
    canvas.freeDrawingBrush = new PencilBrush(canvas);
    canvas.freeDrawingBrush.color = "rgba(239, 68, 68, 0.4)"; // Semi-transparent red
    canvas.freeDrawingBrush.width = brushWidth[0];
    canvas.isDrawingMode = true;

    // Save initial state
    setTimeout(() => {
      setHistory([canvas.toJSON()]);
    }, 100);

    setFabricCanvas(canvas);

    return () => {
      canvas.dispose();
    };
  }, [imageData]);

  useEffect(() => {
    if (!fabricCanvas) return;

    if (activeTool === "draw") {
      fabricCanvas.isDrawingMode = true;
      fabricCanvas.freeDrawingBrush.color = "rgba(239, 68, 68, 0.4)"; // Semi-transparent red for selection
    } else if (activeTool === "erase") {
      fabricCanvas.isDrawingMode = true;
      fabricCanvas.freeDrawingBrush.color = "rgba(255, 255, 255, 1)"; // White for erasing
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
    if (history.length > 1 && fabricCanvas) {
      const newHistory = [...history];
      newHistory.pop();
      const previousState = newHistory[newHistory.length - 1];
      
      fabricCanvas.loadFromJSON(previousState, () => {
        fabricCanvas.renderAll();
        setHistory(newHistory);
      });
    }
  };

  const handleClearAll = () => {
    if (fabricCanvas && imageData) {
      fabricCanvas.clear();
      
      // Reload background image
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
          evented: false
        });
        
        fabricCanvas.add(img);
        fabricCanvas.sendObjectToBack(img);
        fabricCanvas.renderAll();
        
        setTimeout(() => {
          setHistory([fabricCanvas.toJSON()]);
        }, 100);
      });
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

    const saveToHistory = () => {
      const currentState = fabricCanvas.toJSON();
      setHistory(prev => [...prev, currentState]);
    };

    fabricCanvas.on('path:created', saveToHistory);
    
    return () => {
      fabricCanvas.off('path:created', saveToHistory);
    };
  }, [fabricCanvas]);

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
            disabled={history.length <= 1}
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