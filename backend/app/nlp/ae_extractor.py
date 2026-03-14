"""
DiaIntel — Adverse Event Extractor (Step 4)
GPU-accelerated BioBERT AE extraction module.

Uses BioBERT (dmis-lab/biobert-base-cased-v1.2) for:
  - Batch processing of historical posts (high accuracy)
  - Real-time single-text inference for Live Analyzer API

Architecture:
  BioBERT base is a masked language model, not a fine-tuned NER model.
  This module uses a hybrid approach:
    1. Keyword matching against known AE terms (AE_TERMS + MedDRA lexicon)
    2. BioBERT contextual embeddings to compute confidence scores

Pipeline flow:
  1. Tokenize text with BioBERT tokenizer
  2. Run forward pass to get hidden states
  3. Scan text for known AE terms
  4. Score each match using embedding similarity for confidence
  5. Normalize with MedDRA mapper
  6. Detect severity via keyword heuristics
  7. Insert into ae_signals table (batch mode only)
"""

import re
import time
import logging
from datetime import datetime, timezone
from typing import List, Dict, Optional, Tuple

import torch
import numpy as np
from sqlalchemy.orm import Session
from sqlalchemy import text as sql_text

from app.config import settings 
from app.database import SessionLocal
from app.utils.meddra_mapper import meddra_mapper

logger = logging.getLogger("diaintel.nlp.ae_extractor")

# ============================================================
# Global model variables (lazy-loaded)
# ============================================================
_tokenizer = None
_model = None
_device = None
_ae_seed_embeddings = None  # Precomputed AE seed embeddings

# ============================================================
# Known AE terms for keyword matching
# ============================================================
AE_TERMS = [
    "nausea", "vomiting", "diarrhea", "constipation",
    "bloating", "stomach cramps", "abdominal pain",
    "headache", "dizziness", "fatigue",
    "weight loss", "weight gain", "appetite loss",
    "hypoglycemia", "low blood sugar",
    "muscle pain", "joint pain", "back pain",
    "urinary tract infection", "uti",
    "dehydration", "dry mouth",
    "skin rash", "itching", "injection site reaction",
    "pancreatitis", "thyroid", "kidney",
    "heart palpitations", "chest pain",
    "hair loss", "blurred vision",
    "insomnia", "anxiety", "depression",
    # Extended informal terms
    "stomach ache", "stomach pain", "gi issues", "gi problems",
    "tired", "exhaustion", "dizzy",
    "felt sick", "feeling sick", "throwing up",
    "can't sleep", "couldn't sleep",
    "gained weight", "lost weight",
    "sugar crash", "sugar low",
    "rash", "hives",
]

# Severity keyword sets
SEVERE_KEYWORDS = {"severe", "horrible", "unbearable", "extreme", "terrible", "excruciating", "intense", "worst"}
MILD_KEYWORDS = {"mild", "slight", "minor", "barely", "faint", "subtle"}

# Batch processing settings (RTX 3050, 6GB VRAM)
BATCH_SIZE = 16
MAX_LENGTH = 256


# ============================================================
# 1. Model Loading (Lazy)
# ============================================================
def _load_model():
    """
    Lazy-load BioBERT tokenizer and model.
    Loads only once; subsequent calls are no-ops.
    Automatically detects GPU and moves model to CUDA if available.
    """
    global _tokenizer, _model, _device, _ae_seed_embeddings

    if _model is not None:
        return

    from transformers import AutoTokenizer, AutoModel

    model_path = f"{settings.MODEL_CACHE_DIR}/dmis-lab--biobert-base-cased-v1.2"

    logger.info("=" * 60)
    logger.info("Loading BioBERT model for AE extraction...")
    logger.info(f"  Model path: {model_path}")

    _device = "cuda" if torch.cuda.is_available() else "cpu"
    logger.info(f"  Device: {_device}")

    start = time.time()

    _tokenizer = AutoTokenizer.from_pretrained(model_path)
    _model = AutoModel.from_pretrained(model_path)
    _model.to(_device)
    _model.eval()

    duration = time.time() - start
    logger.info(f"  ✓ BioBERT loaded in {duration:.1f}s")

    # Precompute AE seed embeddings for confidence scoring
    _ae_seed_embeddings = _compute_ae_seed_embeddings()
    logger.info(f"  ✓ AE seed embeddings computed ({len(AE_TERMS)} terms)")
    logger.info("=" * 60)


