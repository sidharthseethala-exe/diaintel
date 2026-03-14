"""
DiaIntel — RxNorm Drug Loader
Loads the RxNorm drug lexicon from rxnorm_drugs.json and provides
lookup functions for drug name normalization.

Provides:
- load_rxnorm()       → loads the JSON file, builds internal maps
- get_all_variants()  → returns {generic: [variant1, variant2, ...]}
- normalize_drug(name)→ maps any variant to its generic name
- get_drug_info(name) → returns full drug info dict (class, brands, rxcui)
- is_known_drug(name) → bool check

The JSON structure per drug:
{
  "metformin": {
    "generic": "metformin",
    "brands": ["Glucophage", "Glumetza", "Fortamet", "Riomet"],
    "class": "Biguanide",
    "rxcui": "6809",
    "variants": ["metformin", "glucophage", "glumetza", "fortamet"]
  },
  ...
}
"""

import json
import logging
import os
from typing import Dict, List, Optional

logger = logging.getLogger("diaintel.utils.rxnorm_loader")


class RxNormLoader:
    """Loads and queries the RxNorm drug name mapping."""

    def __init__(self):
        # Full drug data keyed by generic name
        self._drug_data: Dict[str, dict] = {}

        # Variant → generic name lookup (all lowercase)
        self._variant_to_generic: Dict[str, str] = {}

        # Generic → list of all variant names
        self._generic_to_variants: Dict[str, List[str]] = {}

        self.loaded = False

    def load(self, filepath: str = None):
        """Load drug mappings from rxnorm_drugs.json.

        Builds three internal indexes:
        1. _drug_data: full drug info keyed by generic name
        2. _variant_to_generic: any variant string → generic name
        3. _generic_to_variants: generic name → [all variants]
        """
        if filepath is None:
            filepath = os.path.join(
                os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
                "data", "rxnorm_drugs.json"
            )

        try:
            with open(filepath, "r") as f:
                raw_data = json.load(f)
        except FileNotFoundError:
            logger.warning(f"RxNorm file not found: {filepath} — using built-in defaults")
            raw_data = self._builtin_defaults()
        except Exception as e:
            logger.error(f"Error loading RxNorm data: {e} — using built-in defaults")
            raw_data = self._builtin_defaults()

        # Build indexes
        self._drug_data = {}
        self._variant_to_generic = {}
        self._generic_to_variants = {}

        for generic_name, info in raw_data.items():
            generic_lower = generic_name.lower()
            self._drug_data[generic_lower] = info

            # Collect all variant names for this drug
            variants = set()

            # Add the generic name itself
            variants.add(generic_lower)

            # Add explicit variants list
            for v in info.get("variants", []):
                variants.add(v.lower())

            # Add brand names
            for b in info.get("brands", []):
                variants.add(b.lower())

            # Add the generic field value
            gen_val = info.get("generic", "")
            if gen_val:
                variants.add(gen_val.lower())

            # Store
            variant_list = sorted(variants)
            self._generic_to_variants[generic_lower] = variant_list

            for v in variant_list:
                self._variant_to_generic[v] = generic_lower

        self.loaded = True
        total_variants = sum(len(v) for v in self._generic_to_variants.values())
        logger.info(
            f"RxNorm loaded: {len(self._drug_data)} drugs, "
            f"{total_variants} total variants from {filepath}"
        )

    def _builtin_defaults(self) -> dict:
        """Fallback drug data if JSON file is unavailable."""
        return {
            "metformin": {
                "generic": "metformin", "brands": ["Glucophage", "Glumetza", "Fortamet"],
                "class": "Biguanide", "rxcui": "6809",
                "variants": ["metformin", "glucophage", "glumetza", "fortamet"]
            },
            "semaglutide": {
                "generic": "semaglutide", "brands": ["Ozempic", "Wegovy"],
                "class": "GLP-1 Receptor Agonist", "rxcui": "1991302",
                "variants": ["semaglutide", "ozempic", "wegovy"]
            },
            "empagliflozin": {
                "generic": "empagliflozin", "brands": ["Jardiance"],
                "class": "SGLT2 Inhibitor", "rxcui": "1545653",
                "variants": ["empagliflozin", "jardiance"]
            },
            "sitagliptin": {
                "generic": "sitagliptin", "brands": ["Januvia"],
                "class": "DPP-4 Inhibitor", "rxcui": "593411",
                "variants": ["sitagliptin", "januvia"]
            },
            "dapagliflozin": {
                "generic": "dapagliflozin", "brands": ["Farxiga"],
                "class": "SGLT2 Inhibitor", "rxcui": "1373458",
                "variants": ["dapagliflozin", "farxiga"]
            },
            "dulaglutide": {
                "generic": "dulaglutide", "brands": ["Trulicity"],
                "class": "GLP-1 Receptor Agonist", "rxcui": "1551291",
                "variants": ["dulaglutide", "trulicity"]
            },
            "liraglutide": {
                "generic": "liraglutide", "brands": ["Victoza"],
                "class": "GLP-1 Receptor Agonist", "rxcui": "475968",
                "variants": ["liraglutide", "victoza"]
            },
            "glipizide": {
                "generic": "glipizide", "brands": ["Glucotrol"],
                "class": "Sulfonylurea", "rxcui": "4815",
                "variants": ["glipizide", "glucotrol"]
            },
        }

    def _ensure_loaded(self):
        """Auto-load if not yet loaded."""
        if not self.loaded:
            self.load()

    # ================================================================
    # Public API
    # ================================================================

    def get_all_variants(self) -> Dict[str, List[str]]:
        """Return {generic_name: [variant1, variant2, ...]} for all drugs."""
        self._ensure_loaded()
        return dict(self._generic_to_variants)

    def normalize_drug(self, name: str) -> Optional[str]:
        """Map any drug variant to its normalized generic name.

        Returns None if the name is not recognized.

        Examples:
            normalize_drug("Glucophage") → "metformin"
            normalize_drug("ozempic")    → "semaglutide"
            normalize_drug("aspirin")    → None
        """
        self._ensure_loaded()
        return self._variant_to_generic.get(name.lower())

    def is_known_drug(self, name: str) -> bool:
        """Check if a name matches any known drug variant."""
        self._ensure_loaded()
        return name.lower() in self._variant_to_generic

    def get_drug_info(self, name: str) -> Optional[dict]:
        """Get full drug info for a variant or generic name.

        Returns dict with: generic, brands, class, rxcui, variants
        Returns None if not recognized.
        """
        self._ensure_loaded()
        generic = self.normalize_drug(name)
        if generic is None:
            return None
        return self._drug_data.get(generic)

    def get_variant_to_generic_map(self) -> Dict[str, str]:
        """Return flat {variant: generic} map for all drugs."""
        self._ensure_loaded()
        return dict(self._variant_to_generic)


# Singleton instance
rxnorm_loader = RxNormLoader()


# ================================================================
# Module-level convenience functions
# ================================================================

def load_rxnorm(filepath: str = None):
    """Load the RxNorm lexicon."""
    rxnorm_loader.load(filepath)


def get_all_variants() -> Dict[str, List[str]]:
    """Return {generic: [variants]} for all drugs."""
    return rxnorm_loader.get_all_variants()


def normalize_drug(name: str) -> Optional[str]:
    """Normalize a drug name to its generic equivalent."""
    return rxnorm_loader.normalize_drug(name)
