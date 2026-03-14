"""
DiaIntel — Drug Named Entity Recognition
Extracts drug names, dosages, and frequencies from cleaned text using:
1. RxNorm lexicon lookup (highest confidence: 0.95)
2. Regex pattern matching for drug variants (confidence: 0.90)
3. spaCy NER context extraction for dosage/frequency near mentions

Target drugs with variants:
  Metformin  → glucophage, glumetza, fortamet
  Ozempic    → semaglutide, wegovy
  Jardiance  → empagliflozin
  Januvia    → sitagliptin
  Farxiga    → dapagliflozin
  Trulicity  → dulaglutide
  Victoza    → liraglutide
  Glipizide  → glucotrol
"""

import re
import logging
from typing import List, Dict, Optional

logger = logging.getLogger("diaintel.nlp.drug_ner")

# ============================================================
# Drug lexicon: all variant names → normalized generic name
# This is the regex-based fallback if RxNorm isn't loaded yet.
# ============================================================
DRUG_LEXICON = {
    # Metformin
    "metformin": "metformin",
    "glucophage": "metformin",
    "glumetza": "metformin",
    "fortamet": "metformin",
    "riomet": "metformin",
    # Ozempic / Semaglutide
    "ozempic": "semaglutide",
    "semaglutide": "semaglutide",
    "wegovy": "semaglutide",
    "rybelsus": "semaglutide",
    # Jardiance / Empagliflozin
    "jardiance": "empagliflozin",
    "empagliflozin": "empagliflozin",
    # Januvia / Sitagliptin
    "januvia": "sitagliptin",
    "sitagliptin": "sitagliptin",
    # Farxiga / Dapagliflozin
    "farxiga": "dapagliflozin",
    "dapagliflozin": "dapagliflozin",
    "forxiga": "dapagliflozin",
    # Trulicity / Dulaglutide
    "trulicity": "dulaglutide",
    "dulaglutide": "dulaglutide",
    # Victoza / Liraglutide
    "victoza": "liraglutide",
    "liraglutide": "liraglutide",
    "saxenda": "liraglutide",
    # Glipizide
    "glipizide": "glipizide",
    "glucotrol": "glipizide",
}

# Common display names (generic → brand-preferred display)
DRUG_DISPLAY_NAMES = {
    "metformin": "Metformin",
    "semaglutide": "Ozempic",
    "empagliflozin": "Jardiance",
    "sitagliptin": "Januvia",
    "dapagliflozin": "Farxiga",
    "dulaglutide": "Trulicity",
    "liraglutide": "Victoza",
    "glipizide": "Glipizide",
}

# ============================================================
# Dosage extraction: captures "500 mg", "1.5ml", "20 units"
# ============================================================
DOSAGE_PATTERN = re.compile(
    r'(\d+(?:\.\d+)?)\s*(mg|mcg|ml|units?|iu|µg)\b',
    re.IGNORECASE
)

# ============================================================
# Frequency extraction patterns (ordered by specificity)
# ============================================================
FREQUENCY_PATTERNS = [
    (re.compile(r'twice\s+(?:a\s+)?daily', re.I), "twice daily"),
    (re.compile(r'once\s+(?:a\s+)?daily', re.I), "once daily"),
    (re.compile(r'once\s+(?:a\s+)?week(?:ly)?', re.I), "weekly"),
    (re.compile(r'twice\s+(?:a\s+)?week(?:ly)?', re.I), "twice weekly"),
    (re.compile(r'three\s+times\s+(?:a\s+)?day', re.I), "three times daily"),
    (re.compile(r'every\s+(?:other\s+)?day', re.I), "every other day"),
    (re.compile(r'every\s+morning', re.I), "once daily"),
    (re.compile(r'every\s+night', re.I), "once daily"),
    (re.compile(r'at\s+bedtime', re.I), "once daily"),
    (re.compile(r'before\s+meals?', re.I), "with meals"),
    (re.compile(r'with\s+meals?', re.I), "with meals"),
    (re.compile(r'\bdaily\b', re.I), "daily"),
    (re.compile(r'\bweekly\b', re.I), "weekly"),
    (re.compile(r'\bmonthly\b', re.I), "monthly"),
]


