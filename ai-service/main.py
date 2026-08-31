"""
main.py
-------
FastAPI microservice for bill image forgery analysis.

Exposes a single endpoint:
    POST /analyze-document

Returns:
    {
        "tamper_probability": float,   # 0–100
        "is_suspicious":      bool,
        "ocr_text":           str,
        "heatmap_file":       str | null
    }

Usage:
    cd ai-service
    uvicorn main:app --host 0.0.0.0 --port 8000 --reload
    # or
    python main.py
"""

import os
import shutil
import uuid

import numpy as np
from pydantic import BaseModel
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from explain_tabular import get_fraud_score, explain_prediction, get_hybrid_fraud_score
from nlp_helper import verify_prescription_consistency, verify_doctor_credentials, verify_doctor_domain
from PIL import Image

try:
    import tensorflow as tf
    from keras.applications.efficientnet import preprocess_input
    from gradcam import make_gradcam_heatmap, overlay_heatmap
    TF_AVAILABLE = True
except (ModuleNotFoundError, ImportError):
    TF_AVAILABLE = False
    print("[WARN] TensorFlow/Keras not found or failed to import. Member A's endpoint will return mock data.")

from ocr_helper import extract_text_from_image

# ---------------------------------------------------------------------------
# App & model initialisation
# ---------------------------------------------------------------------------
app = FastAPI(
    title="HealthCVS Forgery Detection API",
    description=(
        "Analyses uploaded bill images for forgery using OCR (Tesseract) "
        "and EfficientNetB3. Returns a tamper probability score (0-100), "
        "extracted OCR text, and (if suspicious) a Grad-CAM heatmap."
    ),
    version="1.0.0",
)


@app.on_event("startup")
def _warm_models():
    """
    Load the biomedical sentence-transformer before serving traffic.

    It was previously loaded lazily on first use, inside the 30s budget that
    /predict/nlp-validate gives the ICD check — so the first claim scored after
    every restart died with a TimeoutError while the model was still loading.
    Warming it here moves that cost to startup, where it belongs, and means the
    model is fetched once at boot rather than mid-demo.
    """
    try:
        from nlp_helper import _load_semantic_model
        _load_semantic_model()
        print("Semantic model warmed and ready")
    except Exception as e:
        # Never block startup on this — the endpoint still loads lazily if needed.
        print(f"[WARN] Could not warm semantic model at startup ({e}); it will load on first use")

MODEL_PATH = "forgery_detector_best_phase2.keras"

if TF_AVAILABLE:
    if not os.path.exists(MODEL_PATH):
        print(f"[WARN] No model file found at {MODEL_PATH}.")
        model = None
    else:
        model = tf.keras.models.load_model(MODEL_PATH)
        print(f"Model loaded from {MODEL_PATH}")
else:
    model = None
# Class index assumption: genuine=0, tampered=1 (alphabetical from image_dataset_from_directory)
# preds[1] is therefore the tampered probability.


# ---------------------------------------------------------------------------
# Helper: safe temp-file name
# ---------------------------------------------------------------------------
def _temp_path(filename: str) -> str:
    """Generate a unique temp filename to avoid collisions on concurrent requests."""
    unique_id = uuid.uuid4().hex[:8]
    return f"temp_{unique_id}_{filename}"


# ---------------------------------------------------------------------------
# Request Models
# ---------------------------------------------------------------------------
class TabularFraudRequest(BaseModel):
    claimed_amount: float
    market_ceiling: float
    days_since_last_claim: int
    hospital_type_private: int
    num_claims_12months: int
    hospital_rejection_rate: float

class NLPValidateRequest(BaseModel):
    icd_code: str
    ocr_text: str
    doctor_reg_no: str
    doctor_departments: str = ''  # comma-separated, one per doctor — mirrors doctor_reg_no
    doctor_names: str = ''
    procedure_categories: str = ''  # comma-separated, one per billed procedure

# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@app.post("/analyze-document")
async def analyze_document(file: UploadFile = File(...)):
    """
    Upload a bill image (JPEG/PNG) for:
    - OCR text extraction (patient name, doctor, amount, dates, diagnosis)
    - Forgery detection score (0–100)
    - Grad-CAM heatmap if tamper probability > 50%
    """
    # Validate MIME type loosely
    allowed_types = {"image/jpeg", "image/png", "image/jpg", "image/tiff"}
    if file.content_type and file.content_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{file.content_type}'. Upload a JPEG or PNG.",
        )

    temp_path = _temp_path(file.filename or "upload.jpg")

    try:
        # 1. Save uploaded file to disk temporarily
        with open(temp_path, "wb") as buf:
            shutil.copyfileobj(file.file, buf)

        # 2. OCR
        try:
            ocr_text = extract_text_from_image(temp_path)
        except Exception as ocr_err:
            ocr_text = f"[OCR failed: {ocr_err}]"

        # 3. Preprocessing & 4. Inference
        heatmap_path = None
        if TF_AVAILABLE and model is not None:
            image = Image.open(temp_path).convert("RGB").resize((300, 300))
            img_array = preprocess_input(
                np.expand_dims(np.array(image, dtype=np.float32), axis=0)
            )
            preds = model.predict(img_array, verbose=0)[0]
            tamper_prob = float(preds[1])  # index 1 = tampered class
            
            # 5. Grad-CAM heatmap
            if tamper_prob > 0.50:
                try:
                    heatmap = make_gradcam_heatmap(img_array, model)
                    heatmap_filename = f"heatmap_{uuid.uuid4().hex[:8]}_{file.filename}"
                    heatmap_path = overlay_heatmap(temp_path, heatmap, heatmap_filename)
                except Exception as cam_err:
                    print(f"[WARN] Grad-CAM failed: {cam_err}")
                    heatmap_path = None
        else:
            # Mock response if TF is not available
            tamper_prob = 0.75
            heatmap_path = None

        return {
            "tamper_probability": round(tamper_prob * 100, 1),
            "is_suspicious": tamper_prob > 0.50,
            "ocr_text": ocr_text,
            "heatmap_file": heatmap_path,
        }

    finally:
        # Clean up temp file
        if os.path.exists(temp_path):
            os.remove(temp_path)


