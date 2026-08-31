"""
icd_department_map.py
----------------------
Maps ICD-10-CM diagnosis codes to the medical department(s) that would
plausibly treat that diagnosis, so a claim can be checked for a doctor
whose department/specialization doesn't match what they're claiming to
have treated (e.g. an ENT surgeon signing off on a cardiac bypass claim).

This is a coarse, chapter-level mapping (ICD-10's own top-level grouping),
not a clinical-grade specialty ontology — it is meant to catch obviously
wrong domain pairings, not adjudicate genuinely ambiguous borderline cases.
Multi-disciplinary chapters (e.g. injuries) map to several acceptable
departments on purpose, to avoid false positives.
"""

import re

# (code_prefix_start, code_prefix_end_inclusive_first_char_plus_range, departments)
# ICD-10-CM chapters are identified by the leading letter + numeric range.
# We match on the letter + first two digits of the code.
CHAPTER_RANGES = [
    ("A00", "B99", ["general medicine", "infectious disease", "internal medicine"]),
    ("C00", "D49", ["oncology", "surgical oncology", "medical oncology", "hematology"]),
    ("D50", "D89", ["hematology", "immunology", "general medicine"]),
    ("E00", "E89", ["endocrinology", "general medicine", "internal medicine"]),
    ("F01", "F99", ["psychiatry", "mental health", "psychology"]),
    ("G00", "G99", ["neurology", "neurosurgery"]),
    ("H00", "H59", ["ophthalmology", "eye"]),
    ("H60", "H95", ["ent", "otolaryngology", "ear nose throat"]),
    ("I00", "I99", ["cardiology", "cardiac surgery", "cardiothoracic", "vascular surgery"]),
    ("J00", "J99", ["pulmonology", "respiratory medicine", "general medicine", "ent"]),
    ("K00", "K95", ["gastroenterology", "general surgery", "hepatology"]),
    ("L00", "L99", ["dermatology"]),
    ("M00", "M99", ["orthopedics", "orthopaedics", "rheumatology"]),
    ("N00", "N99", ["urology", "nephrology", "gynecology", "gynaecology"]),
    ("O00", "O99", ["obstetrics", "gynecology", "gynaecology"]),
    ("P00", "P96", ["neonatology", "pediatrics", "paediatrics"]),
    ("Q00", "Q99", ["pediatrics", "paediatrics", "genetics"]),
    ("R00", "R99", ["general medicine", "internal medicine", "emergency medicine"]),
    ("S00", "T88", ["orthopedics", "orthopaedics", "general surgery", "emergency medicine", "trauma"]),
    ("Z00", "Z99", ["general medicine", "internal medicine", "family medicine"]),
]


def _parse_code(icd_code: str):
    """Extract (letter, numeric) from an ICD-10 code like 'I21.4' -> ('I', 21)."""
    if not icd_code:
        return None
    m = re.match(r"^([A-Za-z])(\d{2})", icd_code.strip())
    if not m:
        return None
    return m.group(1).upper(), int(m.group(2))


def expected_departments_for_icd(icd_code: str):
    """Return the list of plausible department keywords for an ICD-10 code, or None if unmapped."""
    parsed = _parse_code(icd_code)
    if not parsed:
        return None
    letter, num = parsed

    for start, end, departments in CHAPTER_RANGES:
        start_letter, start_num = start[0], int(start[1:3])
        end_letter, end_num = end[0], int(end[1:3])

        if start_letter == end_letter:
            if letter == start_letter and start_num <= num <= end_num:
                return departments
        else:
            # Range spans multiple letters (only S00-T88 in our table)
            if letter == start_letter and num >= start_num:
                return departments
            if letter == end_letter and num <= end_num:
                return departments
            if start_letter < letter < end_letter:
                return departments

    return None


def department_matches(icd_code: str, doctor_departments: list[str]):
    """
    Check whether any of the treating doctors' departments/specializations
    plausibly cover the given ICD-10 diagnosis.

    Returns (match: bool | None, expected: list[str] | None, reason: str)
    match is None when the ICD code is missing/unmapped — meaning "not applicable",
    not "mismatch", so callers should not penalize an inconclusive check.
    """
    expected = expected_departments_for_icd(icd_code)
    if expected is None:
        return None, None, f"No department mapping available for ICD code '{icd_code}'."

    cleaned = [d.strip().lower() for d in doctor_departments if d and d.strip()]
    if not cleaned:
        return None, expected, "No doctor department/specialization on record to check."

    for dept in cleaned:
        for exp in expected:
            if exp in dept or dept in exp:
                return True, expected, f"Doctor department '{dept}' matches expected specialty for this diagnosis."

    return (
        False,
        expected,
        f"Treating doctor department(s) [{', '.join(cleaned)}] do not match the expected "
        f"specialty for this diagnosis ({', '.join(expected)}).",
    )


def procedure_matches(icd_code: str, procedure_categories: list[str]):
    """
    Check that at least one billed procedure belongs to a specialty that
    plausibly treats this diagnosis.

    Nothing previously linked the billed procedure to the diagnosis — the same
    procedure code was billed against a brain tumour and against influenza on
    consecutive claims and neither was flagged. Billing an expensive procedure
    for a cheap condition (upcoding) is a common real-world claim fraud.

    A semantic-similarity approach was tried first and rejected: procedure names
    and diagnosis descriptions are different *kinds* of text (a treatment vs a
    condition), and the biomedical embedding model separated valid from invalid
    pairs by only 0.001 — see calibrate_procedure_threshold.py. This reuses the
    same chapter mapping the doctor-domain check already relies on, which is
    deterministic and explainable.

    Returns (match, expected_departments, reason). match is None when the check
    cannot run — an unmapped ICD chapter, or procedures with no category on
    record — which is "not applicable", not a fraud signal.
    """
    expected = expected_departments_for_icd(icd_code)
    if not expected:
        return None, None, f"No department mapping available for ICD code '{icd_code}'."

    cats = [c.strip().lower() for c in (procedure_categories or []) if c and c.strip()]
    if not cats:
        return None, expected, "No procedure category on record to check."

    # One plausible procedure is enough: multi-procedure claims legitimately
    # bundle supporting work alongside the main treatment.
    for cat in cats:
        for dept in expected:
            if cat == dept or cat in dept or dept in cat:
                return True, expected, f"Billed procedure category '{cat}' matches the expected specialty for this diagnosis."

    return (
        False,
        expected,
        f"Billed procedure categories {cats} do not match any specialty that treats this diagnosis "
        f"({', '.join(expected)}) — a procedure unrelated to the diagnosis may indicate upcoding.",
    )
