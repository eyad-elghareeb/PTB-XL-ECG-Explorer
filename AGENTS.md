# AGENTS.md — AI-Assisted Development Context

This file provides architectural context and guidelines for AI coding assistants (such as Cline, Copilot, or custom agents) working on this project.

## Project Overview

**PTB-XL ECG Explorer** is a single-page Next.js application that combines a clinical ECG database browser with a real-time ECG rhythm simulator. It uses an embedded SQLite database (`better-sqlite3`) for offline-capable access to the PTB-XL dataset.

## Key Architecture Decisions

### 1. Monolithic Page Architecture
The entire application lives in `app/page.tsx` (~4300 lines). This was intentionally kept as a single file to:
- Keep the animation rendering loop and state management colocated
- Avoid prop-drilling overhead for the 40+ state variables that the canvas render loop consumes

### 2. Rendering Engine
- **Canvas-based**: All ECG waveform rendering uses the HTML5 Canvas API (not SVG or WebGL)
- **High-DPI aware**: Uses `window.devicePixelRatio` scaling up to 3x
- **Grid caching**: A secondary off-screen canvas caches the ECG grid pattern; only invalidated on theme/zoom changes
- **Sweep buffer pattern**: A `Float32Array` buffer maintains the persistent trace, updating only the latest column each frame

### 3. State Architecture
- **React state** manages UI controls (tabs, filters, settings)
- **`useRef` state** (`stateRef`) mirrors critical rendering parameters to avoid closure staleness inside `requestAnimationFrame`
- Two modes: `"database"` (clinical records) and `"simulation"` (synthesized rhythms)

### 4. Database Layer
- **SQLite** via `better-sqlite3` (synchronous, embedded)
- `lib/db.ts`: Database initialization, schema creation, and query helpers
- `lib/seed.ts`: Downloads and parses PTB-XL data files from PhysioNet
- API routes in `app/api/` proxy database queries to the client

### 5. Rhythm Synthesis
- `lib/ecg-rhythms.ts`: Contains 28 rhythm definitions with per-lead wave parameters, heart rate ranges, icon mappings, and morphological descriptions
- `lib/ecg-math.ts`: Waveform synthesis using piecewise mathematical models (Gaussian + sinusoidal components for P-QRS-T-U waves), plus lead-specific amplitude transformations and noise generation

## Critical Code Patterns

### Signal Processing (app/page.tsx)
- `analyzeECGPeaks()`: Derivative-based Pan-Tompkins R-peak detection with 350ms refractory period and 50ms local neighborhood search
- `getRecordSignalForLead()`: Case-insensitive lead name resolution with Savitzky-Golay smoothing option

### Canvas Rendering Loop
- Single `requestAnimationFrame` loop handles both modes
- Database mode: scrolls through pre-recorded signal arrays
- Simulation mode: synthesizes waveforms on-the-fly using phase-accumulated beat generation

## Development Commands

```bash
npm run dev      # Start development server (localhost:3000)
npm run build    # Production build
npm run start    # Start production server
npm run lint     # Run ESLint
```

## File Map

| File | Purpose |
|------|---------|
| `app/page.tsx` | Main application: UI, canvas rendering, state management |
| `app/layout.tsx` | Next.js root layout with metadata |
| `app/globals.css` | Tailwind CSS imports and global styles |
| `app/api/setup/route.ts` | Database seeding endpoint |
| `app/api/records/route.ts` | Record listing/filtering endpoint |
| `app/api/ecg/[id]/route.ts` | Individual ECG signal retrieval |
| `lib/db.ts` | SQLite schema, connection, query helpers |
| `lib/ecg-math.ts` | Waveform synthesis math, LUT building, noise |
| `lib/ecg-rhythms.ts` | Rhythm definitions, lead layouts, SCP codes |
| `lib/seed.ts` | PhysioNet PTB-XL data downloader + parser |
| `lib/utils.ts` | General utility functions |
| `hooks/use-mobile.ts` | Mobile viewport detection hook |
| `public/manifest.json` | PWA manifest |
| `public/sw.js` | Service worker for offline support |

## Notes for AI Agents

- **Do not refactor** the monolithic `page.tsx` file without understanding the render loop / `stateRef` synchronization pattern
- **Grid cache invalidation**: If you modify grid appearance or theme colors, ensure `gridCacheValid.current` is set to `false`
- **Database migrations**: The schema is created in `lib/db.ts` with `CREATE TABLE IF NOT EXISTS` — safe to re-run
- **PhysioNet data**: The seed script downloads from `https://physionet.org/files/ptb-xl/1.0.3/` — do not change this URL without updating the data parsing logic
- **No external API keys** are required; the app is fully self-contained