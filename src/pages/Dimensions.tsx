import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Check, Ruler, ArrowLeftRight, ArrowUpDown } from "lucide-react";
import { toast } from "sonner";

const Dimensions = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [height, setHeight] = useState("");
  const [width, setWidth] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const { originalImage, annotatedImage, maskCoverage = 0, rects = [], imageId, realDimensions } = location.state || {};

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!height || !width) {
      toast.error("Please enter both height and width");
      return;
    }

    if (parseFloat(height) <= 0 || parseFloat(width) <= 0) {
      toast.error("Dimensions must be greater than 0");
      return;
    }

    setIsSubmitting(true);
    
    // Simulate processing
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    toast.success("Dimensions saved successfully!");
    setIsSubmitting(false);
    
    // Here you would typically send the data to your backend
    console.log({
      height: parseFloat(height),
      width: parseFloat(width),
      totalArea: parseFloat(height) * parseFloat(width),
      drawingCoverage: maskCoverage,
      originalImage,
      annotatedImage
    });
  };

  const handleBack = () => {
    navigate('/drawing', { 
      state: { 
        imageData: annotatedImage,
        rects: rects,
        imageId,
        realDimensions
      } 
    });
  };

  if (!originalImage || !annotatedImage) {
    return (
      <div className="min-h-screen bg-gradient-surface flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-text-soft mb-4">Missing image data</p>
          <Button onClick={() => navigate('/')}>
            Start Over
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-surface p-8">
      <div className="max-w-6xl mx-auto pt-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-12 animate-fade-in">
          <Button variant="ghost" size="icon" onClick={handleBack}>
            <ArrowLeft size={24} />
          </Button>
          <h1 className="text-3xl font-bold text-foreground">
            Enter Dimensions
          </h1>
          <div className="w-12" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
          {/* Preview Image with Dimension Arrows */}
          <Card className="p-8 shadow-card animate-bounce-in">
            <div className="relative">
              {/* Width Arrow - Horizontal */}
              <div className="absolute -top-10 left-0 right-0 flex items-center justify-center">
                <div className="flex items-center text-text-soft">
                  <ArrowLeftRight size={20} />
                  <span className="mx-3 text-sm font-medium">Width</span>
                  <ArrowLeftRight size={20} />
                </div>
              </div>
              
              {/* Height Arrow - Vertical */}
              <div className="absolute -left-10 top-0 bottom-0 flex items-center justify-center">
                <div className="flex flex-col items-center text-text-soft transform -rotate-90">
                  <ArrowUpDown size={20} />
                  <span className="mx-3 text-sm font-medium">Height</span>
                  <ArrowUpDown size={20} />
                </div>
              </div>

              {/* Image */}
              <div className="relative rounded-xl overflow-hidden bg-surface-soft">
                <img 
                  src={annotatedImage} 
                  alt="Annotated" 
                  className="w-full h-80 object-contain"
                />
              </div>
            </div>
          </Card>

          {/* Dimensions Form */}
          <Card className="p-8 shadow-card animate-fade-in">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-3 bg-primary-light rounded-xl">
              <Ruler className="text-primary" size={24} />
            </div>
            <div>
              <h2 className="font-semibold text-foreground">Actual Dimensions</h2>
              <p className="text-sm text-text-soft">Enter the real-world measurements</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="height" className="text-sm font-medium text-foreground flex items-center gap-2">
                <ArrowUpDown size={16} className="text-text-soft" />
                Height (meters)
              </Label>
              <Input
                id="height"
                type="number"
                step="0.01"
                min="0"
                placeholder="e.g., 2.5"
                value={height}
                onChange={(e) => setHeight(e.target.value)}
                className="h-12 rounded-xl border-border focus:border-primary"
                disabled={isSubmitting}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="width" className="text-sm font-medium text-foreground flex items-center gap-2">
                <ArrowLeftRight size={16} className="text-text-soft" />
                Width (meters)
              </Label>
              <Input
                id="width"
                type="number"
                step="0.01"
                min="0"
                placeholder="e.g., 3.0"
                value={width}
                onChange={(e) => setWidth(e.target.value)}
                className="h-12 rounded-xl border-border focus:border-primary"
                disabled={isSubmitting}
              />
            </div>

            <Button
              type="submit"
              size="lg"
              className="w-full mt-6"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary-foreground border-t-transparent mr-2" />
                  Processing...
                </>
              ) : (
                <>
                  <Check size={20} />
                  Complete
                </>
              )}
            </Button>
          </form>
          </Card>
        </div>

        {/* Summary */}
        {height && width && (
          <Card className="p-6 mt-8 bg-primary-light border-primary/20 animate-fade-in">
            <div className="text-center space-y-2">
              <p className="text-lg text-primary font-medium">
                Total Image Area: {(parseFloat(height) * parseFloat(width)).toFixed(2)} m²
              </p>
              <p className="text-xl text-primary font-bold">
                Drawing Coverage: {maskCoverage.toFixed(1)}%
              </p>
              <p className="text-sm text-primary/80">
                of the total image area
              </p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
};

export default Dimensions;