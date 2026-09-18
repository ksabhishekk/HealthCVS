"""
document_checks.py
------------------
Examines every supporting document on a claim, not just the bill.

Why this exists: the pipeline only ever looked at the hospital bill. A clerk
could put a supermarket receipt in the "insurance card" slot, upload one image
to all five slots, or attach somebody else's Aadhaar card, and nothing noticed.
This module OCRs each supporting document and answers three questions:

  1. Is this plausibly the kind of document its slot asks for?
  2. Does an identity document carry an Aadhaar/PAN that could be compared
     with the patient on the claim?
  3. Does the insurance card show the claim's policy number, and do the
     clinical papers mention the claimed diagnosis?

Raw identifiers are returned only as *candidates* to the calling oracle, which
hashes and compares them in memory; they must never be persisted or pinned.

Aadhaar candidates are filtered through the Verhoeff checksum UIDAI uses for
the 12th digit. That does double duty here: it rejects fabricated numbers, and
because Verhoeff catches every single-digit error, it also discards numbers
OCR has misread — so a candidate that passes is very unlikely to be a misread
of the patient's real number.

Everything is keyword heuristics over noisy OCR. A slot is only reported as
mismatched when the document is readable and shows too little of what the slot
should contain; unreadable documents are reported as "not checked".
"""

import re

# ── Verhoeff checksum (UIDAI Aadhaar check digit) ────────────────────────────
_D = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6], [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4], [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
]
_P = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2], [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
]
_INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9]


def verhoeff_valid(number: str) -> bool:
    c = 0
    for i, ch in enumerate(reversed(number)):
        c = _D[c][_P[i % 8][int(ch)]]
    return c == 0


def verhoeff_check_digit(partial: str) -> int:
    c = 0
    for i, ch in enumerate(reversed(partial)):
        c = _D[c][_P[(i + 1) % 8][int(ch)]]
    return _INV[c]


def is_valid_aadhaar(number: str) -> bool:
    """12 digits, first digit 2-9 (0 and 1 are reserved by UIDAI), Verhoeff-valid."""
    return bool(re.fullmatch(r"[2-9]\d{11}", number or "")) and verhoeff_valid(number)


# ── Slot vocabulary ──────────────────────────────────────────────────────────
_KYC = [
    "aadhaar", "unique identification", "government of india", "uidai", "enrolment",
    "income tax department", "permanent account number", "date of birth", "dob",
    "year of birth", "vid",
]
SLOT_TERMS = {
    "hospital_bill": [
        "bill", "invoice", "amount payable", "total amount", "net payable", "bill no",
        "receipt no", "particulars", "balance", "gst", "discharge date", "admission date",
    ],
    "insurance_card": [
        "policy no", "policy number", "policy holder", "policyholder", "sum insured",
        "insured", "insurance", "health card", "e-card", "member id", "valid from",
        "valid till", "valid upto", "tpa", "coverage", "premium", "policy",
    ],
    "patient_kyc": _KYC,
    "employee_id": _KYC,
    "proposer_id": _KYC,
    "consultation_papers": [
        "rx", "prescription", "diagnosis", "advice", "advised", "complaints", "c/o",
        "history", "examination", "o/e", "tab", "cap", "syrup", "twice daily", "follow up",
        "follow-up", "consultation", "opd", "impression", "chief complaint",
    ],
    "investigation_reports": [
        "report", "result", "reference range", "ref. range", "normal range", "specimen",
        "sample", "laboratory", "pathology", "haemoglobin", "hemoglobin", "radiology",
        "findings", "units", "collected on", "reported on", "investigation", "test name",
    ],
}
RETAIL_TERMS = [
    "cashier", "goods sold", "not returnable", "supermarket", "grocery", "mart",
    "barcode", "trolley", "checkout", "loyalty card", "please come again",
]
SLOT_LABELS = {
    "hospital_bill": "a hospital bill",
    "insurance_card": "an insurance card",
    "patient_kyc": "an identity document",
    "employee_id": "an identity document",
    "proposer_id": "an identity document",
    "consultation_papers": "consultation papers",
    "investigation_reports": "an investigation report",
    "retail": "a retail receipt",
}
MIN_TERMS = 2          # distinct slot terms required to accept a document
MIN_READABLE_CHARS = 25


def _hits(low: str, terms) -> list:
    found = []
    for term in terms:
        if re.search(r"(?<![a-z0-9])" + re.escape(term) + r"(?![a-z0-9])", low):
            found.append(term)
    return found


def _normalise(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (text or "").lower())


def extract_aadhaar_candidates(text: str) -> list:
    raw = re.findall(r"(?<!\d)([2-9]\d{3})[\s-]?(\d{4})[\s-]?(\d{4})(?!\d)", text or "")
    seen, out = set(), []
    for a, b, c in raw:
        n = a + b + c
        if n not in seen and verhoeff_valid(n):
            seen.add(n)
            out.append(n)
    return out


def extract_pan_candidates(text: str) -> list:
    return sorted(set(re.findall(r"(?<![A-Z0-9])([A-Z]{5}[0-9]{4}[A-Z])(?![A-Z0-9])", (text or "").upper())))


def analyse_supporting_text(text: str, expected_type: str, policy_number: str = "", diagnosis_terms: str = "") -> dict:
    text = text or ""
    low = text.lower()
    readable = len(re.sub(r"[^a-z0-9]", "", low)) >= MIN_READABLE_CHARS and not text.startswith("[OCR failed")

    result = {
        "readable": readable,
        "expected_type": expected_type,
        "slot_match": None,
        "detected_type": None,
        "reason": "",
        "aadhaar_candidates": [],
        "pan_candidates": [],
        "policy_number_found": None,
        "diagnosis_mentioned": None,
    }
    if not readable:
        result["reason"] = f"No readable text in the document uploaded as {SLOT_LABELS.get(expected_type, expected_type)} — not checked."
        return result

    scores = {slot: len(_hits(low, terms)) for slot, terms in SLOT_TERMS.items()}
    scores["retail"] = len(_hits(low, RETAIL_TERMS))
    best = max(scores, key=scores.get)
    result["detected_type"] = best if scores[best] >= MIN_TERMS else None

    expected_score = scores.get(expected_type, 0)
    label = SLOT_LABELS.get(expected_type, expected_type)
    if scores["retail"] >= MIN_TERMS and scores["retail"] >= expected_score:
        result["slot_match"] = False
        result["reason"] = f"Uploaded as {label}, but it reads as a retail receipt."
    elif expected_score >= MIN_TERMS:
        result["slot_match"] = True
        result["reason"] = f"Reads as {label}."
    else:
        result["slot_match"] = False
        detected = result["detected_type"]
        other = SLOT_LABELS.get(detected) if detected and SLOT_LABELS.get(detected) != label else None
        result["reason"] = (
            f"Uploaded as {label}, but it reads as {other}." if other
            else f"Uploaded as {label}, but it contains little of what that document should show."
        )

    if expected_type in ("patient_kyc", "employee_id", "proposer_id"):
        result["aadhaar_candidates"] = extract_aadhaar_candidates(text)
        result["pan_candidates"] = extract_pan_candidates(text)

    if expected_type == "insurance_card" and policy_number:
        needle = _normalise(policy_number)
        result["policy_number_found"] = bool(needle) and needle in _normalise(text)

    if expected_type in ("consultation_papers", "investigation_reports"):
        terms = [t.strip().lower() for t in (diagnosis_terms or "").split(",") if len(t.strip()) >= 4]
        if terms:
            result["diagnosis_mentioned"] = bool(_hits(low, terms))

    return result
