"""
DiaIntel — NLP Pipeline
Orchestrates the full NLP processing pipeline for raw Reddit posts.

Step 3 implements stages 1-2:
  Stage 1: Text Cleaning (cleaner.py)
  Stage 2: Drug NER (drug_ner.py + rxnorm_loader.py)

Future stages (remain as placeholders until implemented):
  Stage 3: Adverse Event Extraction (ae_extractor.py) — Step 4
  Stage 4: Sentiment Analysis (sentiment.py) — Step 5
  Stage 5: Misinformation Detection (misinfo_detector.py) — Step 6

Pipeline flow per batch:
  1. Fetch raw_posts WHERE processed = FALSE (BATCH_SIZE at a time)
  2. Clean text via TextCleaner
  3. Extract drug mentions via DrugNER (with RxNorm + optional spaCy)
  4. INSERT into processed_posts
  5. INSERT into drug_mentions
  6. UPDATE raw_posts SET processed = TRUE
  7. Log results
"""

import time
import logging
from datetime import datetime, timezone
from typing import Optional

import spacy
from sqlalchemy.orm import Session
from sqlalchemy import text as sql_text

from app.config import settings
from app.database import SessionLocal
from app.nlp.cleaner import TextCleaner
from app.nlp.drug_ner import DrugNER
from app.utils.rxnorm_loader import RxNormLoader
from app.models.db_models import RawPost, ProcessedPost, DrugMention

logger = logging.getLogger("diaintel.nlp.pipeline")


