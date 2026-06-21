# HealthCVS AI Service — Forgery Detection Microservice

A FastAPI microservice that analyses bill images for forgery using:
- **OCR** via Tesseract
- **Forgery Detection** via EfficientNetB3 (TensorFlow/Keras)
- **Grad-CAM** heatmaps to highlight suspicious regions

---

## Folder Structure

```
ai-service/
├── dataset/
│   ├── train/
│   │   ├── genuine/      ← 150+ clean bill images
│   │   └── tampered/     ← 150+ edited bill images
│   └── validation/
│       ├── genuine/      ← 40+ clean
│       └── tampered/     ← 40+ edited
├── ocr_helper.py         ← Tesseract OCR wrapper
├── train_model.py        ← One-time training script
├── gradcam.py            ← Grad-CAM heatmap generator
├── main.py               ← FastAPI server (port 8000)
├── requirements.txt
└── forgery_detector.h5   ← Created after training
```

---

## Step-by-Step Setup

### 1. Install Tesseract OCR

1. Download from: https://github.com/UB-Mannheim/tesseract/wiki
2. Run the Windows installer. Default path: `C:\Program Files\Tesseract-OCR\tesseract.exe`
3. The path is already set in `ocr_helper.py`. If you installed to a different location, update the `tesseract_cmd` line.

### 2. Install Python Packages

```bash
cd ai-service
pip install -r requirements.txt
```

### 3. Collect Dataset

Place images in the correct folders:

| Folder | Contents | Minimum |
|---|---|---|
| `dataset/train/genuine/` | Clean, unedited bill images | 150 |
| `dataset/train/tampered/` | Edited/forged bill images | 150 |
| `dataset/validation/genuine/` | Clean bills (held-out) | 40 |
| `dataset/validation/tampered/` | Tampered bills (held-out) | 40 |

**Where to get images:**
- Search Kaggle for "Document Forgery Detection Dataset"
- Take real bills and edit them in GIMP/Photoshop (change an amount digit, paste a seal, blur a signature)

### 4. Train the Model

> ⚠️ This takes 1–2 hours. Run it overnight.

```bash
cd ai-service
python train_model.py
```

This saves `forgery_detector.h5` (and `forgery_detector_best.h5` via early stopping).

### 5. Run the API Server

```bash
cd ai-service
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Interactive docs available at: **http://localhost:8000/docs**

---

## API Reference

### `POST /analyze-document`

Upload a bill image for analysis.

**Request:** `multipart/form-data` with field `file` (JPEG or PNG)

**Response:**
```json
{
  "tamper_probability": 73.4,
  "is_suspicious": true,
  "ocr_text": "Patient: John Doe\nAmount: ₹45,000\n...",
  "heatmap_file": "heatmap_abc12345_bill.jpg"
}
```

| Field | Type | Description |
|---|---|---|
| `tamper_probability` | float (0–100) | How likely the document has been tampered with |
| `is_suspicious` | bool | True when tamper_probability > 50 |
| `ocr_text` | string | Extracted text (name, amount, dates, diagnosis) |
| `heatmap_file` | string \| null | Path to Grad-CAM heatmap (only when suspicious) |

### `GET /heatmap/{filename}`

Download a previously generated heatmap image.

### `GET /health`

Liveness probe — returns `{"status": "ok"}`.

---

## Key Correction (Bug Fix)

> ❌ **WRONG** (silently produces garbage predictions):
> ```python
> img_array = np.array(image) / 255.0
> ```
>
> ✅ **CORRECT** (used everywhere in this codebase):
> ```python
> from tensorflow.keras.applications.efficientnet import preprocess_input
> img_array = preprocess_input(np.array(image))
> ```

EfficientNet uses its own internal normalisation (not 0–1 range). Using `/255.0` produces no error but causes incorrect predictions.

---

## Integration Note for Member C

- Server runs on **port 8000**
- Hit `POST http://<server-ip>:8000/analyze-document` with `multipart/form-data`
- Test with Swagger UI at `http://localhost:8000/docs`
- Health check: `GET http://localhost:8000/health`
