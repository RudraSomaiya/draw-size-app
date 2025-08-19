import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Canvas as FabricCanvas, PencilBrush } from "fabric";
import { Button } from "@/components/ui/button";
import { Pencil, Eraser, Undo, Trash2, ArrowRight, ArrowLeft } from "lucide-react";

const DrawingCanvas = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fabricCanvas, setFabricCanvas] = useState<FabricCanvas | null>(null);
  const [activeTool, setActiveTool] = useState<"draw" | "erase">("draw");
  const [history, setHistory] = useState<string[]>([]);
  const imageData = location.state?.imageData;

  useEffect(() => {
    if (!canvasRef.current || !imageData) return;

    const canvas = new FabricCanvas(canvasRef.current, {
      width: 350,
      height: 400,
      backgroundColor: "#ffffff",
    });

    // Load the background image
    const img = new Image();
    img.onload = () => {
      const scaleX = 350 / img.width;
      const scaleY = 400 / img.height;
      canvas.backgroundImage = imageData;
      canvas.renderAll();
    };
    img.src = imageData;

    // Configure drawing brush
    canvas.freeDrawingBrush = new PencilBrush(canvas);
    canvas.freeDrawingBrush.color = "#3b82f6";
    canvas.freeDrawingBrush.width = 3;
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
      fabricCanvas.freeDrawingBrush.color = "#3b82f6";
    } else if (activeTool === "erase") {
      fabricCanvas.isDrawingMode = true;
      fabricCanvas.freeDrawingBrush.color = "#ffffff";
      fabricCanvas.freeDrawingBrush.width = 10;
    }
  }, [activeTool, fabricCanvas]);

  const handleToolChange = (tool: "draw" | "erase") => {
    setActiveTool(tool);
    if (fabricCanvas) {
      if (tool === "draw") {
        fabricCanvas.freeDrawingBrush.width = 3;
      } else {
        fabricCanvas.freeDrawingBrush.width = 10;
      }
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
      const img = new Image();
      img.onload = () => {
        fabricCanvas.backgroundImage = imageData;
        fabricCanvas.renderAll();
        
        setTimeout(() => {
          setHistory([fabricCanvas.toJSON()]);
        }, 100);
      };
      img.src = imageData;
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