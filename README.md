# PTB-XL ECG Explorer

An interactive, offline-capable 12-lead Electrocardiogram (ECG) explorer for the **PTB-XL** clinical database. Features real-time multi-frequency signal visualization, a structured rhythm browser with digital wave synthesis, and advanced ECG analysis tools.

## Features

### 🫀 Clinical Database Mode
- Browse and search the full **PTB-XL** dataset (21,837+ clinical ECG records)
- View 12-lead ECG traces at multiple frequency resolutions (**100Hz**, **500Hz**)
- Download and seed the database directly from **PhysioNet** via the built-in setup wizard
- Advanced waveform filtering with Savitzky-Golay smoothing
- Statistical analysis with **R-peak detection**, HRV metrics (SDNN, RMSSD), and BPM calculation
- Class counts and superclass filtering for structured dataset exploration

### 📊 Rhythm Simulator Mode
- **28 distinct ECG rhythms** including normal sinus rhythm, arrhythmias, bundle branch blocks, hypertrophy patterns, infarction morphologies, and pacemaker rhythms
- Real-time **12-lead synchronized waveform synthesis** with configurable heart rate, amplitude, and speed
- **Manual mode** for fine-grained control over P-wave, QRS complex, ST segment, T-wave, and U-wave parameters
- **Comparison mode** — overlay two rhythms simultaneously
- **Strip mode** for classical ECG paper strip output

### 🎨 Visualization
- **6 color themes**: Monitor (green), Philips (teal), GE (yellow), Paper (red-on-tan), Midnight (purple), and full paper strip mode
- Dark/light mode support
- Scalable high-DPI canvas with dynamic grid rendering
- Glow effects, configurable zoom, and noise simulation
- Clinical **10mm/mV calibration** with standard paper speed (25mm/s)

### 🧠 Analysis Tools
- Real-time **BPM estimation** via derivative-based Pan-Tompkins R-peak detection
- **Heart Rate Variability** analysis (mean RR, SDNN, RMSSD)
- Peak interval histogram and diagnostic sub-tabs
- SCP-ECG diagnostic code browser with 30+ clinical descriptions

### 🔊 Audio
- Audible **QRS beep** for real-time heart sound monitoring

## Getting Started

### Prerequisites
- **Node.js** 18+
- **npm** or **pnpm**

### Installation

```bash
# Clone the repository
git clone https://github.com/eyad-elghareeb/PTB-XL-ECG-Explorer.git
cd PTB-XL-ECG-Explorer

# Install dependencies
npm install

# Start the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Database Setup

On first launch, the app will detect an empty database and prompt you to seed it. You can:

1. **Quick seed** (metadata only, ~few MB) — recommended for browsing patient/diagnosis data
2. **Full seed** (with raw ECG signals, ~several GB) — required for signal visualization
3. **Selective pull** — choose the number of records to download

The database is sourced from **PhysioNet's PTB-XL** public dataset.

> **Note:** No external API keys or configuration are required. The application runs entirely client-side with an embedded SQLite database.

## Project Structure

```
├── app/
│   ├── page.tsx          # Main application page (ECG simulator + DB explorer)
│   ├── layout.tsx        # Next.js app layout
│   ├── globals.css       # Global styles
│   ├── not-found.tsx     # 404 page
│   └── api/
│       ├── ecg/[id]/     # ECG signal API route
│       ├── records/      # PTB-XL records API route
│       ├── rhythm/[type]/# Rhythm data API route
│       └── setup/        # Database seeding API route
├── lib/
│   ├── db.ts             # SQLite database initialization & queries
│   ├── ecg-math.ts       # ECG waveform synthesis math
│   ├── ecg-rhythms.ts    # Rhythm definitions, lead layouts, icons
│   ├── seed.ts           # PhysioNet PTB-XL database seed script
│   └── utils.ts          # General utility functions
├── hooks/
│   └── use-mobile.ts     # Responsive mobile detection hook
└── public/
    ├── manifest.json     # PWA manifest
    └── sw.js             # Service worker (offline support)
```

## Tech Stack

| Category | Technology |
|----------|-----------|
| **Framework** | [Next.js 15](https://nextjs.org/) (App Router) |
| **UI & Styling** | React 19, Tailwind CSS 4, `class-variance-authority`, `tailwind-merge` |
| **Animation** | [Motion](https://motion.dev/) |
| **Database** | SQLite via `better-sqlite3` |
| **Icons** | [Lucide React](https://lucide.dev/) |
| **Languages** | TypeScript, CSS |

## License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- **PTB-XL** dataset provided by PhysioNet ([https://physionet.org/content/ptb-xl/](https://physionet.org/content/ptb-xl/))
- Built with [Next.js](https://nextjs.org/) and the React ecosystem