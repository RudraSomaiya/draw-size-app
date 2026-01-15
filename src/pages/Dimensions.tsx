import { useEffect, useState } from "react";
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
  const { originalImage, annotatedImage, maskCoverage = 0, rects = [], imageId, realDimensions, orthographicImage, maskImage, deselectItems = [] as DeselectItem[], projectId, precomputedAnalysis } = location.state || {};

  const realWidth = realDimensions?.width ?? 0;
  const realHeight = realDimensions?.height ?? 0;

  // Normalize unit from backend (e.g. "meters" / "feet") into short codes for calculations
  const rawUnit = (realDimensions?.unit ?? "m") as string;
  const unit: "m" | "ft" = rawUnit === "meters" ? "m" : rawUnit === "feet" ? "ft" : (rawUnit as "m" | "ft");
  const unitLabel = unit === "m" ? "meters" : "feet";

  const hasRealDimensions = realWidth > 0 && realHeight > 0;
  const derivedTotalArea = hasRealDimensions ? realWidth * realHeight : 0;

  // Convert deselection linear dimensions to the same unit as realDimensions and subtract
  const convertToBaseUnit = (value: number, fromUnit: "m" | "ft", toUnit: "m" | "ft") => {
    if (fromUnit === toUnit) return value;
    const factor = 0.3048; // 1 ft in meters
    return fromUnit === "ft" && toUnit === "m" ? value * factor : value / factor;
  };

  const computedDeselectArea = hasRealDimensions
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
  const deselectArea = precomputedAnalysis?.deselectArea ?? computedDeselectArea;
  const totalArea = derivedTotalArea;
  const effectiveDeselectArea = precomputedAnalysis?.effectiveDeselectArea ?? (hasRealDimensions ? Math.min(deselectArea, totalArea) : 0);
  const usableArea = precomputedAnalysis?.usableArea ?? (hasRealDimensions ? Math.max(0, totalArea - effectiveDeselectArea) : 0);

  // Final cemented area (sq meters/feet) is the drawn mask percentage of usable area
  const cementedArea = precomputedAnalysis?.cementedArea ?? (hasRealDimensions ? (usableArea * (maskCoverage / 100)) : 0);
  const cementedPercent = precomputedAnalysis?.cementedPercent ?? (hasRealDimensions && totalArea > 0
    ? (cementedArea / totalArea) * 100
    : maskCoverage);

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
      cementedPercent,
      deselectItems,
    });
  }

  // Save analysis to backend when we have project/image context
  useEffect(() => {
    const saveAnalysis = async () => {
      if (!projectId || !imageId || !hasRealDimensions) return;
      try {
        const apiBase = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";
        const token = localStorage.getItem("access_token") || "";
        const body = {
          mask_coverage_percent: maskCoverage,
          deselect_area: deselectArea,
          effective_deselect_area: effectiveDeselectArea,
          usable_area: usableArea,
          cemented_area: cementedArea,
          cemented_percent: cementedPercent,
          real_width: realWidth,
          real_height: realHeight,
          real_unit: unit,
          deselections: deselectItems.map((item) => ({
            shape: item.shape,
            count: item.count,
            length: item.length,
            breadth: item.breadth,
            diameter: item.diameter,
            area: item.area,
            unit: item.unit,
          })),
          // Persist the cemented image so processed images can be reopened directly in summary
          cemented_image: annotatedImage,
        };

        await fetch(`${apiBase}/projects/${projectId}/images/${imageId}/analysis`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        });
      } catch (err) {
        // Swallow errors here; user still sees UI
        // eslint-disable-next-line no-console
        console.error("Failed to save analysis", err);
      }
    };

    saveAnalysis();
  }, [projectId, imageId, hasRealDimensions, maskCoverage, deselectArea, effectiveDeselectArea, usableArea, cementedArea, cementedPercent, realWidth, realHeight, unit, deselectItems]);

  const handleBack = async () => {
    // If we still have orthographic + mask context from this session, allow going back to drawing
    if (orthographicImage && projectId && imageId) {
      navigate('/drawing', {
        state: {
          imageData: orthographicImage,
          originalImage,
          maskImage,
          deselectItems,
          rects,
          imageId,
          realDimensions,
          projectId,
        },
      });
      return;
    }

    // Otherwise, fall back to project list
    if (projectId) {
      navigate(`/projects/${projectId}`);
    } else {
      navigate('/');
    }
  };

  const handleNextImage = async () => {
    if (!projectId || !imageId) return;
    try {
      const apiBase = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";
      const token = localStorage.getItem("access_token") || "";

      const nextRes = await fetch(`${apiBase}/projects/${projectId}/images/${imageId}/next`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!nextRes.ok) {
        const err = await nextRes.json().catch(() => ({}));
        alert(err.detail || "All images in this project have been processed.");
        return;
      }

      const nextImage = await nextRes.json();

      const origRes = await fetch(`${apiBase}/projects/${projectId}/images/${nextImage.id}/original`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!origRes.ok) {
        const err = await origRes.json().catch(() => ({}));
        throw new Error(err.detail || `Failed to load next image (${origRes.status})`);
      }
      const origData = await origRes.json();

      navigate('/corners', {
        state: {
          projectId,
          imageId: nextImage.id,
          imageData: origData.image_data,
        },
      });
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error("Next image navigation failed", err);
      alert(err?.message || "Failed to load next image");
    }
  };

  const handleProcessAgain = async () => {
    if (!projectId || !imageId) return;

    const confirmed = window.confirm(
      "Re-process this image from the orthographic step? This will discard your current cement mask and de-selections for this session."
    );
    if (!confirmed) return;

    try {
      const apiBase = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";
      const token = localStorage.getItem("access_token") || "";

      const origRes = await fetch(`${apiBase}/projects/${projectId}/images/${imageId}/original`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!origRes.ok) {
        const err = await origRes.json().catch(() => ({}));
        throw new Error(err.detail || `Failed to load original image (${origRes.status})`);
      }
      const origData = await origRes.json();

      navigate('/corners', {
        state: {
          projectId,
          imageId,
          imageData: origData.image_data,
        },
      });
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error("Process again navigation failed", err);
      alert(err?.message || "Failed to restart processing for this image");
    }
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
                    {cementedPercent.toFixed(1)}%
                  </p>
                  <p className="text-sm text-primary/80">
                    ({cementedArea.toFixed(2)} {unit}² after subtracting openings)
                  </p>
                </div>

                {projectId && imageId && (
                  <div className="mt-6 flex flex-wrap gap-3 justify-between">
                    <div className="flex gap-3">
                      <Button variant="outline" onClick={handleProcessAgain}>
                        Process again
                      </Button>
                      <Button variant="outline" onClick={() => navigate(`/projects/${projectId}`)}>
                        Back to projects
                      </Button>
                    </div>
                    <Button variant="outline" onClick={handleNextImage}>
                      Next image in project
                    </Button>
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Dimensions;