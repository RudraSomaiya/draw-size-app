import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiFetch, setAccessToken, getAccessToken } from "@/lib/api";

interface Project {
  id: string;
  name: string;
  description?: string | null;
  created_at: string;
}

const Projects = () => {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      navigate("/login");
      return;
    }
    const load = async () => {
      try {
        const data = await apiFetch("/projects");
        setProjects(data || []);
      } catch (err: any) {
        console.error(err);
        navigate("/login");
      }
    };
    load();
  }, [navigate]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      setLoading(true);
      const project = await apiFetch("/projects", {
        method: "POST",
        body: JSON.stringify({ name, description: description || undefined }),
      });
      setProjects((prev) => [project, ...prev]);
      setName("");
      setDescription("");
    } catch (err: any) {
      console.error(err);
      alert(err?.message || "Failed to create project");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this project? This cannot be undone.")) return;
    try {
      await apiFetch(`/projects/${id}`, { method: "DELETE" });
      setProjects((prev) => prev.filter((p) => p.id !== id));
    } catch (err: any) {
      console.error(err);
      alert(err?.message || "Failed to delete project");
    }
  };

  return (
    <div className="min-h-screen bg-gradient-surface p-8">
      <div className="max-w-5xl mx-auto pt-8 space-y-8">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold text-foreground">Projects</h1>
          <Button variant="outline" onClick={() => { setAccessToken(null); navigate("/login"); }}>
            Log out
          </Button>
        </div>

        <Card className="p-6">
          <form className="flex flex-col md:flex-row gap-4" onSubmit={handleCreate}>
            <Input
              placeholder="New project name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Input
              placeholder="Description (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <Button type="submit" disabled={loading}>
              {loading ? "Creating..." : "Create"}
            </Button>
          </form>
        </Card>

        <div className="grid gap-4 md:grid-cols-2">
          {projects.map((project) => (
            <Card key={project.id} className="p-4 flex flex-col justify-between">
              <div>
                <h2 className="text-lg font-semibold text-foreground mb-1">{project.name}</h2>
                {project.description && (
                  <p className="text-sm text-text-soft mb-1">{project.description}</p>
                )}
                <p className="text-xs text-text-soft">
                  Created on {new Date(project.created_at).toLocaleDateString()}
                </p>
              </div>
              <div className="flex justify-between items-center mt-4">
                <Button variant="outline" size="sm" asChild>
                  <Link to={`/projects/${project.id}`}>Open</Link>
                </Button>
                <Button variant="destructive" size="sm" onClick={() => handleDelete(project.id)}>
                  Delete
                </Button>
              </div>
            </Card>
          ))}
          {projects.length === 0 && (
            <p className="text-sm text-text-soft">No projects yet. Create one above to get started.</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default Projects;
