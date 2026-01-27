# Tech Stack & Hosting Notes

## Frontend
- **Framework**: React 18 + TypeScript
- **Build Tool**: Vite 5
- **UI**:
  - Tailwind CSS 3
  - shadcn-ui (Radix UI primitives)
  - Lucide icons
- **State/Data**: @tanstack/react-query
- **Other**: React Router, Recharts, date-fns, fabric.js

**Node.js runtime**: Node 18+ recommended

**Frontend commands**
- Install deps: `npm install`
- Dev server: `npm run dev`
- Production build: `npm run build`
- Preview built app: `npm run preview`

---

## Backend
- **Language**: Python 3.10+
- **Framework**: FastAPI
- **ASGI Server**: uvicorn
- **Image/Math**:
  - opencv-python
  - numpy
  - pillow
- **Config**: python-dotenv
- **Database**:
  - SQLAlchemy 2
  - asyncpg (PostgreSQL async driver)
- **Auth/Security**:
  - passlib[bcrypt], bcrypt
  - python-jose[cryptography]
  - email-validator

**Backend commands** (from `backend/`)
- Create venv: `python -m venv venv`
- Activate venv (Windows): `venv\Scripts\activate`
- Install deps: `pip install -r requirements.txt`
- Run dev server:
  - `python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`

API base URL (default): `http://localhost:8000`

**Backend hosting/VPS notes**
- Suitable targets:
  - Any Linux VPS (1–2 vCPU, 2–4 GB RAM is usually enough to start)
  - Platforms that support containerized FastAPI apps (Render, Railway, Fly.io, etc.)
- Typical production stack on a VPS:
  - App process: `uvicorn app.main:app --host 0.0.0.0 --port 8000`
  - DB: managed PostgreSQL service or PostgreSQL on the same VPS
- Expose only the reverse proxy port (80/443) to the internet; keep the uvicorn port internal.

**Persistent storage**
- Uploaded and processed images stored under `backend/storage/`. Will be changing to another storage option in postgres later
- Persistent disk/volume if data must be kept across deployments.

---

## Environment & Config
- **Env file**: project-level `.env`
- Typical values needed on a VPS:
  - DB connection URL (PostgreSQL via `asyncpg`)
  - JWT / auth secrets
  - CORS origins (frontend URL)

---

## High-Level Deployment Summary
- **Frontend**: Build with Vite → deploy static `dist/` to a static host or serve via nginx on a VPS.
- **Backend**: FastAPI + uvicorn on a VPS / container platform, fronted by nginx/Caddy, connected to PostgreSQL via `asyncpg`.
- Ensure CORS and URLs are configured so the React app can call the FastAPI backend over HTTPS.
