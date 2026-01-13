import React, { useEffect, useRef, useState, useCallback, useLayoutEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Pencil, Eraser, Undo, Redo, Trash2, ArrowRight, ArrowLeft, RotateCcw, Droplet, Plus, Square, Circle, ChevronLeft, ChevronRight, Shapes, X } from "lucide-react";

// Transform matrix for zoom/pan operations (image space -> screen space)
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

type DeselectShape = "rect" | "circle" | "irregular";

type DeselectItem = {
  id: string;
  shape: DeselectShape;
  count: number;
  length: number; // for rectangles: length
  breadth: number; // for rectangles: breadth
  diameter: number; // for circles
  unit: "m" | "ft";
  area?: number; // for irregular shapes: area value
};

const DrawingCanvas = () => {
  const location = useLocation();
  const navigate = useNavigate();
  
  // Canvas refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const sourceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const isPanningRef = useRef<boolean>(false);
  const lastPanRef = useRef<{ x: number; y: number } | null>(null);
  const lastGestureRef = useRef<{ midX: number; midY: number; dist: number; scale: number; tx: number; ty: number } | null>(null);

  // State
  const [activeTool, setActiveTool] = useState<"add" | "subtract" | "flood">("add"); // quick select / flood fill / deselect
  const [isDrawing, setIsDrawing] = useState(false);
  const [brushSize, setBrushSize] = useState(30);
  const undoStack = useRef<ImageData[]>([]);
  const redoStack = useRef<ImageData[]>([]);
  const [transform, setTransform] = useState<TransformMatrix>({ scale: 1, translateX: 0, translateY: 0 });
  const [imageRect, setImageRect] = useState<ImageRect>({ x: 0, y: 0, width: 0, height: 0 });
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [loadedImage, setLoadedImage] = useState<HTMLImageElement | null>(null);
  const [showBrushPreview, setShowBrushPreview] = useState(false);
  const [activeSidebarTab, setActiveSidebarTab] = useState<"annotate" | "deselect">("annotate");
  const [deselectItems, setDeselectItems] = useState<DeselectItem[]>([]);
  const [sidebarWidth] = useState(320);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [floodTolerance, setFloodTolerance] = useState(50);
  const previewHideTimeoutRef = useRef<number | null>(null);

  const projectId: string | undefined = location.state?.projectId;
  const imageData = location.state?.imageData;
  const originalImage = location.state?.originalImage;
  const restoredMaskImage = location.state?.maskImage as string | undefined;
  const restoredDeselectItems = location.state?.deselectItems as DeselectItem[] | undefined;
  const imageId: string | undefined = location.state?.imageId;
  const restoredActionHistory = location.state?.actionHistory || [];
  const initialRealDimensions = location.state?.realDimensions as { width: number; height: number; unit: string } | undefined;
  const [dims, setDims] = useState<{ width: number; height: number; unit: string } | undefined>(initialRealDimensions);

  // Screen to image coordinate conversion using inverse transform
  const screenToImage = useCallback((screenX: number, screenY: number) => {
    const { scale, translateX, translateY } = transform;
    const imageX = (screenX - translateX) / scale;
    const imageY = (screenY - translateY) / scale;
    return { x: imageX, y: imageY };
  }, [transform]);

  // Clamp transform to keep image at least partially within viewport and scale within bounds
  const clampTransform = useCallback((t: TransformMatrix, imgW: number, imgH: number, vw: number, vh: number, ignoreMinScale: boolean = false): TransformMatrix => {
    const fitScale = Math.min(vw / imgW, vh / imgH);
    const minScale = ignoreMinScale ? 0.1 : fitScale;
    const maxScale = 6;
    let scale = Math.min(maxScale, Math.max(minScale, t.scale));

    const imageScreenW = imgW * scale;
    const imageScreenH = imgH * scale;

    const eps = 0.5;
    const slack = 24;
    const minTX = imageScreenW > vw ? vw - imageScreenW - eps : (vw - imageScreenW) / 2 - slack;
    const maxTX = imageScreenW > vw ? 0 + eps : (vw - imageScreenW) / 2 + slack;
    const minTY = imageScreenH > vh ? vh - imageScreenH - eps : (vh - imageScreenH) / 2 - slack;
    const maxTY = imageScreenH > vh ? 0 + eps : (vh - imageScreenH) / 2 + slack;

    let translateX = Math.min(maxTX, Math.max(minTX, t.translateX));
    let translateY = Math.min(maxTY, Math.max(minTY, t.translateY));

    return { scale, translateX, translateY };
  }, []);

  // Sidebar has fixed width; no resize drag behavior

  // Render canvas with image and mask overlay
  const renderCanvas = useCallback(() => {
    if (!canvasRef.current || !loadedImage) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d')!;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const { scale, translateX, translateY } = transform;
    
    ctx.save();
    ctx.translate(translateX, translateY);
    ctx.scale(scale, scale);
    ctx.drawImage(loadedImage, 0, 0);

    if (maskCanvasRef.current) {
      ctx.globalAlpha = 0.4;
      ctx.drawImage(maskCanvasRef.current, 0, 0);
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }, [loadedImage, transform]);

  // Initialize canvas and load image, optionally restoring an existing mask
  useEffect(() => {
    if (!canvasRef.current || !imageData) return;
    
    if (!maskCanvasRef.current) {
      maskCanvasRef.current = document.createElement('canvas');
    }
    if (!sourceCanvasRef.current) {
      sourceCanvasRef.current = document.createElement('canvas');
    }

    const img = new Image();
    img.onload = () => {
      setLoadedImage(img);
      
      const canvas = canvasRef.current!;
      const maskCanvas = maskCanvasRef.current!;
      const srcCanvas = sourceCanvasRef.current!;
      const canvasWrap = canvasWrapRef.current!;
      
      // Use actual canvas wrapper dimensions
      const rect = canvasWrap.getBoundingClientRect();
      const viewportWidth = rect.width;
      const viewportHeight = rect.height;
      
      setViewportSize({ width: viewportWidth, height: viewportHeight });
      
      // Set canvas dimensions to match the display size
      canvas.width = viewportWidth;
      canvas.height = viewportHeight;
      canvas.style.width = `${viewportWidth}px`;
      canvas.style.height = `${viewportHeight}px`;
      
      maskCanvas.width = img.width;
      maskCanvas.height = img.height;
      srcCanvas.width = img.width;
      srcCanvas.height = img.height;

      const sctx = srcCanvas.getContext('2d')!;
      sctx.clearRect(0, 0, img.width, img.height);
      sctx.drawImage(img, 0, 0);

      // If we have a previously saved mask, restore it into the mask canvas
      if (restoredMaskImage) {
        const maskImg = new Image();
        maskImg.onload = () => {
          const mctx = maskCanvas.getContext('2d');
          if (!mctx) return;
          mctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
          mctx.drawImage(maskImg, 0, 0, maskCanvas.width, maskCanvas.height);
          renderCanvas();
        };
        maskImg.src = restoredMaskImage;
      }

      const fitScale = Math.min(viewportWidth / img.width, viewportHeight / img.height);
      const tx = (viewportWidth - img.width * fitScale) / 2;
      const ty = (viewportHeight - img.height * fitScale) / 2;
      
      setTransform({ scale: fitScale, translateX: tx, translateY: ty });
      setImageRect({ x: tx, y: ty, width: img.width * fitScale, height: img.height * fitScale });
    };
    img.src = imageData;
  }, [imageData, restoredMaskImage]);

  // Initialize dims state and persist it when provided
  useEffect(() => {
    if (!imageId) return;
    if (initialRealDimensions) {
      setDims(initialRealDimensions);
      try { localStorage.setItem(`dims:${imageId}`, JSON.stringify(initialRealDimensions)); } catch {}
    }
  }, [imageId, initialRealDimensions]);

  // Load dims from localStorage if not provided
  useEffect(() => {
    if (!imageId) return;
    if (dims) return;
    try {
      const raw = localStorage.getItem(`dims:${imageId}`);
      if (raw) {
        const parsed = JSON.parse(raw) as { width: number; height: number; unit: string };
        setDims(parsed);
      }
    } catch {}
  }, [imageId, dims]);

  // Restore deselection items when coming back from summary or from localStorage
  useEffect(() => {
    // 1) Prefer items passed via navigation state
    if (restoredDeselectItems) {
      setDeselectItems(restoredDeselectItems);
      if (imageId) {
        try {
          localStorage.setItem(`deselect:${imageId}`, JSON.stringify(restoredDeselectItems));
        } catch {}
      }
      return;
    }

    // 2) Otherwise, try to load any saved items for this imageId
    if (!imageId) return;
    try {
      const raw = localStorage.getItem(`deselect:${imageId}`);
      if (raw) {
        const parsed = JSON.parse(raw) as DeselectItem[];
        setDeselectItems(parsed);
      }
    } catch {}
  }, [restoredDeselectItems, imageId]);

  // Persist deselection items whenever they change
  useEffect(() => {
    if (!imageId) return;
    try {
      localStorage.setItem(`deselect:${imageId}`, JSON.stringify(deselectItems));
    } catch {}
  }, [imageId, deselectItems]);

  const handleAddDeselectItem = () => {
    setDeselectItems(prev => [
      ...prev,
      {
        id: `${Date.now()}-${prev.length}`,
        shape: "rect",
        count: 1,
        length: 1,
        breadth: 1,
        diameter: 1,
        unit: "m",
      },
    ]);
  };

  const updateDeselectItem = <K extends keyof DeselectItem>(id: string, key: K, value: DeselectItem[K]) => {
    setDeselectItems(prev => prev.map(item => (item.id === id ? { ...item, [key]: value } : item)));
  };

  // Color-aware brush: apply selection/deselection around a point in image-space
  // Uses a small connected region grow (flood-fill style) constrained by brush radius
  const applyBrush = useCallback((imgX: number, imgY: number, isAdd: boolean) => {
    if (!loadedImage || !maskCanvasRef.current || !sourceCanvasRef.current) return;

    const maskCanvas = maskCanvasRef.current;
    const srcCanvas = sourceCanvasRef.current;
    const srcCtx = srcCanvas.getContext('2d');
    const maskCtx = maskCanvas.getContext('2d');
    if (!srcCtx || !maskCtx) return;

    const radius = Math.max(4, brushSize / 2);
    const x0 = Math.max(0, Math.floor(imgX - radius));
    const y0 = Math.max(0, Math.floor(imgY - radius));
    const x1 = Math.min(loadedImage.width - 1, Math.ceil(imgX + radius));
    const y1 = Math.min(loadedImage.height - 1, Math.ceil(imgY + radius));
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    if (w <= 0 || h <= 0) return;

    const srcData = srcCtx.getImageData(x0, y0, w, h);
    const maskData = maskCtx.getImageData(x0, y0, w, h);
    const s = srcData.data;
    const m = maskData.data;

    const cx = Math.round(imgX) - x0;
    const cy = Math.round(imgY) - y0;
    const cIndex = (cy * w + cx) * 4;
    const cr = s[cIndex];
    const cg = s[cIndex + 1];
    const cb = s[cIndex + 2];

    // Slightly looser threshold so cement / wall tones are captured
    const threshold = 60; // color distance threshold
    const r2 = radius * radius;

    // Connected flood-fill within radius & color threshold
    const visited = new Uint8Array(w * h);
    const queue: number[] = [];
    const push = (qx: number, qy: number) => {
      if (qx < 0 || qx >= w || qy < 0 || qy >= h) return;
      const dx = qx - cx;
      const dy = qy - cy;
      if (dx * dx + dy * dy > r2) return;
      const qIndex = qy * w + qx;
      if (visited[qIndex]) return;
      visited[qIndex] = 1;
      queue.push(qx, qy);
    };

    push(cx, cy);

    while (queue.length) {
      const qy = queue.pop()!;
      const qx = queue.pop()!;
      const idx = (qy * w + qx) * 4;

      const r = s[idx];
      const g = s[idx + 1];
      const b = s[idx + 2];
      const dr = r - cr;
      const dg = g - cg;
      const db = b - cb;
      const dist2 = dr * dr + dg * dg + db * db;
      if (dist2 > threshold * threshold) {
        continue;
      }

      if (isAdd) {
        // Mark selected: solid red mask
        m[idx] = 255;
        m[idx + 1] = 0;
        m[idx + 2] = 0;
        m[idx + 3] = 255;
      } else {
        // Deselect: clear alpha
        m[idx + 3] = 0;
      }

      // Explore 4-neighbors
      push(qx + 1, qy);
      push(qx - 1, qy);
      push(qx, qy + 1);
      push(qx, qy - 1);
    }

    maskCtx.putImageData(maskData, x0, y0);
  }, [brushSize, loadedImage]);

  // Flood-fill brush: expand selection based on color tolerance from a seed point
  const applyFloodFill = useCallback((imgX: number, imgY: number) => {
    if (!loadedImage || !maskCanvasRef.current || !sourceCanvasRef.current) return;

    const maskCanvas = maskCanvasRef.current;
    const srcCanvas = sourceCanvasRef.current;
    const srcCtx = srcCanvas.getContext('2d');
    const maskCtx = maskCanvas.getContext('2d');
    if (!srcCtx || !maskCtx) return;

    const w = loadedImage.width;
    const h = loadedImage.height;

    const startX = Math.round(imgX);
    const startY = Math.round(imgY);
    if (startX < 0 || startX >= w || startY < 0 || startY >= h) return;

    const srcData = srcCtx.getImageData(0, 0, w, h);
    const maskData = maskCtx.getImageData(0, 0, w, h);
    const s = srcData.data;
    const m = maskData.data;

    const idx0 = (startY * w + startX) * 4;
    const cr = s[idx0];
    const cg = s[idx0 + 1];
    const cb = s[idx0 + 2];

    const tol2 = floodTolerance * floodTolerance;

    const visited = new Uint8Array(w * h);
    const queue: number[] = [];

    const push = (qx: number, qy: number) => {
      if (qx < 0 || qx >= w || qy < 0 || qy >= h) return;
      const qIndex = qy * w + qx;
      if (visited[qIndex]) return;
      visited[qIndex] = 1;
      queue.push(qx, qy);
    };

    push(startX, startY);

    while (queue.length) {
      const qy = queue.pop()!;
      const qx = queue.pop()!;
      const idx = (qy * w + qx) * 4;

      const r = s[idx];
      const g = s[idx + 1];
      const b = s[idx + 2];
      const dr = r - cr;
      const dg = g - cg;
      const db = b - cb;
      const dist2 = dr * dr + dg * dg + db * db;
      if (dist2 > tol2) {
        continue;
      }

      // Add to mask: solid red
      m[idx] = 255;
      m[idx + 1] = 0;
      m[idx + 2] = 0;
      m[idx + 3] = 255;

      // 4-connected neighbors
      push(qx + 1, qy);
      push(qx - 1, qy);
      push(qx, qy + 1);
      push(qx, qy - 1);
    }

    maskCtx.putImageData(maskData, 0, 0);
  }, [loadedImage, floodTolerance]);

  // (renderCanvas is declared above, before it is first used)

  // Event handlers
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (!loadedImage) return;

    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    pointersRef.current.set(e.pointerId, { x, y });

    // Right mouse button (button 2) for panning
    if (e.button === 2 || pointersRef.current.size > 1) {
      isPanningRef.current = true;
      lastPanRef.current = { x, y };
      e.preventDefault();
      return;
    }

    // Left mouse button for quick select / flood fill / deselect
    if (e.button === 0) {
      const imgPoint = screenToImage(x, y);
      if (
        imgPoint.x >= 0 && imgPoint.x <= loadedImage.width &&
        imgPoint.y >= 0 && imgPoint.y <= loadedImage.height &&
        maskCanvasRef.current && sourceCanvasRef.current
      ) {
        const maskCtx = maskCanvasRef.current.getContext('2d')!;
        const snapshot = maskCtx.getImageData(0, 0, loadedImage.width, loadedImage.height);
        undoStack.current.push(snapshot);
        redoStack.current = [];
        
        if (activeTool === 'flood') {
          // Single-click flood fill (no drag)
          applyFloodFill(imgPoint.x, imgPoint.y);
          setIsDrawing(false);
          renderCanvas();
        } else {
          // Quick select / deselect with drag
          setIsDrawing(true);
          applyBrush(imgPoint.x, imgPoint.y, activeTool === 'add');
        }
      }
    }
  }, [loadedImage, screenToImage, activeTool, renderCanvas, applyBrush, applyFloodFill]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!loadedImage) return;

    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x, y });
    }

    if (isPanningRef.current && lastPanRef.current) {
      const dx = x - lastPanRef.current.x;
      const dy = y - lastPanRef.current.y;
      
      const wrap = canvasWrapRef.current;
      const rect = wrap?.getBoundingClientRect();
      const vw = Math.round(rect?.width ?? viewportSize.width);
      const vh = Math.round(rect?.height ?? viewportSize.height);
      
      const newTransform = {
        ...transform,
        translateX: transform.translateX + dx,
        translateY: transform.translateY + dy
      };
      
      const clamped = clampTransform(newTransform, loadedImage.width, loadedImage.height, vw, vh, true);
      setTransform(clamped);
      lastPanRef.current = { x, y };
      e.preventDefault();
      return;
    }

    if (!isPanningRef.current && isDrawing) {
      const imgPoint = screenToImage(x, y);
      applyBrush(imgPoint.x, imgPoint.y, activeTool === 'add');
      e.preventDefault();
      renderCanvas();
    }
  }, [transform, isDrawing, loadedImage, screenToImage, viewportSize, clampTransform, renderCanvas, activeTool, applyBrush]);

  const handlePointerUp = useCallback((e?: React.PointerEvent) => {
    if (e && pointersRef.current.has(e.pointerId)) {
      pointersRef.current.delete(e.pointerId);
    }

    if (pointersRef.current.size === 0) {
      isPanningRef.current = false;
      lastPanRef.current = null;
      lastGestureRef.current = null;
    }

    if (!isDrawing) return;
    setIsDrawing(false);
  }, [isDrawing]);

  // Tool handlers
  const handleUndo = () => {
    if (!maskCanvasRef.current || undoStack.current.length === 0 || !loadedImage) return;
    const maskCtx = maskCanvasRef.current.getContext('2d')!;
    const current = maskCtx.getImageData(0, 0, loadedImage.width, loadedImage.height);
    redoStack.current.push(current);
    const prev = undoStack.current.pop();
    if (prev) {
      maskCtx.putImageData(prev, 0, 0);
      renderCanvas();
    }
  };

  const handleRedo = () => {
    if (!maskCanvasRef.current || redoStack.current.length === 0 || !loadedImage) return;
    const maskCtx = maskCanvasRef.current.getContext('2d')!;
    const current = maskCtx.getImageData(0, 0, loadedImage.width, loadedImage.height);
    undoStack.current.push(current);
    const next = redoStack.current.pop();
    if (next) {
      maskCtx.putImageData(next, 0, 0);
      renderCanvas();
    }
  };

  const handleClearAll = () => {
    if (!maskCanvasRef.current || !loadedImage) return;
    const ctx = maskCanvasRef.current.getContext('2d')!;
    const current = ctx.getImageData(0, 0, loadedImage.width, loadedImage.height);
    undoStack.current.push(current);
    redoStack.current = [];
    ctx.clearRect(0, 0, loadedImage.width, loadedImage.height);
    renderCanvas();
  };

  const handleResetView = () => {
    if (!loadedImage || !canvasRef.current) return;
    const vw = canvasRef.current.clientWidth || canvasRef.current.width;
    const vh = canvasRef.current.clientHeight || canvasRef.current.height;
    const fitScale = Math.min(vw / loadedImage.width, vh / loadedImage.height);
    const tx = (vw - loadedImage.width * fitScale) / 2;
    const ty = (vh - loadedImage.height * fitScale) / 2;
    setTransform({ scale: fitScale, translateX: tx, translateY: ty });
  };

  useEffect(() => {
    renderCanvas();
  }, [renderCanvas, transform, loadedImage]);

  // Handle window resize to update canvas dimensions
  useLayoutEffect(() => {
    const handleResize = () => {
      if (!canvasRef.current || !canvasWrapRef.current || !loadedImage) return;
      
      const canvas = canvasRef.current;
      const canvasWrap = canvasWrapRef.current;
      const rect = canvasWrap.getBoundingClientRect();
      
      canvas.width = rect.width;
      canvas.height = rect.height;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      
      setViewportSize({ width: rect.width, height: rect.height });
      renderCanvas();
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [loadedImage, renderCanvas]);

  // Add wheel zoom handler
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!loadedImage || !canvasWrapRef.current) return;

    e.preventDefault();
    
    const rect = canvasWrapRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.min(6, Math.max(0.1, transform.scale * zoomFactor));
    
    // Zoom around mouse position
    const imgPoint = screenToImage(mouseX, mouseY);
    const newTX = mouseX - imgPoint.x * newScale;
    const newTY = mouseY - imgPoint.y * newScale;
    
    const vw = rect.width;
    const vh = rect.height;
    const clamped = clampTransform({ scale: newScale, translateX: newTX, translateY: newTY }, loadedImage.width, loadedImage.height, vw, vh, true);
    setTransform(clamped);
  }, [loadedImage, transform, screenToImage, clampTransform]);

  const onPointerDownWrapper = useCallback((e: React.PointerEvent) => {
    handlePointerDown(e);
  }, [handlePointerDown]);

  // Calculate mask coverage percentage (from selection mask)
  const calculateMaskCoverage = useCallback(() => {
    if (!maskCanvasRef.current || !loadedImage) return 0;
    
    const maskCanvas = maskCanvasRef.current;
    const ctx = maskCanvas.getContext('2d')!;
    const imageData = ctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
    const pixels = imageData.data;
    
    let coveredPixels = 0;
    const totalPixels = maskCanvas.width * maskCanvas.height;
    
    // Count non-transparent pixels (drawn areas)
    for (let i = 3; i < pixels.length; i += 4) { // Check alpha channel
      if (pixels[i] > 0) { // If alpha > 0, pixel is covered
        coveredPixels++;
      }
    }
    
    return (coveredPixels / totalPixels) * 100;
  }, [loadedImage]);

  // Export an annotated image that combines the orthographic image with the cement mask overlay
  const exportAnnotatedImage = useCallback(() => {
    if (!loadedImage || !maskCanvasRef.current) return imageData;

    const offscreen = document.createElement('canvas');
    offscreen.width = loadedImage.width;
    offscreen.height = loadedImage.height;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return imageData;

    ctx.clearRect(0, 0, offscreen.width, offscreen.height);
    ctx.drawImage(loadedImage, 0, 0);

    ctx.globalAlpha = 0.4;
    ctx.drawImage(maskCanvasRef.current, 0, 0);
    ctx.globalAlpha = 1;

    return offscreen.toDataURL('image/png');
  }, [loadedImage, imageData]);

  const handleNext = () => {
    const coveragePercentage = calculateMaskCoverage();
    const annotated = exportAnnotatedImage();
    let maskImage: string | undefined;
    if (maskCanvasRef.current) {
      try {
        maskImage = maskCanvasRef.current.toDataURL('image/png');
      } catch {}
    }
    
    navigate('/dimensions', { 
      state: { 
        // true uploaded image from the very start of the flow
        originalImage: originalImage ?? imageData,
        annotatedImage: annotated,
        maskCoverage: coveragePercentage,
        orthographicImage: imageData,
        maskImage,
        deselectItems,
        imageId,
        realDimensions: dims,
        projectId,
      } 
    });
  };

  const handleBack = () => {
    if (projectId) {
      navigate(`/projects/${projectId}`);
    } else {
      navigate('/');
    }
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
      className="min-h-screen bg-gradient-surface overflow-hidden"
      style={{ 
        userSelect: 'none',
        WebkitUserSelect: 'none',
        MozUserSelect: 'none'
      }}
    >
      <div className="flex h-screen relative">
        {/* Left Sidebar - Tools & De-selections Panel */}
        <div
          className={`bg-surface border-r border-border flex flex-col transition-[width] duration-150 ease-out overflow-hidden ${
            isSidebarCollapsed ? 'p-0 border-r-0' : 'p-6'
          }`}
          style={{ width: isSidebarCollapsed ? 0 : sidebarWidth, minWidth: isSidebarCollapsed ? 0 : 260 }}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <Button variant="ghost" size="icon" onClick={handleBack}>
              <ArrowLeft size={24} />
            </Button>
            <h1 className="text-2xl font-bold text-foreground">Annotate</h1>
          </div>
          {/* Sidebar Tabs */}
          <div className="mb-4 grid grid-cols-2 gap-2 rounded-xl bg-surface-soft p-1">
            <button
              type="button"
              className={`h-10 rounded-lg text-sm font-medium transition-colors ${
                activeSidebarTab === 'annotate'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-transparent text-text-soft hover:text-foreground'
              }`}
              onClick={() => setActiveSidebarTab('annotate')}
            >
              Annotate
            </button>
            <button
              type="button"
              className={`h-10 rounded-lg text-sm font-medium transition-colors ${
                activeSidebarTab === 'deselect'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-transparent text-text-soft hover:text-foreground'
              }`}
              onClick={() => setActiveSidebarTab('deselect')}
            >
              De-select
            </button>
          </div>

          {/* Scrollable content area inside sidebar */}
          <div className="flex-1 min-h-0 mb-4">
            <ScrollArea className="h-full pr-2">
              {activeSidebarTab === 'annotate' ? (
                <div className="space-y-8">
                  {/* Tool Selection */}
                  <div>
                    <h3 className="text-lg font-semibold text-foreground mb-4">Tools</h3>
                    <div className="grid grid-cols-3 gap-3">
                      <Button
                        variant={activeTool === 'add' ? 'default' : 'outline'}
                        onClick={() => setActiveTool('add')}
                        className="h-16 flex flex-col gap-2"
                      >
                        <Pencil size={24} />
                        <span className="text-sm">Draw</span>
                      </Button>
                      <Button
                        variant={activeTool === 'subtract' ? 'default' : 'outline'}
                        onClick={() => setActiveTool('subtract')}
                        className="h-16 flex flex-col gap-2"
                      >
                        <Eraser size={24} />
                        <span className="text-sm">Erase</span>
                      </Button>
                      <Button
                        variant={activeTool === 'flood' ? 'default' : 'outline'}
                        onClick={() => setActiveTool('flood')}
                        className="h-16 flex flex-col gap-2"
                      >
                        <Droplet size={24} />
                        <span className="text-sm">Fill</span>
                      </Button>
                    </div>
                  </div>

                  {/* Brush Size */}
                  <div>
                    {activeTool === 'flood' ? (
                      <>
                        <h3 className="text-lg font-semibold text-foreground mb-4">Tolerance</h3>
                        <div className="space-y-2">
                          <Slider
                            value={[floodTolerance]}
                            onValueChange={(v) => setFloodTolerance(v[0] || floodTolerance)}
                            min={0}
                            max={120}
                            step={1}
                          />
                          <div className="text-sm text-text-soft">{floodTolerance.toFixed(0)}</div>
                        </div>
                      </>
                    ) : (
                      <>
                        <h3 className="text-lg font-semibold text-foreground mb-4">Brush Size</h3>
                        <div className="space-y-2">
                          <Slider
                            value={[brushSize]}
                            onValueChange={(v) => {
                              const val = v[0] || brushSize;
                              setBrushSize(val);
                              setShowBrushPreview(true);
                              if (previewHideTimeoutRef.current) window.clearTimeout(previewHideTimeoutRef.current);
                              previewHideTimeoutRef.current = window.setTimeout(() => setShowBrushPreview(false), 800);
                            }}
                            min={5}
                            max={100}
                            step={1}
                          />
                          <div className="text-sm text-text-soft">{brushSize.toFixed(0)} px</div>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div>
                    <h3 className="text-lg font-semibold text-foreground mb-4">Actions</h3>
                    <div className="space-y-3">
                      <Button
                        variant="outline"
                        onClick={handleUndo}
                        className="w-full justify-start"
                      >
                        <Undo size={20} className="mr-2" />
                        Undo
                      </Button>
                      <Button
                        variant="outline"
                        onClick={handleRedo}
                        className="w-full justify-start"
                      >
                        <Redo size={20} className="mr-2" />
                        Redo
                      </Button>
                      <Button
                        variant="outline"
                        onClick={handleClearAll}
                        className="w-full justify-start"
                      >
                        <Trash2 size={20} className="mr-2" />
                        Clear All
                      </Button>
                      <Button
                        variant="outline"
                        onClick={handleResetView}
                        className="w-full justify-start"
                      >
                        <RotateCcw size={20} className="mr-2" />
                        Reset View
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="text-lg font-semibold text-foreground">De-selections</h3>
                    <Button size="icon" variant="outline" onClick={handleAddDeselectItem}>
                      <Plus size={18} />
                    </Button>
                  </div>
                  <p className="text-xs text-text-soft mb-2">
                    Use this to subtract fixed areas like windows or doors from the cemented area.
                  </p>

                  {deselectItems.length === 0 && (
                    <p className="text-xs text-text-soft">
                      Click the + button to add your first de-selection.
                    </p>
                  )}

                  <div className="space-y-3">
                    {deselectItems.map((item) => (
                      <div
                        key={item.id}
                        className="rounded-xl border border-border bg-surface-soft p-3 space-y-3 relative"
                      >
                        <Button size="icon" variant="ghost" className="absolute top-2 right-2 h-6 w-6" onClick={() => setDeselectItems(prev => prev.filter(d => d.id !== item.id))}>
                          <X size={14} />
                        </Button>
                        {/* First row: Shape, Count, Unit */}
                        <div className="grid grid-cols-3 gap-2 items-end">
                          <div className="space-y-1">
                            <Label className="text-xs text-text-soft">Shape</Label>
                            <Select
                              value={item.shape}
                              onValueChange={(val) =>
                                updateDeselectItem(item.id, "shape", val as DeselectShape)
                              }
                            >
                              <SelectTrigger className="h-9 w-full px-2 text-xs [&>span:last-child]:hidden">
                                <SelectValue>
                                  {item.shape === 'circle' ? (
                                    <Circle className="w-3 h-3" />
                                  ) : item.shape === 'rect' ? (
                                    <Square className="w-3 h-3" />
                                  ) : (
                                    <Shapes className="w-3 h-3" />
                                  )}
                                </SelectValue>
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="rect">
                                  <div className="flex items-center gap-2">
                                    <Square className="w-3 h-3" />
                                    <span className="text-xs">Square / Rectangle</span>
                                  </div>
                                </SelectItem>
                                <SelectItem value="circle">
                                  <div className="flex items-center gap-2">
                                    <Circle className="w-3 h-3" />
                                    <span className="text-xs">Circle</span>
                                  </div>
                                </SelectItem>
                                <SelectItem value="irregular">
                                  <div className="flex items-center gap-2">
                                    <Shapes className="w-3 h-3" />
                                    <span className="text-xs">Irregular</span>
                                  </div>
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs text-text-soft">Count</Label>
                            <Input
                              type="text"
                              className="h-9 text-xs"
                              value={Number.isFinite(item.count) ? item.count : ""}
                              onChange={(e) => {
                                const num = Number(e.target.value);
                                updateDeselectItem(item.id, "count", num);
                              }}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs text-text-soft">Unit</Label>
                            <Select
                              value={item.unit}
                              onValueChange={(val) =>
                                updateDeselectItem(item.id, 'unit', val as 'm' | 'ft')
                              }
                            >
                              <SelectTrigger className="h-9 text-xs w-full">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {item.shape === 'irregular' ? (
                                  <>
                                    <SelectItem value="m">sq. meters</SelectItem>
                                    <SelectItem value="ft">sq. feet</SelectItem>
                                  </>
                                ) : (
                                  <>
                                    <SelectItem value="m">meters</SelectItem>
                                    <SelectItem value="ft">feet</SelectItem>
                                  </>
                                )}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        {/* Second row: Length/Breadth or Diameter */}
                        <div className="grid grid-cols-2 gap-2 items-end">
                          {item.shape === 'irregular' ? (
                            <div className="space-y-1 col-span-2">
                              <Label className="text-xs text-text-soft">Area</Label>
                              <Input
                                type="text"
                                className="h-9 text-xs"
                                value={Number.isFinite(item.area as number) ? item.area : ""}
                                onChange={(e) => {
                                  const num = Number(e.target.value);
                                  updateDeselectItem(item.id, 'area', num as unknown as DeselectItem['area']);
                                }}
                              />
                            </div>
                          ) : (
                            <>
                              <div className="space-y-1">
                                <Label className="text-xs text-text-soft">
                                  {item.shape === 'circle' ? 'Diameter' : 'Length'}
                                </Label>
                                <Input
                                  type="text"
                                  className="h-9 text-xs"
                                  value={
                                    item.shape === 'circle'
                                      ? (Number.isFinite(item.diameter) ? item.diameter : "")
                                      : (Number.isFinite(item.length) ? item.length : "")
                                  }
                                  onChange={(e) => {
                                    const num = Number(e.target.value);
                                    if (item.shape === 'circle') {
                                      updateDeselectItem(item.id, 'diameter', num);
                                    } else {
                                      updateDeselectItem(item.id, 'length', num);
                                    }
                                  }}
                                />
                              </div>
                              {item.shape === 'rect' && (
                                <div className="space-y-1">
                                  <Label className="text-xs text-text-soft">Breadth</Label>
                                  <Input
                                    type="text"
                                    className="h-9 text-xs"
                                    value={Number.isFinite(item.breadth) ? item.breadth : ""}
                                    onChange={(e) => {
                                      const num = Number(e.target.value);
                                      updateDeselectItem(item.id, 'breadth', num);
                                    }}
                                  />
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </ScrollArea>
          </div>

          {/* Confirm Button (shared for both tabs) */}
          <div className="mt-auto pt-2 border-t border-border/60">
            <Button onClick={handleNext} size="lg" className="w-full">
              <ArrowRight size={20} className="mr-2" />
              Confirm
            </Button>
          </div>
        </div>

        {/* Sidebar collapse toggle (no resize handle) */}
        <button
          type="button"
          onClick={() => setIsSidebarCollapsed(prev => !prev)}
          className="absolute top-1/2 -translate-y-1/2 z-10 rounded-full bg-surface shadow-card border border-border p-1 hover:bg-surface-soft"
          style={{ left: isSidebarCollapsed ? 8 : sidebarWidth + 8 }}
        >
          {isSidebarCollapsed ? (
            <ChevronRight size={16} />
          ) : (
            <ChevronLeft size={16} />
          )}
        </button>

        {/* Main Canvas Area */}
        <div className="flex-1 relative">
          <div 
            ref={canvasWrapRef} 
            className="w-full h-full bg-surface-soft overflow-hidden relative"
          >
            <canvas
              ref={canvasRef}
              className="w-full h-full"
              onPointerDown={onPointerDownWrapper}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onPointerLeave={handlePointerUp}
              onWheel={handleWheel}
              style={{ 
                cursor: activeTool === 'add' || activeTool === 'subtract' || activeTool === 'flood' ? 'crosshair' : 'grab',
                touchAction: 'none'
              }}
              onContextMenu={(e) => e.preventDefault()}
            />
            {showBrushPreview && (activeTool === 'add' || activeTool === 'subtract') && (
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                <div
                  className="rounded-full border border-primary/70"
                  style={{
                    width: Math.max(5, brushSize * transform.scale),
                    height: Math.max(5, brushSize * transform.scale),
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DrawingCanvas;