class DrugNER:
    """Extracts drug mentions, dosages, and frequencies from text.

    Uses a three-tier detection strategy:
    1. RxNorm lexicon lookup (confidence: 0.95)
    2. Built-in DRUG_LEXICON regex matching (confidence: 0.90)
    3. spaCy for context-based dosage/frequency extraction around mentions
    """

    def __init__(self, rxnorm_loader=None, spacy_nlp=None):
        """Initialize DrugNER.

        Args:
            rxnorm_loader: Optional RxNormLoader instance for lexicon-based lookup.
            spacy_nlp: Optional loaded spaCy model for context extraction.
        """
        self.rxnorm_loader = rxnorm_loader
        self.nlp = spacy_nlp

        # Build regex pattern from DRUG_LEXICON keys
        # Sort by length descending so longer names match first (e.g., "semaglutide" before "glipizide")
        drug_names = sorted(DRUG_LEXICON.keys(), key=len, reverse=True)
        pattern = r'(?<!\w)(' + '|'.join(re.escape(d) for d in drug_names) + r')(?!\w)'
        self.drug_pattern = re.compile(pattern, re.IGNORECASE)

        # If RxNorm is loaded, merge its variants into the lookup
        self._variant_map = dict(DRUG_LEXICON)
        if self.rxnorm_loader and self.rxnorm_loader.loaded:
            rxnorm_map = self.rxnorm_loader.get_variant_to_generic_map()
            self._variant_map.update(rxnorm_map)
            # Rebuild regex with expanded variants
            all_names = sorted(self._variant_map.keys(), key=len, reverse=True)
            pattern = r'(?<!\w)(' + '|'.join(re.escape(d) for d in all_names) + r')(?!\w)'
            self.drug_pattern = re.compile(pattern, re.IGNORECASE)

        logger.info(f"DrugNER initialized with {len(self._variant_map)} drug variants")

    def extract(self, text: str) -> List[Dict]:
        """Extract all drug mentions from text.

        For each unique drug found, extracts:
        - drug_name: the raw text as it appeared
        - drug_normalized: canonical generic name
        - dosage: e.g., "500 mg" or None
        - frequency: e.g., "once daily" or None
        - confidence: 0.95 (lexicon match), 0.90 (regex match)

        Returns list of mention dicts.
        """
        if not text or not isinstance(text, str):
            return []

        mentions = []
        seen_generics = set()

        # Search for drug name matches in the text
        for match in self.drug_pattern.finditer(text):
            drug_raw = match.group(1)
            drug_lower = drug_raw.lower()

            # Normalize to generic name
            drug_normalized = self._variant_map.get(drug_lower)
            if drug_normalized is None:
                continue

            # Skip duplicates (only first mention of each generic drug)
            if drug_normalized in seen_generics:
                continue
            seen_generics.add(drug_normalized)

            # Determine confidence
            # RxNorm match = 0.95, built-in lexicon match = 0.90
            if self.rxnorm_loader and self.rxnorm_loader.is_known_drug(drug_lower):
                confidence = 0.95
            else:
                confidence = 0.90

            # Extract dosage and frequency from context window around the match
            # Use ±100 char window for better context capture
            context_start = max(0, match.start() - 100)
            context_end = min(len(text), match.end() + 100)
            context = text[context_start:context_end]

            # If spaCy is available, use it for sentence-level context
            if self.nlp is not None:
                context = self._get_spacy_context(text, match.start(), match.end())

            dosage = self._extract_dosage(context)
            frequency = self._extract_frequency(context)

            mentions.append({
                "drug_name": drug_raw,
                "drug_normalized": drug_normalized,
                "dosage": dosage,
                "frequency": frequency,
                "confidence": confidence,
            })

        return mentions

    def _get_spacy_context(self, full_text: str, start: int, end: int) -> str:
        """Use spaCy to extract the sentence(s) containing the drug mention.

        This gives better context boundaries than a fixed character window.
        """
        try:
            doc = self.nlp(full_text)
            # Find sentences that overlap with the drug mention span
            relevant_sents = []
            for sent in doc.sents:
                if sent.start_char <= end and sent.end_char >= start:
                    relevant_sents.append(sent.text)
                # Also include the sentence immediately before and after
                elif sent.end_char <= start and sent.end_char >= start - 5:
                    relevant_sents.append(sent.text)
                elif sent.start_char >= end and sent.start_char <= end + 5:
                    relevant_sents.append(sent.text)

            if relevant_sents:
                return ' '.join(relevant_sents)
        except Exception as e:
            logger.debug(f"spaCy context extraction failed: {e}")

        # Fallback to character window
        context_start = max(0, start - 100)
        context_end = min(len(full_text), end + 100)
        return full_text[context_start:context_end]

    def _extract_dosage(self, context: str) -> Optional[str]:
        """Extract dosage from context around a drug mention.

        Matches patterns like: 500 mg, 1.5 ml, 20 units
        Returns the first match found.
        """
        match = DOSAGE_PATTERN.search(context)
        if match:
            return match.group(0).strip()
        return None

    def _extract_frequency(self, context: str) -> Optional[str]:
        """Extract dosing frequency from context around a drug mention.

        Matches patterns like: once daily, twice weekly, every other day
        Returns the first match found (patterns ordered by specificity).
        """
        for pattern, freq_label in FREQUENCY_PATTERNS:
            if pattern.search(context):
                return freq_label
        return None

    def contains_target_drug(self, text: str) -> bool:
        """Quick check if text mentions any target drug."""
        if not text:
            return False
        text_lower = text.lower()
        return any(drug in text_lower for drug in DRUG_LEXICON)

    def get_display_name(self, generic_name: str) -> str:
        """Get the display-friendly name for a normalized drug."""
        return DRUG_DISPLAY_NAMES.get(generic_name, generic_name.title())


# Module-level singleton (created without spaCy/RxNorm — pipeline injects these)
drug_ner = DrugNER()
