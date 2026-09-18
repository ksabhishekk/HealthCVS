"""
bill_reconciliation.py
----------------------
Reads the OCR text of an uploaded hospital bill and checks it actually supports
the claim filed against it.

Why this exists: the CV forgery model answers "has this image been edited?" It
does not answer "does this bill belong to this claim?" A genuine, unedited bill
for a different patient, hospital, date and amount scored 39/100 (clean) while
the claim asked for 2.3x the billed total. Nothing in the pipeline compared the
two. Reconciling the billed total against the claimed amount is the single
highest-value fraud check available here, because inflating a claim above the
real bill is the most common claim fraud there is.

Everything here is heuristic and OCR is noisy, so the rule throughout is:
a field that cannot be parsed is reported as "not checked", never as a
mismatch. Only findings we can actually support are returned.
"""

import re
from datetime import datetime

# ── Document type ────────────────────────────────────────────────────────────
# Coarse keyword vote. Not a classifier — it only needs to separate a hospital
# bill from an obviously non-medical document (a supermarket or retail receipt).
MEDICAL_TERMS = [
    "patient", "admission", "discharge", "diagnosis", "consultation", "nursing",
    "ward", "bed no", "hospital", "clinic", "doctor", "physician", "prescription",
    "pharmacy", "pathology", "laboratory", "lab test", "blood test", "treatment",
    "ipd", "opd", "uhid", "mrn", "surgery", "surgical", "injection", "dressing",
    "medicine", "multispeciality", "multispecialty", "medical", "consulting",
    "x-ray", "scan", "mri", "ct scan", "ultrasound", "operation theatre",
]
RETAIL_TERMS = [
    "cashier", "goods sold", "not returnable", "supermarket", "grocery", "mart",
    "barcode", "mrp", "trolley", "checkout", "loyalty card", "store no",
    "please come again", "exchange within",
]
MIN_MEDICAL_TERMS = 3


def classify_document(ocr_text: str):
    """Returns (is_medical_bill, reason). None when there is no text to judge."""
    if not ocr_text or ocr_text.startswith("[OCR failed"):
        return None, "No readable text extracted from the document — type not checked."

    low = ocr_text.lower()
    med_hits = sorted({t for t in MEDICAL_TERMS if t in low})
    retail_hits = sorted({t for t in RETAIL_TERMS if t in low})

    if len(med_hits) >= MIN_MEDICAL_TERMS and len(med_hits) > len(retail_hits):
        return True, f"Reads as a medical bill ({len(med_hits)} medical terms found)."
    if retail_hits and len(retail_hits) >= len(med_hits):
        return False, (
            f"Does not read as a medical bill — retail receipt wording found "
            f"({', '.join(retail_hits[:4])}) and only {len(med_hits)} medical terms."
        )
    return False, (
        f"Does not read as a medical bill — only {len(med_hits)} medical terms found "
        f"(expected at least {MIN_MEDICAL_TERMS})."
    )


# ── Field extraction ─────────────────────────────────────────────────────────
_AMOUNT = r"(?:rs\.?|inr|\u20b9)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)"
# Ordered by trust: the final payable beats a pre-tax subtotal.
_TOTAL_LABELS = [
    "amount payable", "net payable", "grand total", "balance",
    "total bill amount", "total amount", "subtotal", "total",
]
_DATE_FORMATS = ["%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%Y/%m/%d", "%d %b %Y", "%d %B %Y"]


def _parse_date(raw: str):
    raw = raw.strip().rstrip(".,")
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    return None


def _find_labelled_amount(low: str):
    for label in _TOTAL_LABELS:
        m = re.search(re.escape(label) + r"\s*[:\-]?\s*" + _AMOUNT, low)
        if m:
            try:
                return float(m.group(1).replace(",", "")), label
            except ValueError:
                continue
    return None, None


def _find_labelled_date(low: str, *labels):
    for label in labels:
        m = re.search(re.escape(label) + r"\s*[:\-]?\s*([0-9]{1,4}[-/ ][0-9a-z]{1,9}[-/ ][0-9]{2,4})", low)
        if m:
            d = _parse_date(m.group(1))
            if d:
                return d
    return None


def parse_bill(ocr_text: str) -> dict:
    """Best-effort extraction. Any field that cannot be read comes back as None."""
    low = (ocr_text or "").lower()
    total, label = _find_labelled_amount(low)

    name = None
    m = re.search(r"\bname\s*[:\-]\s*([a-z][a-z .]{2,40})", low)
    if m:
        name = m.group(1).strip()

    return {
        "total_amount": total,
        "total_label": label,
        "patient_name": name,
        "admission_date": _find_labelled_date(low, "admission date", "date of admission", "doa"),
        "discharge_date": _find_labelled_date(low, "discharge date", "date of discharge", "dod"),
    }


# ── Reconciliation ───────────────────────────────────────────────────────────
# Tolerances are deliberately loose: OCR misreads digits, and bills legitimately
# differ from a claim by taxes, rounding or non-claimable line items.
OVERCLAIM_TOLERANCE = 0.10   # claiming >10% above the billed total is a finding
DATE_TOLERANCE_DAYS = 2


def reconcile(ocr_text: str, claim: dict) -> dict:
    """
    claim keys (all optional): claimed_amount, patient_name,
    admission_date, discharge_date (ISO strings).
    Returns a verdict plus the individual findings.
    """
    is_medical, type_reason = classify_document(ocr_text)
    parsed = parse_bill(ocr_text)

    findings = []      # checked, and the bill contradicts the claim
    unchecked = []     # could not be checked — a data-quality issue, not evidence
    overclaim_ratio = None

    billed = parsed["total_amount"]
    claimed = claim.get("claimed_amount")
    if billed and claimed:
        if claimed > billed * (1 + OVERCLAIM_TOLERANCE):
            overclaim_ratio = claimed / billed
            findings.append(
                f"Claimed \u20b9{claimed:,.0f} but the bill totals \u20b9{billed:,.2f} "
                f"({overclaim_ratio:.1f}x the billed amount)."
            )
    elif claimed and not billed:
        # Deliberately NOT a discrepancy. "We could not check" is a data-quality
        # problem; presenting it as fraud evidence alongside a real contradiction
        # devalues both. A reviewer needs to know the amount is unverified so
        # they demand a legible bill, not so they suspect the hospital.
        unchecked.append("Could not read a total from the bill — the claimed amount has not been verified against it.")

    from nlp_helper import match_doctor_names  # token-overlap comparison, tolerates honorifics
    if parsed["patient_name"] and claim.get("patient_name"):
        ok, _ = match_doctor_names(claim["patient_name"], parsed["patient_name"])
        if not ok:
            findings.append(
                f"Bill is made out to '{parsed['patient_name']}' but the claim names "
                f"'{claim['patient_name']}'."
            )

    for key, label in (("admission_date", "Admission"), ("discharge_date", "Discharge")):
        bill_date, claim_raw = parsed[key], claim.get(key)
        if bill_date and claim_raw:
            claim_date = _parse_date(str(claim_raw)[:10])
            if claim_date and abs((claim_date - bill_date).days) > DATE_TOLERANCE_DAYS:
                findings.append(
                    f"{label} date on the bill ({bill_date}) does not match the claim ({claim_date})."
                )

    if is_medical is None:
        unchecked.append(type_reason)

    return {
        "is_medical_bill": is_medical,
        "document_type_reason": type_reason,
        "billed_total": billed,
        "billed_total_label": parsed["total_label"],
        "overclaim_ratio": overclaim_ratio,
        "discrepancies": findings,
        "unchecked": unchecked,
        "reconciled": is_medical is not False and not findings,
    }