def _compute_ae_seed_embeddings() -> torch.Tensor:
    """
    Compute mean-pooled BioBERT embeddings for each AE term.
    These serve as reference vectors for confidence scoring.
    Returns a tensor of shape (num_terms, hidden_dim).
    """
    embeddings = []
    with torch.no_grad():
        for term in AE_TERMS:
            inputs = _tokenizer(
                term,
                return_tensors="pt",
                padding=True,
                truncation=True,
                max_length=32,
            ).to(_device)
            outputs = _model(**inputs)
            # Mean-pool over token dimension
            emb = outputs.last_hidden_state.mean(dim=1).squeeze(0)
            embeddings.append(emb)
    return torch.stack(embeddings)


# ============================================================
# 2. Span Extraction Helpers
# ============================================================
def extract_ae_spans(text: str) -> List[Dict]:
    """
    Scan text for known AE terms and return matched spans
    with position information.

    Returns list of dicts: {term, start, end, normalized}
    """
    text_lower = text.lower()
    found = []
    seen = set()

    # Sort AE terms by length (longest first) to prefer longer matches
    sorted_terms = sorted(AE_TERMS, key=len, reverse=True)

    for term in sorted_terms:
        # Use word-boundary aware search
        pattern = re.compile(r'\b' + re.escape(term) + r'\b', re.IGNORECASE)
        for match in pattern.finditer(text_lower):
            # Check overlap with already-found spans
            start, end = match.start(), match.end()
            overlap = False
            for s in seen:
                if not (end <= s[0] or start >= s[1]):
                    overlap = True
                    break
            if overlap:
                continue

            seen.add((start, end))
            normalized = meddra_mapper.normalize(term)
            found.append({
                "term": term,
                "start": start,
                "end": end,
                "normalized": normalized,
            })

    return found


def _compute_span_confidence(text: str, spans: List[Dict]) -> List[Dict]:
    """
    Use BioBERT embeddings to compute a confidence score for each
    detected AE span, based on cosine similarity to AE seed embeddings.

    Higher similarity → higher confidence that the phrase is a real AE.
    """
    if not spans:
        return spans

    _load_model()

    with torch.no_grad():
        # Encode the full text
        inputs = _tokenizer(
            text,
            return_tensors="pt",
            padding=True,
            truncation=True,
            max_length=MAX_LENGTH,
        ).to(_device)
        outputs = _model(**inputs)
        text_embedding = outputs.last_hidden_state.mean(dim=1).squeeze(0)

        # Compute cosine similarity against all AE seed embeddings
        # Shape: (num_ae_terms,)
        cos_sim = torch.nn.functional.cosine_similarity(
            text_embedding.unsqueeze(0),
            _ae_seed_embeddings,
            dim=1,
        )
        max_sim = cos_sim.max().item()

    # Assign confidence based on embedding similarity
    for span in spans:
        # Base confidence from keyword match
        base_confidence = 0.80

        # Boost if the text embedding is closely aligned with AE seeds
        similarity_boost = max(0.0, (max_sim - 0.5)) * 0.4  # Scale 0.5-1.0 → 0.0-0.2
        span["confidence"] = min(0.99, base_confidence + similarity_boost)

    return spans


# ============================================================
# 3. Severity Detection
# ============================================================
def detect_severity(text: str, ae_term: str) -> str:
    """
    Detect severity of an adverse event mention using keyword heuristics.

    Rules:
      - If context contains severe/horrible/unbearable → "severe"
      - If context contains mild/slight → "mild"
      - Otherwise → "moderate"

    Uses a ±100 character window around the AE term for context.
    """
    text_lower = text.lower()

    # Find the AE term position and extract local context window
    term_pos = text_lower.find(ae_term.lower())
    if term_pos >= 0:
        ctx_start = max(0, term_pos - 100)
        ctx_end = min(len(text_lower), term_pos + len(ae_term) + 100)
        context = text_lower[ctx_start:ctx_end]
    else:
        context = text_lower

    # Check severity keywords in context
    context_words = set(re.findall(r'\b\w+\b', context))

    if context_words & SEVERE_KEYWORDS:
        return "severe"
    if context_words & MILD_KEYWORDS:
        return "mild"
    return "moderate"


