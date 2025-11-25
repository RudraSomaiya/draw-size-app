import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ArrowLeft, Ruler } from "lucide-react";

const Dimensions = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { originalImage, annotatedImage, maskCoverage = 0, rects = [], imageId, realDimensions, orthographicImage, maskImage } = location.state || {};

  const realWidth = realDimensions?.width ?? 0;
  const realHeight = realDimensions?.height ?? 0;
  const unit = realDimensions?.unit ?? "m";
  const hasRealDimensions = realWidth > 0 && realHeight > 0;
  const totalArea = hasRealDimensions ? realWidth * realHeight : 0;
  const cementedArea = hasRealDimensions ? (totalArea * (maskCoverage / 100)) : 0;

  const handleBack = () => {
    navigate('/drawing', { 
      state: { 
        // go back to the orthographic image (without the baked-in mask)
        imageData: orthographicImage || annotatedImage,
        originalImage,
        maskImage,
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
        <div className="flex items-center justify-between mb-12 animate-fade-in">
          <Button variant="ghost" size="icon" onClick={handleBack}>
            <ArrowLeft size={24} />
          </Button>
          <h1 className="text-3xl font-bold text-foreground">
            Summary
          </h1>
          <div className="w-12" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
          {/* Left: Original and orthographic images */}
          <div className="space-y-6">
            <Card className="p-4 shadow-card animate-bounce-in">
              <div className="space-y-3">
                <h2 className="text-lg font-semibold text-foreground">Uploaded Image</h2>
                <div className="relative rounded-xl overflow-hidden bg-surface-soft">
                  <img
                    src={originalImage}
                    alt="Original"
                    className="w-full h-72 object-contain"
                  />
                </div>
              </div>
            </Card>

            <Card className="p-4 shadow-card animate-fade-in">
              <div className="space-y-3">
                <h2 className="text-lg font-semibold text-foreground">Orthographic with Cement Mask</h2>
                <div className="relative rounded-xl overflow-hidden bg-surface-soft">
                  <img
                    src={annotatedImage}
                    alt="Annotated"
                    className="w-full h-72 object-contain"
                  />
                </div>
              </div>
            </Card>
          </div>

          {/* Right: Dimensions and coverage details */}
          <Card className="p-8 shadow-card animate-fade-in">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 bg-primary-light rounded-xl">
                <Ruler className="text-primary" size={24} />
              </div>
              <div>
                <h2 className="font-semibold text-foreground">Dimensions & Coverage</h2>
                <p className="text-sm text-text-soft">Based on your orthographic selection</p>
              </div>
            </div>

            {!hasRealDimensions ? (
              <p className="text-sm text-text-soft">
                Real-world dimensions were not found. Please go back and enter them in the orthographic step.
              </p>
            ) : (
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-text-soft uppercase">Width</p>
                    <p className="text-lg font-semibold text-foreground">
                      {realWidth.toFixed(2)} {unit}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-text-soft uppercase">Height</p>
                    <p className="text-lg font-semibold text-foreground">
                      {realHeight.toFixed(2)} {unit}
                    </p>
                  </div>
                </div>

                <div className="space-y-1">
                  <p className="text-xs font-medium text-text-soft uppercase">Total Area</p>
                  <p className="text-xl font-bold text-primary">
                    {totalArea.toFixed(2)} {unit}²
                  </p>
                </div>

                <div className="space-y-2 mt-4">
                  <p className="text-xs font-medium text-text-soft uppercase">Cemented Area</p>
                  <p className="text-3xl font-extrabold text-primary">
                    {maskCoverage.toFixed(1)}%
                  </p>
                  <p className="text-sm text-primary/80">
                    ({cementedArea.toFixed(2)} {unit}² of the total area)
                  </p>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Dimensions;