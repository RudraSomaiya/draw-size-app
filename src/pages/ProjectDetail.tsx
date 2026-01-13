import { useEffect, useState, useRef } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import { Upload } from "lucide-react";

interface Project {
  id: string;
  name: string;
  description?: string | null;
}

interface ProjectImage {
  id: string;
  original_filename: string;
  cemented_area?: number | null;
  cemented_percent?: number | null;
  status?: string;
}

const ProjectDetail = () => {
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [images, setImages] = useState<ProjectImage[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!projectId) return;
    const load = async () => {
      try {
        const projects = await apiFetch("/projects");
        const current = (projects || []).find((p: Project) => p.id === projectId) || null;
        if (!current) {
          navigate("/projects");
          return;
        }
        setProject(current);
        const imgs = await apiFetch(`/projects/${projectId}/images`);
        setImages(imgs || []);
      } catch (err: any) {
        console.error(err);
        navigate("/login");
      }
    };
    load();
  }, [navigate, projectId]);

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!projectId) return;
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const apiBase = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";
    const token = localStorage.getItem("access_token") || "";

    try {
      setUploading(true);
      const uploaded: ProjectImage[] = [];

      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) continue;
        const form = new FormData();
        form.append("file", file);
        const res = await fetch(`${apiBase}/projects/${projectId}/images/upload`, {
          method: "POST",
          body: form,
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || `Upload failed (${res.status})`);
        }
        const data = await res.json();
        uploaded.push(data);
      }

      if (uploaded.length > 0) {
        setImages((prev) => [...uploaded, ...prev]);
      }
    } catch (err: any) {
      console.error(err);
      alert(err?.message || "Failed to upload images");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleOpenImage = (img: ProjectImage) => {
    navigate("/corners", {
      state: {
        projectId,
        imageId: img.id,
      },
    });
  };

  const handleDeleteImage = async (img: ProjectImage) => {
    if (!projectId) return;
    if (!window.confirm("Delete this image? This cannot be undone.")) return;
    try {
      await apiFetch(`/projects/${projectId}/images/${img.id}`, { method: "DELETE" });
      setImages((prev) => prev.filter((i) => i.id !== img.id));
    } catch (err: any) {
      console.error(err);
      alert(err?.message || "Failed to delete image");
    }
  };

  const handleRenameImage = async (img: ProjectImage, newName: string) => {
    if (!projectId) return;
    const trimmed = newName.trim();
    if (!trimmed || trimmed === img.original_filename) return;
    try {
      const updated = await apiFetch(`/projects/${projectId}/images/${img.id}`, {
        method: "PATCH",
        body: JSON.stringify({ original_filename: trimmed }),
      });
      setImages((prev) => prev.map((i) => (i.id === img.id ? { ...i, ...updated } : i)));
    } catch (err: any) {
      console.error(err);
      alert(err?.message || "Failed to rename image");
    }
  };

  if (!projectId || !project) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-surface p-8">
      <div className="max-w-6xl mx-auto pt-8 space-y-8">
        <div className="flex items-center justify-between">
          <Button variant="ghost" asChild>
            <Link to="/projects">Back</Link>
          </Button>
          <div className="text-center">
            <h1 className="text-2xl font-bold text-foreground">{project.name}</h1>
            {project.description && (
              <p className="text-sm text-text-soft">{project.description}</p>
            )}
          </div>
          <div className="w-12" />
        </div>

        <Card className="p-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground mb-1">Upload wall images</h2>
            <p className="text-sm text-text-soft">Add one image at a time to start the analysis flow.</p>
          </div>
          <Button onClick={handleUploadClick} disabled={uploading}>
            <Upload className="mr-2" size={18} />
            {uploading ? "Uploading..." : "Upload image"}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFileChange}
          />
        </Card>

        <Card className="p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">Images</h2>
          {images.length === 0 ? (
            <p className="text-sm text-text-soft">No images yet. Upload one to begin.</p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {images.map((img) => (
                <div key={img.id} className="border border-border rounded-lg p-3 flex flex-col justify-between bg-surface-soft">
                  <div>
                    <p className="font-medium text-foreground mb-1">
                      <input
                        className="bg-transparent border-b border-transparent focus:border-primary outline-none text-sm w-full"
                        defaultValue={img.original_filename}
                        onBlur={(e) => handleRenameImage(img, e.target.value)}
                      />
                    </p>
                    {img.cemented_percent != null && (
                      <p className="text-xs text-text-soft mb-1">
                        Cemented: {img.cemented_percent.toFixed(1)}%
                      </p>
                    )}
                    {img.status && (
                      <p className="text-xs text-text-soft capitalize">Status: {img.status}</p>
                    )}
                  </div>
                  <div className="flex justify-between items-center mt-3">
                    <Button variant="outline" size="sm" onClick={() => handleOpenImage(img)}>
                      Open
                    </Button>
                    <Button variant="destructive" size="sm" onClick={() => handleDeleteImage(img)}>
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};

export default ProjectDetail;