# ============================================================
# 4. Batch Processing
# ============================================================
def process_batch(posts: List[Dict], db_session: Session) -> int:
    """
    Process a batch of posts for AE extraction.

    Receives a list of dicts with keys: {id, clean_text, drug_mentions}
    Steps:
      1. Load BioBERT model
      2. Tokenize all texts together
      3. Run inference on GPU
      4. Extract AE spans
      5. Normalize with MedDRA
      6. Detect severity
      7. Prepare and bulk-insert AE records

    Args:
        posts: List of post dicts with id, clean_text.
        db_session: SQLAlchemy session for DB writes.

    Returns:
        Number of AE signals inserted.
    """
    _load_model()

    batch_start = time.time()
    total_ae_count = 0
    ae_records = []

    logger.info(f"Processing batch of {len(posts)} posts for AE extraction...")

    # Process texts through BioBERT in sub-batches
    for i in range(0, len(posts), BATCH_SIZE):
        sub_batch = posts[i:i + BATCH_SIZE]
        texts = [p["clean_text"] for p in sub_batch]

        # Batch tokenization
        with torch.no_grad():
            inputs = _tokenizer(
                texts,
                return_tensors="pt",
                padding=True,
                truncation=True,
                max_length=MAX_LENGTH,
            ).to(_device)
            outputs = _model(**inputs)
            # Mean-pooled embeddings for each text (batch_size, hidden_dim)
            text_embeddings = outputs.last_hidden_state.mean(dim=1)

            # Compute max cosine similarity to AE seeds for each text
            # Shape: (batch_size, num_ae_terms)
            cos_sims = torch.nn.functional.cosine_similarity(
                text_embeddings.unsqueeze(1),
                _ae_seed_embeddings.unsqueeze(0),
                dim=2,
            )
            max_sims = cos_sims.max(dim=1).values.cpu().numpy()

        # Extract AE spans for each text
        for j, post in enumerate(sub_batch):
            text = post["clean_text"]
            post_id = post["id"]
            sim_score = float(max_sims[j])

            # Extract keyword matches
            spans = extract_ae_spans(text)

            # Get drug mentions for this post (if available)
            drugs = post.get("drug_mentions", [])

            for span in spans:
                # Confidence from embedding similarity
                base_confidence = 0.80
                similarity_boost = max(0.0, (sim_score - 0.5)) * 0.4
                confidence = min(0.99, base_confidence + similarity_boost)

                severity = detect_severity(text, span["term"])

                # If we know which drugs are in this post, create one
                # AE record per drug. Otherwise use "unknown".
                drug_names = drugs if drugs else ["unknown"]
                for drug in drug_names:
                    ae_records.append({
                        "post_id": post_id,
                        "drug_name": drug,
                        "ae_term": span["term"],
                        "ae_normalized": span["normalized"],
                        "severity": severity,
                        "confidence": round(confidence, 4),
                        "detected_at": datetime.now(timezone.utc),
                    })
                    total_ae_count += 1

    # Bulk insert into ae_signals
    if ae_records:
        try:
            db_session.execute(
                sql_text("""
                    INSERT INTO ae_signals
                        (post_id, drug_name, ae_term, ae_normalized, severity, confidence, detected_at)
                    VALUES
                        (:post_id, :drug_name, :ae_term, :ae_normalized, :severity, :confidence, :detected_at)
                """),
                ae_records,
            )
            db_session.commit()
            logger.info(f"Inserted {total_ae_count} rows into ae_signals")
        except Exception as e:
            db_session.rollback()
            logger.error(f"Failed to insert AE signals: {e}")
            raise

    batch_duration = time.time() - batch_start
    logger.info(
        f"Batch AE extraction complete: "
        f"{len(posts)} posts → {total_ae_count} adverse events "
        f"in {batch_duration:.1f}s"
    )

    return total_ae_count


