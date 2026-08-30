"""
calibrate_semantic_threshold.py
--------------------------------
One-off calibration script for the semantic-similarity threshold used in
nlp_helper.py's verify_prescription_consistency(). Not called at runtime.

No real labeled (ICD code, OCR prescription text, is-actually-consistent)
dataset exists for this project, so this calibrates against a small,
hand-constructed set of clearly-correct and clearly-wrong pairs instead —
the same honest limitation as the tabular model's synthetic training data.
Re-run this against real claim text once some accumulates, and update
SEMANTIC_MATCH_THRESHOLD in nlp_helper.py if the numbers shift.

Usage:
    cd ai-service
    python calibrate_semantic_threshold.py
"""
from sentence_transformers import SentenceTransformer, util

MODEL_NAME = "pritamdeka/S-PubMedBert-MS-MARCO"
FALLBACK_MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"

# (icd_description, ocr_text_line, should_match)
TEST_PAIRS = [
    ("Essential (primary) hypertension",
     "Patient diagnosed with high blood pressure, prescribed amlodipine 5mg once daily.", True),
    ("Acute myocardial infarction",
     "Patient had a heart attack, ECG showed ST elevation, started on aspirin and clopidogrel.", True),
    ("Type 2 diabetes mellitus without complications",
     "Patient complains of frequent urination and elevated blood sugar, HbA1c 9.2%, metformin prescribed.", True),
    ("Acute appendicitis",
     "Patient presented with right lower quadrant pain and fever, appendectomy performed.", True),
    ("Essential (primary) hypertension",
     "Patient presents with fracture of the right femur, ORIF performed under general anesthesia.", False),
    ("Type 2 diabetes mellitus without complications",
     "Patient underwent cataract surgery in the left eye, IOL implanted.", False),
    ("Acute myocardial infarction",
     "Routine antenatal checkup, 28 weeks gestation, fetal heart rate normal.", False),
    ("Acute appendicitis",
     "Patient seen for chronic lower back pain, prescribed physiotherapy and painkillers.", False),
]


def load_model():
    try:
        return SentenceTransformer(MODEL_NAME)
    except Exception as e:
        print(f"[WARN] Could not load {MODEL_NAME} ({e}), falling back to {FALLBACK_MODEL_NAME}")
        return SentenceTransformer(FALLBACK_MODEL_NAME)


def main():
    model = load_model()

    match_scores = []
    mismatch_scores = []

    print(f"{'Should match':<14}{'Score':<8}Pair")
    print("-" * 90)
    for icd_desc, ocr_line, should_match in TEST_PAIRS:
        emb = model.encode([icd_desc.lower(), ocr_line.lower()], convert_to_tensor=True)
        score = util.cos_sim(emb[0], emb[1]).item()
        (match_scores if should_match else mismatch_scores).append(score)
        print(f"{str(should_match):<14}{score:<8.3f}'{icd_desc}' vs '{ocr_line[:60]}...'")

    min_match = min(match_scores)
    max_mismatch = max(mismatch_scores)
    print("\n" + "=" * 90)
    print(f"Lowest true-match score:    {min_match:.3f}")
    print(f"Highest true-mismatch score: {max_mismatch:.3f}")

    if min_match > max_mismatch:
        suggested = (min_match + max_mismatch) / 2
        print(f"Clean separation. Suggested threshold (midpoint): {suggested:.3f}")
    else:
        print("WARNING: match/mismatch scores overlap on this test set — pick a threshold "
              "that favors fewer false positives (lean toward max_mismatch) and note the overlap.")


if __name__ == "__main__":
    main()
