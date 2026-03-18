<div align="center">

<br/>

```
██████╗ ██╗ █████╗ ██╗███╗   ██╗████████╗███████╗██╗
██╔══██╗██║██╔══██╗██║████╗  ██║╚══██╔══╝██╔════╝██║
██║  ██║██║███████║██║██╔██╗ ██║   ██║   █████╗  ██║
██║  ██║██║██╔══██║██║██║╚██╗██║   ██║   ██╔══╝  ██║
██████╔╝██║██║  ██║██║██║ ╚████║   ██║   ███████╗███████╗
╚═════╝ ╚═╝╚═╝  ╚═╝╚═╝╚═╝  ╚═══╝   ╚═╝   ╚══════╝╚══════╝
```

**Pharmacovigilance Intelligence — built for the real world, not the lab.**

<br/>

[![Built at HackCrux 2026](https://img.shields.io/badge/Built%20at-HackCrux%202026%20%40%20LNMIIT-6d28d9?style=flat-square)](.)
[![FastAPI](https://img.shields.io/badge/Backend-FastAPI-009688?style=flat-square)](.)
[![React 18](https://img.shields.io/badge/Frontend-React%2018%20%2F%20Vite-61dafb?style=flat-square)](.)
[![BioBERT](https://img.shields.io/badge/NLP-BioBERT%20%2B%20RoBERTa-8b5cf6?style=flat-square)](.)
[![License: MIT](https://img.shields.io/badge/License-MIT-f59e0b?style=flat-square)](.)

<br/>

> *"67,900+ patients talked. We listened — and turned it into medical intelligence."*

<br/>

</div>

---

## What is DiaIntel?

Every day, thousands of patients post about their medications online — side effects they noticed, symptoms their doctor dismissed, combinations that worked or didn't. This information is real, rich, and almost entirely ignored by traditional drug safety systems.

**DiaIntel changes that.**

It's a pharmacovigilance platform that monitors large-scale patient discussions across the internet, extracts clinically meaningful signals using state-of-the-art NLP, and surfaces them in a dashboard built for researchers and drug safety teams — before those signals become crises.

Think of it as a live clinical intelligence layer built on top of the internet's largest patient communities.

---

## Why This Matters

Traditional drug safety reporting is broken in a specific, quiet way. The FDA's voluntary reporting systems miss the vast majority of adverse events. Patients experience side effects, stop taking their medication, and never file a report — but they do talk about it online.

DiaIntel taps into that signal:

- Rare side effects that won't show up in trials for years are already being discussed in forums today
- Patient language around drug combinations and severity is richer than any checkbox form
- Misinformation spreads fast in health communities — it needs to be caught at the source

We built DiaIntel to make pharmacovigilance proactive instead of reactive.

---

## The Platform

### Treatment Intelligence Dashboard
A command-center view across all tracked medications. See sentiment trends over time, adverse event report volumes, and AI-confidence scores at a glance. The kind of interface that makes you want to explore the data.

![DiaIntel Dashboard](./frontend/images/dashboard.jpeg)

### Side Effect Knowledge Graph
A live, D3-powered network that maps the relationships between drugs, adverse events, and patient-reported outcomes. Drag, filter, and click your way through the data. Adjust thresholds to cut through the noise and find the high-signal patterns underneath.

![Side Effect Knowledge Graph](./frontend/images/graph.jpeg)

### Live Safety Analyzer
Paste any patient text — a Reddit post, a forum comment, an app review — and get back a structured clinical analysis in seconds:
- Drug and dosage extraction via Named Entity Recognition
- Adverse event mapping to MedDRA terminology
- Severity classification (mild / moderate / severe)

### Misinformation Monitor
A dedicated module that identifies health claims in patient discussions, scores them against scientific literature, and flags potential misinformation before it spreads. Especially critical in communities around diabetes and metabolic medications.

---

## Data Coverage

| Metric | Value |
|---|---|
| Patient discussions analyzed | 67,900+ |
| Verified adverse event reports | 32,900+ |
| Medications tracked | 8 core diabetes drugs |
| NLP models in pipeline | 4 specialized models |

**Tracked medications:** Ozempic · Metformin · Jardiance · Trulicity · Victoza · Farxiga · Januvia · Glipizide

---

## Tech Stack

DiaIntel is built with tools chosen for precision and performance, not convenience.

**Intelligence Layer**
- `BioBERT` — named entity recognition for drugs, dosages, and adverse events
- `DistilBERT` — fast classification for real-time analysis
- `RoBERTa` — sentiment analysis tuned to medical context
- `BART-MNLI` — zero-shot classification for misinformation detection

**Backend**
- `FastAPI` with async WebSocket support for live analysis
- `PostgreSQL` + `TimescaleDB` for time-series adverse event tracking
- `Redis` for high-speed caching and session management

**Frontend**
- `React 18` + `Vite` for a fast, responsive experience
- `D3.js` for the knowledge graph visualization
- `Recharts` for time-series dashboards

**Infrastructure**
- Fully containerized with Docker Compose — one command spins up the entire stack

---

## Getting Started

### Prerequisites

- Docker Desktop installed and running
- That's it. Seriously.

Optionally, pre-download the BioBERT/DistilBERT model weights to `backend/models/` to skip the first-run download.

### Launch

```bash
git clone -- 
docker compose up --build
```

Grab a coffee. The first build takes a few minutes to pull models and build containers.

### You're in

| Service | URL |
|---|---|
| Dashboard | http://localhost:5173 |
| API Docs (Swagger) | http://localhost:8000/docs |

---

## Project Structure

```
diaintel/
├── backend/
│   ├── app/
│   │   ├── api/routes/          # FastAPI route handlers
│   │   ├── api/websocket.py     # Live analysis WebSocket
│   │   └── main.py
│   ├── nlp/
│   │   ├── ae_extractor.py      # BioBERT adverse event extraction
│   │   ├── drug_ner.py          # Drug/dosage NER
│   │   ├── sentiment.py         # RoBERTa sentiment
│   │   ├── misinfo_detector.py  # BART-MNLI misinformation
│   │   └── graph_builder.py     # NetworkX knowledge graph
│   ├── ingestion/
│   │   ├── pushshift_loader.py  # Reddit data ingestion
│   │   └── scheduler.py        # APScheduler jobs
│   └── utils/
│       ├── rxnorm_loader.py     # RxNorm drug normalization
│       └── meddra_mapper.py     # MedDRA term mapping
├── frontend/
│   ├── src/
│   │   ├── pages/               # Dashboard, Graph, Analyzer, Monitor
│   │   ├── hooks/useWebSocket.js
│   │   ├── services/api.js
│   │   └── components/ErrorBoundary.jsx
│   └── vite.config.js
├── db/init.sql
├── docker-compose.yml
└── .env.example
```

---

## Pipeline Overview

The data flows through a disciplined sequence of processing stages:

![DiaIntel NLP Pipeline](./frontend/images/pipeline.jpeg)

```
Reddit / Patient Forums
        ↓
   Data Ingestion          Pushshift loader + APScheduler
        ↓
  Text Preprocessing       Cleaning + Drug NER + RxNorm/MedDRA normalization
        ↓
   AE Extraction           BioBERT (batch) + DistilBERT (real-time)
        ↓
  ┌─────┼──────┐
  ↓     ↓      ↓
4A      4B     4C          Outcome / Timeline / Combo extraction
  └─────┼──────┘
        ↓
  ┌─────┴─────┐
  ↓           ↓
Sentiment   Misinfo        RoBERTa + BART-MNLI
  └─────┬─────┘
        ↓
 Knowledge Graph           NetworkX graph construction
        ↓
   FastAPI + WS            REST API + WebSocket layer
        ↓
  React Frontend           Dashboard · Graph · Analyzer · Monitor
```

---

## Built For

DiaIntel was built as a research prototype for **HackCrux 2026 @ LNMIIT**, exploring how modern NLP can be applied to clinical drug safety at real-world scale. It's a proof of concept that the gap between social patient data and formal pharmacovigilance is closeable — and doesn't require a pharma company's infrastructure to close it.

---

## Contributing

Pull requests are welcome. If you're working on something significant, open an issue first so we can align.

Areas we'd love help with:
- Expanding to additional medication categories beyond diabetes drugs
- Multilingual NLP support
- Improving MedDRA mapping coverage
- A proper test suite for the NLP pipeline

---

## Disclaimer

DiaIntel is a research platform. All AI-extracted medical signals are experimental and must be reviewed and validated by certified medical professionals before any clinical action is taken. This platform does not provide medical advice.

---

<div align="center">

Built for the researchers. Informed by the patients.


</div>
