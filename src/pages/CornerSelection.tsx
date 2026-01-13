import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Check } from "lucide-react";

interface Point { x: number; y: number }

const CornerSelection: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { projectId, imageId, imageData: initialImageData } = (location.state || {}) as {
    projectId?: string;
    imageId?: string;
    imageData?: string;
  };

  const containerRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const [points, setPoints] = useState<Point[]>([]);
  const [realWidth, setRealWidth] = useState<string>("");
  const [realHeight, setRealHeight] = useState<string>("");
  const [imgNatural, setImgNatural] = useState<{w:number;h:number}>({ w: 0, h: 0 });
  const [submitting, setSubmitting] = useState(false);
  const [hoverPx, setHoverPx] = useState<{x:number;y:number}|null>(null);
  const [imageData, setImageData] = useState<string | undefined>(initialImageData);

  useEffect(() => {
    if (!imageId) {
      navigate("/");
      return;
    }

    if (initialImageData) {
      setImageData(initialImageData);
      return;
    }

    // If we only have projectId + imageId, fetch the original image from backend
    const fetchImage = async () => {
      if (!projectId) return;
      try {
        const apiBase = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";
        const res = await fetch(
          `${apiBase}/projects/${projectId}/images/${imageId}/original`,
          {
            headers: {
              Authorization: `Bearer ${localStorage.getItem("access_token") || ""}`,
            },
          }
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || `Failed to load image (${res.status})`);
        }
        const data = await res.json();
        setImageData(data.image_data);
      } catch (e: any) {
        console.error("Load image error:", e);
        navigate("/projects");
      }
    };

    if (projectId && !initialImageData) {
      fetchImage();
    }
  }, [imageId, initialImageData, projectId, navigate]);

  const onImageLoad = () => {
    const el = imgRef.current;
    if (el) setImgNatural({ w: el.naturalWidth, h: el.naturalHeight });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const containerW = (e.currentTarget as HTMLDivElement).clientWidth || rect.width;
    const containerH = (e.currentTarget as HTMLDivElement).clientHeight || rect.height;
    const imgW = imgNatural.w || 1;
    const imgH = imgNatural.h || 1;
    const imgAR = imgW / imgH;
    const containerAR = containerW / containerH;
    let displayedW: number;
    let displayedH: number;
    if (imgAR > containerAR) {
      displayedW = containerW;
      displayedH = containerW / imgAR;
    } else {
      displayedH = containerH;
      displayedW = containerH * imgAR;
    }
    const offsetX = (containerW - displayedW) / 2;
    const offsetY = (containerH - displayedH) / 2;
    if (sx < offsetX || sy < offsetY || sx > offsetX + displayedW || sy > offsetY + displayedH) {
      setHoverPx(null);
      return;
    }
    setHoverPx({ x: sx, y: sy });
  };

  const handleMouseLeave = () => setHoverPx(null);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current || !imgRef.current) return;
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();

    // Position within container content box
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    // Compute displayed image size within container for object-contain
    const containerW = (e.currentTarget as HTMLDivElement).clientWidth || rect.width;
    const containerH = (e.currentTarget as HTMLDivElement).clientHeight || rect.height;
    const imgW = imgNatural.w || 1;
    const imgH = imgNatural.h || 1;
    const imgAR = imgW / imgH;
    const containerAR = containerW / containerH;

    let displayedW: number;
    let displayedH: number;
    if (imgAR > containerAR) {
      displayedW = containerW;
      displayedH = containerW / imgAR;
    } else {
      displayedH = containerH;
      displayedW = containerH * imgAR;
    }

    const offsetX = (containerW - displayedW) / 2;
    const offsetY = (containerH - displayedH) / 2;

    // If clicked outside actual image bounds, ignore
    if (sx < offsetX || sy < offsetY || sx > offsetX + displayedW || sy > offsetY + displayedH) return;

    // Map to image pixel coords
    const ix = ((sx - offsetX) / displayedW) * imgW;
    const iy = ((sy - offsetY) / displayedH) * imgH;

    const px = Math.max(0, Math.min(imgW, Math.round(ix)));
    const py = Math.max(0, Math.min(imgH, Math.round(iy)));
    setPoints(prev => (prev.length < 4 ? [...prev, { x: px, y: py }] : prev));
  };

  const removeLast = () => setPoints(prev => prev.slice(0, -1));
  const resetPoints = () => setPoints([]);

  const canSubmit = useMemo(() => points.length === 4 && parseFloat(realWidth) > 0 && parseFloat(realHeight) > 0, [points, realWidth, realHeight]);

  const handleSubmit = async () => {
    if (!imageId) return;
    if (!canSubmit) return;
    try {
      setSubmitting(true);
      const apiBase = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";
      const form = new FormData();
      form.append("image_id", imageId);
      form.append("corners", JSON.stringify(points));
      form.append("height", String(parseFloat(realHeight)));
      form.append("width", String(parseFloat(realWidth)));

      const transformPath = projectId
        ? `/projects/${projectId}/images/${imageId}/transform`
        : "/transform";

      const res = await fetch(`${apiBase}${transformPath}`, { method: "POST", body: form });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Transform failed (${res.status})`);
      }
      const data = await res.json();

      // Navigate to drawing with transformed image, original uploaded image, and ids
      navigate("/drawing", {
        state: {
          projectId,
          imageId,
          imageData: data.transformed_image,
          originalImage: imageData,
          realDimensions: data.real_dimensions,
        },
      });
    } catch (e: any) {
      console.error("Transform error:", e);
      alert(e?.message || "Failed to transform image");
    } finally {
      setSubmitting(false);
    }
  };

  if (!imageId || !imageData) return null;

  return (
    <div className="min-h-screen bg-gradient-surface p-8">
      <div className="max-w-6xl mx-auto pt-8">
        <div className="flex items-center justify-between mb-6">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")}> 
            <ArrowLeft size={24} />
          </Button>
          <h1 className="text-2xl font-bold">Select 4 Corners & Enter Dimensions</h1>
          <div />
        </div>

        <div className="grid grid-cols-3 gap-8">
          <Card className="col-span-2 p-4">
            <div
              ref={containerRef}
              className="relative w-full h-[70vh] bg-surface-soft rounded-lg overflow-hidden cursor-crosshair"
              onClick={handleClick}
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
            >
              <img
                ref={imgRef}
                src={imageData}
                className="absolute inset-0 w-full h-full object-contain"
                onLoad={onImageLoad}
                alt="uploaded"
              />
              {points.map((p, i) => {
                if (!containerRef.current) return null;
                const rect = containerRef.current.getBoundingClientRect();

                const containerW = rect.width;
                const containerH = rect.height;
                const imgW = imgNatural.w || 1;
                const imgH = imgNatural.h || 1;
                const imgAR = imgW / imgH;
                const containerAR = containerW / containerH;

                let displayedW: number;
                let displayedH: number;
                if (imgAR > containerAR) {
                  displayedW = containerW;
                  displayedH = containerW / imgAR;
                } else {
                  displayedH = containerH;
                  displayedW = containerH * imgAR;
                }

                const offsetX = (containerW - displayedW) / 2;
                const offsetY = (containerH - displayedH) / 2;
                const px = offsetX + (p.x / imgW) * displayedW;
                const py = offsetY + (p.y / imgH) * displayedH;

                return (
                  <div
                    key={`${p.x}-${p.y}-${i}`}
                    className="absolute -translate-x-1/2 -translate-y-1/2"
                    style={{ left: px, top: py }}
                  >
                    <div className="w-4 h-4 rounded-full bg-primary border-2 border-white shadow" />
                    <div className="absolute -top-6 left-2 text-xs bg-black/70 text-white px-1.5 py-0.5 rounded">{i + 1}</div>
                  </div>
                );
              })}

              {hoverPx && (
                <div
                  className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                  style={{ left: hoverPx.x, top: hoverPx.y }}
                >
                  <div className="w-4 h-4 rounded-full border-2 border-primary bg-primary/20" />
                </div>
              )}
            </div>

            <div className="mt-4 flex gap-3">
              <Button variant="outline" onClick={removeLast} disabled={points.length === 0}>Undo Point</Button>
              <Button variant="outline" onClick={resetPoints} disabled={points.length === 0}>Reset</Button>
            </div>
          </Card>

          <Card className="p-6">
            <div className="space-y-6">
              <div>
                <Label className="mb-2 block">Real Width (meters)</Label>
                <Input type="number" min="0" step="0.01" value={realWidth} onChange={(e) => setRealWidth(e.target.value)} />
              </div>
              <div>
                <Label className="mb-2 block">Real Height (meters)</Label>
                <Input type="number" min="0" step="0.01" value={realHeight} onChange={(e) => setRealHeight(e.target.value)} />
              </div>

              <div className="text-sm text-muted-foreground">
                Click exactly 4 corners in order (top-left, top-right, bottom-right, bottom-left) for most accurate transform.
              </div>

              <Button className="w-full" onClick={handleSubmit} disabled={!canSubmit || submitting}>
                <Check className="mr-2" size={18} /> {submitting ? "Transforming..." : "Create Orthographic Image"}
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default CornerSelection;
