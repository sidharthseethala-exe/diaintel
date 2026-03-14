"""
DiaIntel — Text Cleaner
Pre-processes raw Reddit post text for NLP analysis.

Cleaning pipeline:
1. Skip deleted/removed posts
2. Remove URLs (http, www, reddit links)
3. Remove Reddit markdown (bold, italic, strikethrough, headers, quotes)
4. Remove Reddit-specific patterns (/u/username, /r/subreddit)
5. Remove non-medical special characters (keep letters, numbers, ., -, /, %, mg, ml)
6. Normalize whitespace (collapse multiple spaces/newlines)
7. Strip leading/trailing whitespace
8. Language detection (English only) via langdetect
9. Minimum length filter (MIN_POST_LENGTH)

Returns a dict with:
    cleaned_text: str
    word_count: int
    language: str
"""

import re
import logging
from typing import Optional, Dict

from langdetect import detect, LangDetectException

from app.config import settings

logger = logging.getLogger("diaintel.nlp.cleaner")


class TextCleaner:
    """Cleans and normalizes raw Reddit post text for NLP processing."""

    def __init__(self, min_length: int = None):
        """Initialize with pre-compiled regex patterns.

        Args:
            min_length: Minimum cleaned text length. Defaults to settings.MIN_POST_LENGTH.
        """
        self.min_length = min_length or settings.MIN_POST_LENGTH

        # ---- Pre-compiled regex patterns (compiled once, reused) ----

        # URLs: http(s)://, www., and markdown links [text](url)
        self._url_pattern = re.compile(
            r'https?://\S+|www\.\S+|\[([^\]]*)\]\([^\)]+\)',
            re.IGNORECASE
        )

        # Reddit user/sub references: /u/username, u/username, /r/subreddit, r/subreddit
        self._reddit_ref_pattern = re.compile(
            r'/?[ur]/[\w-]+',
            re.IGNORECASE
        )

        # Reddit/markdown formatting:
        #   **bold**, *italic*, ~~strikethrough~~, `code`, > blockquote, # headers
        self._markdown_bold_italic = re.compile(r'\*{1,3}|_{1,3}|~~')
        self._markdown_code = re.compile(r'`{1,3}[^`]*`{1,3}')
        self._markdown_headers = re.compile(r'^#{1,6}\s*', re.MULTILINE)
        self._markdown_blockquote = re.compile(r'^>\s*', re.MULTILINE)
        self._markdown_hr = re.compile(r'^[-*_]{3,}\s*$', re.MULTILINE)
        self._markdown_list = re.compile(r'^\s*[-*+]\s+', re.MULTILINE)
        self._markdown_numbered_list = re.compile(r'^\s*\d+\.\s+', re.MULTILINE)

        # HTML entities and tags
        self._html_tags = re.compile(r'<[^>]+>')
        self._html_entities = re.compile(r'&[a-zA-Z]+;|&#\d+;')

        # Special characters to remove — keep letters, digits, spaces, and
        # medical-relevant punctuation: . , - / % ( ) ' : ;
        self._special_chars = re.compile(r"[^\w\s.,\-/%()'\":;!?+]")

        # Multiple whitespace (spaces, tabs, newlines) → single space
        self._whitespace = re.compile(r'\s+')

        # Bodies to reject outright
        self._skip_bodies = {"[deleted]", "[removed]", ""}

        logger.info(f"TextCleaner initialized (min_length={self.min_length})")

    def clean(self, text: str) -> Optional[Dict]:
        """Clean raw post text through the full pipeline.

        Args:
            text: Raw Reddit post body

        Returns:
            Dict with cleaned_text, word_count, language — or None if rejected.
        """
        # ---- Step 0: Reject None / non-string ----
        if not text or not isinstance(text, str):
            return None

        # ---- Step 1: Skip deleted/removed ----
        stripped = text.strip()
        if stripped.lower() in self._skip_bodies:
            return None

        # ---- Step 2: Remove URLs ----
        # For markdown links [text](url), keep the link text via capture group
        cleaned = self._url_pattern.sub(lambda m: m.group(1) or '', stripped)

        # ---- Step 3: Remove Reddit references ----
        cleaned = self._reddit_ref_pattern.sub('', cleaned)

        # ---- Step 4: Remove markdown formatting ----
        cleaned = self._markdown_code.sub('', cleaned)          # code blocks first
        cleaned = self._markdown_bold_italic.sub('', cleaned)   # bold/italic markers
        cleaned = self._markdown_headers.sub('', cleaned)       # # headers
        cleaned = self._markdown_blockquote.sub('', cleaned)    # > quotes
        cleaned = self._markdown_hr.sub('', cleaned)            # --- horizontal rules
        cleaned = self._markdown_list.sub('', cleaned)          # - bullet points
        cleaned = self._markdown_numbered_list.sub('', cleaned) # 1. numbered lists

        # ---- Step 5: Remove HTML ----
        cleaned = self._html_tags.sub('', cleaned)
        cleaned = self._html_entities.sub('', cleaned)

        # ---- Step 6: Remove non-medical special chars ----
        cleaned = self._special_chars.sub(' ', cleaned)

        # ---- Step 7: Normalize whitespace ----
        cleaned = self._whitespace.sub(' ', cleaned).strip()

        # ---- Step 8: Minimum length check ----
        if len(cleaned) < self.min_length:
            return None

        # ---- Step 9: Word count ----
        words = cleaned.split()
        word_count = len(words)

        if word_count < 3:
            return None

        # ---- Step 10: Language detection ----
        language = self._detect_language(cleaned)
        if language != "en":
            return None

        return {
            "cleaned_text": cleaned,
            "word_count": word_count,
            "language": language,
        }

    def _detect_language(self, text: str) -> str:
        """Detect language of text. Returns ISO 639-1 code.

        Falls back to 'en' for short texts where detection is unreliable.
        """
        # langdetect is unreliable on very short texts
        if len(text) < 40:
            return "en"

        try:
            lang = detect(text)
            return lang
        except LangDetectException:
            # Detection failed — assume English for medical text
            return "en"

    def clean_batch(self, texts: list) -> list:
        """Clean a batch of texts, returning only valid results.

        Returns list of dicts with cleaned_text, word_count, language.
        """
        results = []
        for text in texts:
            result = self.clean(text)
            if result is not None:
                results.append(result)
        return results


# Singleton instance
cleaner = TextCleaner()
