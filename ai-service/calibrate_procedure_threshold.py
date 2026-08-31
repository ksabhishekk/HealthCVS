"""
Calibrates PROCEDURE_MATCH_THRESHOLD in nlp_helper.py.

Procedure-vs-diagnosis compares a *treatment* to a *condition*, which are
related but lexically different, so similarity runs lower than the
diagnosis-vs-diagnosis comparison SEMANTIC_MATCH_THRESHOLD was tuned for.
Reusing 0.86 there would false-flag almost every legitimate claim.

As everywhere else in this project, there is no labelled dataset — these pairs
are hand-built and the resulting threshold is a judgement call, not a measured
optimum. Re-run if the embedding model changes.
"""
from nlp_helper import _load_semantic_model
from sentence_transformers import util

MATCHES = [
    ("Malignant neoplasm of occipital lobe", "Craniotomy for tumour excision"),
    ("Influenza due to identified novel influenza A virus with pneumonia", "Management of viral pneumonia"),
    ("Fracture of shaft of femur", "Open reduction and internal fixation of femur"),
    ("Acute appendicitis with localized peritonitis", "Laparoscopic appendectomy"),
    ("Age-related nuclear cataract", "Cataract surgery with intraocular lens implantation"),
    ("Chronic kidney disease stage 5", "Haemodialysis session"),
]
MISMATCHES = [
    ("Influenza due to identified novel influenza A virus with pneumonia", "Craniotomy for tumour excision"),
    ("Malignant neoplasm of occipital lobe", "Laparoscopic appendectomy"),
    ("Fracture of shaft of femur", "Cataract surgery with intraocular lens implantation"),
    ("Acute appendicitis with localized peritonitis", "Coronary artery bypass grafting"),
    ("Age-related nuclear cataract", "Open reduction and internal fixation of femur"),
    ("Chronic kidney disease stage 5", "Tonsillectomy"),
]

def score(model, pairs, label):
    out = []
    for dx, proc in pairs:
        a = model.encode(dx.lower(), convert_to_tensor=True)
        b = model.encode(proc.lower(), convert_to_tensor=True)
        sim = float(util.cos_sim(a, b)[0][0])
        out.append(sim)
        print(f"  {sim:.3f}  {label}  {proc[:45]:<45} <- {dx[:45]}")
    return out

if __name__ == "__main__":
    model = _load_semantic_model()
    print("\nTRUE MATCHES (procedure treats the diagnosis):")
    m = score(model, MATCHES, "MATCH   ")
    print("\nTRUE MISMATCHES (unrelated procedure):")
    x = score(model, MISMATCHES, "MISMATCH")
    print(f"\nmatches   : min {min(m):.3f}  max {max(m):.3f}")
    print(f"mismatches: min {min(x):.3f}  max {max(x):.3f}")
    print(f"margin    : {min(m) - max(x):+.3f}")
    print(f"suggested threshold (midpoint): {(min(m) + max(x)) / 2:.3f}")