# ============================================================
# 5. Pipeline Function — Process Unprocessed Posts
# ============================================================
def process_unprocessed_posts() -> int:
    """
    Query processed_posts that have not yet been AE-processed,
    run BioBERT extraction in batches, and insert results.

    Tracks processing by checking for existing ae_signals rows
    via LEFT JOIN (no ae_processed column needed).

    Returns:
        Total number of AE signals inserted.
    """
    _load_model()

    db = SessionLocal()
    total_inserted = 0

    try:
        while True:
            # Find processed posts that have no ae_signals rows yet
            result = db.execute(sql_text("""
                SELECT pp.id, pp.cleaned_text
                FROM processed_posts pp
                LEFT JOIN ae_signals ae ON ae.post_id = pp.id
                WHERE ae.id IS NULL
                LIMIT :limit
            """), {"limit": BATCH_SIZE})

            rows = result.fetchall()
            if not rows:
                logger.info("No more unprocessed posts for AE extraction")
                break

            # Build post dicts
            posts = []
            for row in rows:
                post_id = row[0]
                clean_text = row[1]

                # Look up drug mentions for this post
                drug_result = db.execute(sql_text("""
                    SELECT DISTINCT drug_normalized
                    FROM drug_mentions
                    WHERE post_id = :post_id
                """), {"post_id": post_id})
                drug_names = [r[0] for r in drug_result.fetchall()]

                posts.append({
                    "id": post_id,
                    "clean_text": clean_text,
                    "drug_mentions": drug_names if drug_names else ["unknown"],
                })

            # Process this batch
            count = process_batch(posts, db)
            total_inserted += count

            logger.info(f"Pipeline progress: {total_inserted} total AE signals inserted so far")

    except Exception as e:
        logger.error(f"AE pipeline error: {e}")
        raise
    finally:
        db.close()

    logger.info(f"AE pipeline complete: {total_inserted} total AE signals inserted")
    return total_inserted


# ============================================================
# 6. Real-Time API Inference
# ============================================================
def analyze_text_realtime(text: str) -> Dict:
    """
    Analyze a single text for adverse events in real-time.
    Used by the /api/v1/analyze endpoint.

    Does NOT write to the database.

    Steps:
      1. Load BioBERT
      2. Tokenize input
      3. Run inference
      4. Extract AE spans
      5. Return list of AE terms with severity and confidence

    Args:
        text: Raw text to analyze.

    Returns:
        Dict with adverse_events list.
    """
    _load_model()

    start = time.time()

    # Extract AE keyword matches
    spans = extract_ae_spans(text)

    # Compute confidence via BioBERT embeddings
    spans = _compute_span_confidence(text, spans)

    # Build results
    adverse_events = []
    seen_normalized = set()

    for span in spans:
        normalized = span["normalized"]
        if normalized in seen_normalized:
            continue
        seen_normalized.add(normalized)

        severity = detect_severity(text, span["term"])
        adverse_events.append({
            "ae_term": span["term"],
            "ae_normalized": normalized,
            "severity": severity,
            "confidence": round(span.get("confidence", 0.80), 4),
        })

    duration_ms = (time.time() - start) * 1000
    logger.info(f"Real-time AE extraction: {len(adverse_events)} AEs in {duration_ms:.1f}ms")

    return {
        "adverse_events": adverse_events,
        "processing_time_ms": round(duration_ms, 1),
    }


# ============================================================
# 7. Singleton Class (backward-compatible with existing imports)
# ============================================================
class AEExtractor:
    """Wrapper class for backward compatibility with existing code."""

    def __init__(self):
        self.initialized = False
        logger.info("AEExtractor created (models loaded lazily)")

    def initialize_biobert(self, model_path: str = None):
        """Load BioBERT model for batch processing."""
        _load_model()
        self.initialized = True

    def extract_batch(self, texts: List[str]) -> List[List[Dict]]:
        """Extract AEs from a batch of texts using BioBERT."""
        _load_model()
        results = []
        for text in texts:
            spans = extract_ae_spans(text)
            spans = _compute_span_confidence(text, spans)
            for span in spans:
                span["severity"] = detect_severity(text, span["term"])
            results.append(spans)
        return results

    def extract_realtime(self, text: str) -> List[Dict]:
        """Extract AEs from a single text. Must complete in < 3 seconds."""
        result = analyze_text_realtime(text)
        return result["adverse_events"]

    def _classify_severity(self, ae_term: str, context: str) -> str:
        """Classify severity based on context clues."""
        return detect_severity(context, ae_term)


# Singleton
ae_extractor = AEExtractor()
