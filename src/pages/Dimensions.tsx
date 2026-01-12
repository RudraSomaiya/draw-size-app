import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ArrowLeft, Ruler } from "lucide-react";

type DeselectShape = "rect" | "circle" | "irregular";

type DeselectItem = {
  id: string;
  shape: DeselectShape;
  count: number;
  length: number;
  breadth: number;
  diameter: number;
  unit: "m" | "ft";
  area?: number;
};

const Dimensions = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { originalImage, annotatedImage, maskCoverage = 0, rects = [], imageId, realDimensions, orthographicImage, maskImage, deselectItems = [] as DeselectItem[] } = location.state || {};

  const realWidth = realDimensions?.width ?? 0;
  const realHeight = realDimensions?.height ?? 0;

  // Normalize unit from backend (e.g. "meters" / "feet") into short codes for calculations
  const rawUnit = (realDimensions?.unit ?? "m") as string;
  const unit: "m" | "ft" = rawUnit === "meters" ? "m" : rawUnit === "feet" ? "ft" : (rawUnit as "m" | "ft");
  const unitLabel = unit === "m" ? "meters" : "feet";

  const hasRealDimensions = realWidth > 0 && realHeight > 0;
  const totalArea = hasRealDimensions ? realWidth * realHeight : 0;

  // Convert deselection linear dimensions to the same unit as realDimensions and subtract
  const convertToBaseUnit = (value: number, fromUnit: "m" | "ft", toUnit: "m" | "ft") => {
    if (fromUnit === toUnit) return value;
    const factor = 0.3048; // 1 ft in meters
    return fromUnit === "ft" && toUnit === "m" ? value * factor : value / factor;
  };

  const deselectArea = hasRealDimensions
    ? deselectItems.reduce((sum, item) => {
        const count = item.count || 0;
        if (count <= 0) return sum;

        let areaInUnit = 0;

        if (item.shape === "irregular") {
          // Direct area entry; convert square units if needed
          const a = Math.max(0, item.area || 0);
          if (item.unit === unit) {
            areaInUnit = a;
          } else {
            const factor = 0.3048; // linear ft->m
            const areaFactor = item.unit === "ft" && unit === "m" ? factor * factor : 1 / (factor * factor);
            areaInUnit = a * areaFactor;
          }
        } else {
          // Convert linear dimensions to the same unit as the main dimensions
          const lengthInUnit = convertToBaseUnit(item.length || 0, item.unit, unit);
          const breadthInUnit = convertToBaseUnit(item.breadth || 0, item.unit, unit);
          const diameterInUnit = convertToBaseUnit(item.diameter || 0, item.unit, unit);

          if (item.shape === "rect") {
            areaInUnit = Math.max(0, lengthInUnit) * Math.max(0, breadthInUnit);
          } else {
            const r = Math.max(0, diameterInUnit / 2);
            areaInUnit = Math.PI * r * r;
          }
        }

        return sum + count * areaInUnit;
      }, 0)
    : 0;

  // Usable facade area after subtracting fixed openings (windows/doors).
  // Openings cannot exceed the total facade area, so clamp deselectArea.
  const effectiveDeselectArea = hasRealDimensions ? Math.min(deselectArea, totalArea) : 0;
  const usableArea = hasRealDimensions ? Math.max(0, totalArea - effectiveDeselectArea) : 0;

  // Final cemented area (sq meters/feet) is the drawn mask percentage of usable area
  const cementedArea = hasRealDimensions ? (usableArea * (maskCoverage / 100)) : 0;

  if (hasRealDimensions) {
    // Debug logging to verify deselection & usable area math
    // eslint-disable-next-line no-console
    console.log("Area debug", {
      totalArea,
      maskCoverage,
      deselectArea,
      effectiveDeselectArea,
      usableArea,
      cementedArea,
      deselectItems,
    });
  }

  const handleBack = () => {
    navigate('/drawing', { 
      state: { 
        // go back to the orthographic image (without the baked-in mask)
        imageData: orthographicImage || annotatedImage,
        originalImage,
        maskImage,
        deselectItems,
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

                <div className="space-y-1 mt-2">
                  <p className="text-xs font-medium text-text-soft uppercase">Excluded Openings</p>
                  <p className="text-sm text-text-soft">
                    {deselectItems.length === 0
                      ? "No de-selections were applied."
                      : `${deselectItems.length} de-selection group${deselectItems.length > 1 ? "s" : ""} subtracting windows/doors from the cemented area.`}
                  </p>
                </div>

                <div className="space-y-2 mt-4">
                  <p className="text-xs font-medium text-text-soft uppercase">Cemented Area</p>
                  <p className="text-3xl font-extrabold text-primary">
                    {maskCoverage.toFixed(1)}%
                  </p>
                  <p className="text-sm text-primary/80">
                    ({cementedArea.toFixed(2)} {unit}² after subtracting openings)
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