class NLPPipeline:
    """Orchestrates the NLP processing pipeline.

    Initializes all NLP components on first use and processes
    raw posts through cleaning → drug NER → (future: AE/sentiment/misinfo).
    """

    def __init__(self):
        self._cleaner: Optional[TextCleaner] = None
        self._drug_ner: Optional[DrugNER] = None
        self._rxnorm: Optional[RxNormLoader] = None
        self._nlp = None  # spaCy model
        self._initialized = False

    def _initialize(self):
        """Lazy-load all NLP components on first use.

        This is called automatically by process_batch/process_single.
        Loads spaCy model (en_core_web_lg), RxNorm lexicon, and
        creates TextCleaner and DrugNER instances.
        """
        if self._initialized:
            return

        start_time = time.time()
        logger.info("=" * 60)
        logger.info("NLP Pipeline: Initializing components...")
        logger.info("=" * 60)

        # 1. Load spaCy model
        logger.info("  Loading spaCy model (en_core_web_lg)...")
        try:
            self._nlp = spacy.load("en_core_web_lg", disable=["ner", "lemmatizer"])
            # Increase max_length for long posts
            self._nlp.max_length = 2_000_000
            logger.info("  ✓ spaCy model loaded")
        except OSError:
            logger.warning("  ✗ en_core_web_lg not found — running without spaCy context extraction")
            self._nlp = None

        # 2. Load RxNorm lexicon
        logger.info("  Loading RxNorm drug lexicon...")
        self._rxnorm = RxNormLoader()
        self._rxnorm.load()
        all_variants = self._rxnorm.get_all_variants()
        total_v = sum(len(v) for v in all_variants.values())
        logger.info(f"  ✓ RxNorm loaded: {len(all_variants)} drugs, {total_v} variants")

        # 3. Create TextCleaner
        self._cleaner = TextCleaner(min_length=settings.MIN_POST_LENGTH)
        logger.info(f"  ✓ TextCleaner ready (min_length={settings.MIN_POST_LENGTH})")

        # 4. Create DrugNER with RxNorm and spaCy
        self._drug_ner = DrugNER(rxnorm_loader=self._rxnorm, spacy_nlp=self._nlp)
        logger.info(f"  ✓ DrugNER ready")

        self._initialized = True
        duration = time.time() - start_time
        logger.info(f"NLP Pipeline initialized in {duration:.1f}s")
        logger.info("=" * 60)

    def process_batch(self, db: Session = None, batch_size: int = None) -> int:
        """Process a batch of unprocessed raw posts.

        Fetches up to batch_size raw_posts where processed=FALSE,
        runs them through cleaning + drug NER, and writes results
        to processed_posts and drug_mentions.

        Args:
            db: SQLAlchemy Session (creates one if not provided)
            batch_size: Number of posts per batch (defaults to settings.BATCH_SIZE)

        Returns:
            Number of posts successfully processed.
        """
        # Initialize NLP components on first call
        self._initialize()

        if batch_size is None:
            batch_size = settings.BATCH_SIZE

        own_session = False
        if db is None:
            db = SessionLocal()
            own_session = True

        try:
            return self._run_batch(db, batch_size)
        finally:
            if own_session:
                db.close()

    def _run_batch(self, db: Session, batch_size: int) -> int:
        """Internal batch processing logic."""
        batch_start = time.time()

        # ---- Fetch unprocessed posts ----
        raw_posts = db.query(RawPost).filter(
            RawPost.processed == False  # noqa: E712
        ).limit(batch_size).all()

        if not raw_posts:
            logger.debug("No unprocessed posts found")
            return 0

        logger.info(f"Pipeline: Processing batch of {len(raw_posts)} posts...")

        processed_count = 0
        drug_mention_count = 0
        skipped_clean = 0
        skipped_no_drugs = 0

        for raw_post in raw_posts:
            try:
                result = self._process_single_post(db, raw_post)
                if result == "cleaned_no_drugs":
                    skipped_no_drugs += 1
                    processed_count += 1
                elif result == "skipped":
                    skipped_clean += 1
                    processed_count += 1
                elif isinstance(result, int):
                    drug_mention_count += result
                    processed_count += 1
            except Exception as e:
                logger.warning(f"Error processing post {raw_post.id}: {e}")
                # Mark as processed to avoid infinite retries
                raw_post.processed = True
                processed_count += 1

        # Commit the entire batch
        try:
            db.commit()
        except Exception as e:
            logger.error(f"Batch commit failed: {e}")
            db.rollback()
            return 0

        batch_duration = time.time() - batch_start

        logger.info(
            f"Pipeline batch complete: "
            f"{processed_count} posts processed, "
            f"{drug_mention_count} drug mentions detected, "
            f"{skipped_clean} rejected by cleaner, "
            f"{skipped_no_drugs} had no drugs — "
            f"{batch_duration:.1f}s"
        )

        return processed_count

    def _process_single_post(self, db: Session, raw_post: RawPost) -> object:
        """Process a single raw post through the NLP pipeline.

        Returns:
            int: number of drug mentions found (if successfully processed)
            "cleaned_no_drugs": if text cleaned OK but no drugs found
            "skipped": if text was rejected by cleaner
        """
        # ---- Stage 1: Clean text ----
        clean_result = self._cleaner.clean(raw_post.body)

        if clean_result is None:
            # Text rejected (non-English, too short, deleted, etc.)
            raw_post.processed = True
            return "skipped"

        cleaned_text = clean_result["cleaned_text"]
        word_count = clean_result["word_count"]
        language = clean_result["language"]

        # ---- Stage 2: Drug NER ----
        drug_mentions = self._drug_ner.extract(cleaned_text)

        # ---- Insert processed_post ----
        processed_post = ProcessedPost(
            raw_post_id=raw_post.id,
            cleaned_text=cleaned_text,
            language=language,
            word_count=word_count,
            processed_at=datetime.now(timezone.utc),
        )
        db.add(processed_post)

        # Flush to get the processed_post.id for drug_mentions FK
        db.flush()

        # ---- Insert drug_mentions ----
        for mention in drug_mentions:
            drug_mention = DrugMention(
                post_id=processed_post.id,
                drug_name=mention["drug_name"],
                drug_normalized=mention["drug_normalized"],
                dosage=mention.get("dosage"),
                frequency=mention.get("frequency"),
                confidence=mention["confidence"],
                detected_at=datetime.now(timezone.utc),
            )
            db.add(drug_mention)

        # ---- Mark raw post as processed ----
        raw_post.processed = True

        if not drug_mentions:
            return "cleaned_no_drugs"

        return len(drug_mentions)

    def process_single(self, text: str) -> dict:
        """Process a single text string in real-time (for /analyze endpoint).

        Does NOT write to database — returns results as dict.

        Args:
            text: Raw text to analyze

        Returns:
            Dict with cleaned_text, drug_mentions, processing_time_ms
        """
        self._initialize()

        start_time = time.time()

        # Clean
        clean_result = self._cleaner.clean(text)
        if clean_result is None:
            return {
                "cleaned_text": None,
                "drug_mentions": [],
                "processing_time_ms": round((time.time() - start_time) * 1000, 1),
                "rejected_reason": "Text rejected by cleaner (non-English, too short, or deleted)",
            }

        # Drug NER
        drug_mentions = self._drug_ner.extract(clean_result["cleaned_text"])

        processing_time_ms = round((time.time() - start_time) * 1000, 1)

        return {
            "cleaned_text": clean_result["cleaned_text"],
            "word_count": clean_result["word_count"],
            "language": clean_result["language"],
            "drug_mentions": drug_mentions,
            "processing_time_ms": processing_time_ms,
        }

    def get_stats(self) -> dict:
        """Return pipeline initialization status and stats."""
        return {
            "initialized": self._initialized,
            "spacy_loaded": self._nlp is not None,
            "rxnorm_loaded": self._rxnorm.loaded if self._rxnorm else False,
            "cleaner_ready": self._cleaner is not None,
            "drug_ner_ready": self._drug_ner is not None,
        }


# Singleton pipeline instance
pipeline = NLPPipeline()