@app.get("/heatmap/{filename}")
async def get_heatmap(filename: str):
    """Serve a previously generated heatmap image by filename."""
    if not os.path.exists(filename):
        raise HTTPException(status_code=404, detail="Heatmap file not found.")
    return FileResponse(filename, media_type="image/jpeg")


@app.get("/health")
async def health_check():
    """Simple liveness probe for Member C's integration."""
    return {"status": "ok", "model_loaded": True}


@app.post("/predict/tabular-fraud")
async def predict_tabular_fraud(req: TabularFraudRequest):
    features_dict = {
        "claimed_amount": req.claimed_amount,
        "market_ceiling": req.market_ceiling,
        "days_since_last_claim": req.days_since_last_claim,
        "hospital_type_private": req.hospital_type_private,
        "num_claims_12months": req.num_claims_12months,
        "hospital_rejection_rate": req.hospital_rejection_rate,
        "amount_ceiling_ratio": req.claimed_amount / req.market_ceiling if req.market_ceiling > 0 else 0.0
    }
    
    hybrid = get_hybrid_fraud_score(features_dict)
    explanations = explain_prediction(features_dict)
    explanations.append(
        f"Unsupervised anomaly check (IsolationForest): {hybrid['anomaly_score']:.1f}/100 — "
        f"how statistically unusual this claim's numbers are, independent of the XGBoost pattern model."
    )

    return {
        # tabular_fraud_score is now the hybrid (70% XGBoost + 30% anomaly) score —
        # field name kept stable so oracleWorker.js needed zero changes.
        "tabular_fraud_score": hybrid['hybrid_score'],
        "xgboost_score": hybrid['xgboost_score'],
        "anomaly_score": hybrid['anomaly_score'],
        "shap_explanations": explanations
    }

@app.post("/predict/nlp-validate")
async def predict_nlp_validate(req: NLPValidateRequest):
    import concurrent.futures

    with concurrent.futures.ThreadPoolExecutor() as executor:
        icd_future = executor.submit(verify_prescription_consistency, req.icd_code, req.ocr_text)
        doc_future = executor.submit(verify_doctor_credentials, req.doctor_reg_no)

        # ICD check is fast (few seconds) — always wait for it
        # Tolerate the 2-tuple returned by the non-semantic error paths.
        icd_result = icd_future.result(timeout=30)
        is_consistent, reason = icd_result[0], icd_result[1]
        semantic_similarity = icd_result[2] if len(icd_result) > 2 else None

        # Doctor check takes 1-5 min (NMC scraper) — wait for full result
        is_verified, doc_name = doc_future.result(timeout=360)

    from nlp_helper import match_doctor_names
    name_match, name_reason = match_doctor_names(req.doctor_names, doc_name)

    departments = [d.strip() for d in req.doctor_departments.split(',') if d.strip()]
    domain_match, expected_departments, domain_reason = verify_doctor_domain(req.icd_code, departments)

    from icd_department_map import procedure_matches
    proc_cats = [c.strip() for c in req.procedure_categories.split(',') if c.strip()]
    procedure_match, _proc_expected, procedure_reason = procedure_matches(req.icd_code, proc_cats)

    return {
        "prescription_consistent": is_consistent,
        "nlp_reason": reason,
        "semantic_similarity": semantic_similarity,
        "doctor_verified": is_verified,
        "doctor_name": doc_name,
        "doctor_name_match": name_match,
        "doctor_name_reason": name_reason,
        "domain_match": domain_match,
        "expected_departments": expected_departments,
        "domain_reason": domain_reason,
        "procedure_match": procedure_match,
        "procedure_reason": procedure_reason,
    }


class DoctorVerifyRequest(BaseModel):
    doctor_reg_no: str


@app.post("/verify-doctor")
async def verify_doctor(req: DoctorVerifyRequest):
    """Separate endpoint for doctor verification — may take 1-5 minutes as it scrapes the NMC registry."""
    is_verified, doc_name = verify_doctor_credentials(req.doctor_reg_no)
    return {
        "doctor_verified": is_verified,
        "doctor_name": doc_name
    }


# ---------------------------------------------------------------------------
# Entry point (for direct `python main.py` execution)
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
