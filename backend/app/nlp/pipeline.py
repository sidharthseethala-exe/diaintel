"""
DiaIntel — NLP Pipeline
Raw-SQL pipeline for cleaning, drug NER, AE extraction, outcomes, timelines,
combos, sentiment, misinformation, and graph updates.
"""

import logging
import time
from typing import Optional

import spacy
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal
from app.nlp.ae_extractor import analyze_text_realtime, process_batch as process_ae_batch
from app.nlp.cleaner import TextCleaner
from app.nlp.combo_detector import detect_combos_for_post
from app.nlp.drug_ner import DrugNER
from app.nlp.graph_builder import graph_builder
# from app.nlp.misinfo_detector import check_misinfo_for_post  # DISABLED
from app.nlp.outcome_extractor import process_outcomes_for_post
from app.nlp.sentiment import score_sentiment_for_post
from app.nlp.timeline_extractor import extract_timelines_for_post
from app.utils.rxnorm_loader import RxNormLoader

logger = logging.getLogger("diaintel.nlp.pipeline")


class NLPPipeline:
    """Orchestrates the DiaIntel NLP processing pipeline."""

    def __init__(self):
        self._cleaner: Optional[TextCleaner] = None
        self._drug_ner: Optional[DrugNER] = None
        self._rxnorm: Optional[RxNormLoader] = None
        self._nlp = None
        self._initialized = False

    def _initialize(self):
        if self._initialized:
            return

        start_time = time.time()
        logger.info("Initializing NLP pipeline components")

        try:
            self._nlp = spacy.load("en_core_web_lg", disable=["lemmatizer"])
            self._nlp.max_length = 2_000_000
        except OSError:
            logger.warning("en_core_web_lg not available, using spaCy blank English pipeline")
            self._nlp = spacy.blank("en")
            if "sentencizer" not in self._nlp.pipe_names:
                self._nlp.add_pipe("sentencizer")

        self._rxnorm = RxNormLoader()
        self._rxnorm.load()
        self._cleaner = TextCleaner(min_length=settings.MIN_POST_LENGTH)
        self._drug_ner = DrugNER(rxnorm_loader=self._rxnorm, spacy_nlp=self._nlp)
        self._initialized = True

        logger.info("NLP pipeline initialized in %.1fs", time.time() - start_time)

    def process_batch(self, db: Session = None, batch_size: int = None) -> int:
        self._initialize()

        batch_size = batch_size or settings.BATCH_SIZE
        own_session = db is None
        if own_session:
            db = SessionLocal()

        try:
            return self._run_batch(db, batch_size)
        finally:
            if own_session:
                db.close()

    def _run_batch(self, db: Session, batch_size: int) -> int:
        batch_rows = db.execute(
            sql_text(
                """
                SELECT id, reddit_id, subreddit, body, score, comment_count, created_utc, source_file
                FROM raw_posts
                WHERE processed = FALSE
                ORDER BY id
                LIMIT :limit
                FOR UPDATE SKIP LOCKED
                """
            ),
            {"limit": batch_size},
        ).mappings().all()

        if not batch_rows:
            return 0

        prepared_posts = []
        processed_count = 0

        for row in batch_rows:
            try:
                process_result = self._process_single_post(db, row)
                processed_count += 1
                if process_result:
                    prepared_posts.append(process_result)
            except Exception as exc:
                logger.warning("Failed processing raw post %s: %s", row["id"], exc, exc_info=True)
                db.execute(
                    sql_text("UPDATE raw_posts SET processed = TRUE WHERE id = :raw_post_id"),
                    {"raw_post_id": row["id"]},
                )

        db.commit()

        if prepared_posts:
            try:
                process_ae_batch(prepared_posts, db)
            except Exception as exc:
                logger.error("AE extraction failed for current batch: %s", exc, exc_info=True)
                db.rollback()

            downstream_start = time.time()
            for post in prepared_posts:
                if not post["drug_mentions"]:
                    continue
                try:
                    process_outcomes_for_post(post["id"], post["clean_text"], post["drug_mentions"], db)
                    detect_combos_for_post(post["id"], post["clean_text"], db)
                    score_sentiment_for_post(post["id"], post["clean_text"], post["drug_mentions"], db)
                    # check_misinfo_for_post  # DISABLED - too slow(post["id"], post["clean_text"], db)
                    extract_timelines_for_post(post["id"], post["clean_text"], db)
                    graph_builder.update_graph_for_post(post["id"], db)
                    db.commit()
                except Exception as exc:
                    logger.warning("Post-processing failed for processed post %s: %s", post["id"], exc, exc_info=True)
                    db.rollback()
            logger.info("Downstream NLP steps completed in %.1fs", time.time() - downstream_start)

        return processed_count

    def _process_single_post(self, db: Session, raw_post: dict) -> Optional[dict]:
        clean_result = self._cleaner.clean(raw_post["body"])
        if clean_result is None:
            db.execute(
                sql_text("UPDATE raw_posts SET processed = TRUE WHERE id = :raw_post_id"),
                {"raw_post_id": raw_post["id"]},
            )
            return None

        drug_mentions = self._drug_ner.extract(clean_result["cleaned_text"])
        processed_post_id = db.execute(
            sql_text(
                """
                INSERT INTO processed_posts (raw_post_id, cleaned_text, language, word_count, processed_at)
                VALUES (:raw_post_id, :cleaned_text, :language, :word_count, NOW())
                RETURNING id
                """
            ),
            {
                "raw_post_id": raw_post["id"],
                "cleaned_text": clean_result["cleaned_text"],
                "language": clean_result["language"],
                "word_count": clean_result["word_count"],
            },
        ).scalar_one()

        if drug_mentions:
            db.execute(
                sql_text(
                    """
                    INSERT INTO drug_mentions
                        (post_id, drug_name, drug_normalized, dosage, frequency, confidence, detected_at)
                    VALUES
                        (:post_id, :drug_name, :drug_normalized, :dosage, :frequency, :confidence, NOW())
                    """
                ),
                [
                    {
                        "post_id": processed_post_id,
                        "drug_name": mention["drug_name"],
                        "drug_normalized": mention["drug_normalized"],
                        "dosage": mention.get("dosage"),
                        "frequency": mention.get("frequency"),
                        "confidence": mention["confidence"],
                    }
                    for mention in drug_mentions
                ],
            )

        db.execute(
            sql_text("UPDATE raw_posts SET processed = TRUE WHERE id = :raw_post_id"),
            {"raw_post_id": raw_post["id"]},
        )

        return {
            "id": processed_post_id,
            "raw_post_id": raw_post["id"],
            "clean_text": clean_result["cleaned_text"],
            "word_count": clean_result["word_count"],
            "language": clean_result["language"],
            "drug_mentions": [mention["drug_normalized"] for mention in drug_mentions],
        }

    def process_single(self, text: str) -> dict:
        self._initialize()
        start_time = time.time()

        clean_result = self._cleaner.clean(text)
        if clean_result is None:
            return {
                "cleaned_text": None,
                "drug_mentions": [],
                "adverse_events": [],
                "processing_time_ms": round((time.time() - start_time) * 1000, 1),
                "rejected_reason": "Text rejected by cleaner (non-English, too short, or deleted)",
            }

        drug_mentions = self._drug_ner.extract(clean_result["cleaned_text"])
        ae_result = analyze_text_realtime(clean_result["cleaned_text"])

        return {
            "cleaned_text": clean_result["cleaned_text"],
            "word_count": clean_result["word_count"],
            "language": clean_result["language"],
            "drug_mentions": drug_mentions,
            "adverse_events": ae_result["adverse_events"],
            "processing_time_ms": round((time.time() - start_time) * 1000, 1),
        }

    def run_pipeline(self, batch_size: int = None) -> int:
        batch_size = batch_size or settings.BATCH_SIZE
        total_processed = 0

        db = SessionLocal()
        try:
            while True:
                processed = self.process_batch(db, batch_size=batch_size)
                if processed == 0:
                    break
                total_processed += processed
            return total_processed
        finally:
            db.close()

    def get_stats(self) -> dict:
        return {
            "initialized": self._initialized,
            "spacy_loaded": self._nlp is not None,
            "rxnorm_loaded": self._rxnorm.loaded if self._rxnorm else False,
            "cleaner_ready": self._cleaner is not None,
            "drug_ner_ready": self._drug_ner is not None,
        }


pipeline = NLPPipeline()


def run_pipeline():
    from app.database import SessionLocal
    db = SessionLocal()
    total = 0
    try:
        while True:
            count = pipeline.process_batch(db=db, batch_size=1000)
            if count == 0:
                break
            total += count
            print(f'Processed {total} posts so far...')
    finally:
        db.close()
    print(f'Done! Total: {total} posts processed')
    return total
