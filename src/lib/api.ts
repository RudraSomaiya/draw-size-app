const API_BASE = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

export const getAccessToken = (): string | null => {
  return localStorage.getItem("access_token");
};

export const setAccessToken = (token: string | null) => {
  if (token) {
    localStorage.setItem("access_token", token);
  } else {
    localStorage.removeItem("access_token");
  }
};

export const apiFetch = async (path: string, options: RequestInit = {}) => {
  const token = getAccessToken();
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (token) {
    (headers as any)["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const err = await res.json();
      if (err?.detail) detail = err.detail;
    } catch {
      // ignore
    }
    throw new Error(detail);
  }

  if (res.status === 204) return null;
  return res.json();
};

export const apiFormFetch = async (path: string, formData: FormData, options: RequestInit = {}) => {
  const token = getAccessToken();
  const headers: HeadersInit = {
    ...(options.headers || {}),
  };

  if (token) {
    (headers as any)["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method: options.method || "POST",
    body: formData,
    headers,
  });

  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const err = await res.json();
      if (err?.detail) detail = err.detail;
    } catch {
      // ignore
    }
    throw new Error(detail);
  }

  if (res.status === 204) return null;
  return res.json();
};
