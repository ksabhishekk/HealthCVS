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
import tensorflow as tf
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from PIL import Image
from tensorflow.keras.applications.efficientnet import preprocess_input  # CORRECTED

from gradcam import make_gradcam_heatmap, overlay_heatmap
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

MODEL_PATH = "forgery_detector_best_phase2.keras"

if not os.path.exists(MODEL_PATH):
    raise RuntimeError(
        f"No model file found at {MODEL_PATH}. Run train_model.py first to generate one."
    )

model: tf.keras.Model = tf.keras.models.load_model(MODEL_PATH)
print(f"Model loaded from {MODEL_PATH}")
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
# Endpoint
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

        # 3. Preprocessing — CORRECTED: use preprocess_input (not /255.0)
        image = Image.open(temp_path).convert("RGB").resize((300, 300))
        img_array = preprocess_input(
            np.expand_dims(np.array(image, dtype=np.float32), axis=0)
        )

        # 4. Inference
        preds = model.predict(img_array, verbose=0)[0]
        tamper_prob = float(preds[1])  # index 1 = tampered class

        # 5. Grad-CAM heatmap (only when suspicious)
        heatmap_path = None
        if tamper_prob > 0.50:
            try:
                heatmap = make_gradcam_heatmap(img_array, model)
                heatmap_filename = f"heatmap_{uuid.uuid4().hex[:8]}_{file.filename}"
                heatmap_path = overlay_heatmap(temp_path, heatmap, heatmap_filename)
            except Exception as cam_err:
                # Heatmap failure is non-fatal; log and continue
                print(f"[WARN] Grad-CAM failed: {cam_err}")
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


# ---------------------------------------------------------------------------
# Entry point (for direct `python main.py` execution)
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
