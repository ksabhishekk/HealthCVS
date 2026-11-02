"""
test_genai_live.py
------------------
Live check of the GenAI (Gemini) tamper estimate through the real
/analyze-document endpoint, on a genuine demo bill and a tampered copy of it.

    1. Start the AI service:  .\\venv\\Scripts\\python -m uvicorn main:app --port 8000
    2. python test_genai_live.py [path-to-genuine-bill.png] [--url http://localhost:8000]

Without GEMINI_API_KEY in ai-service/.env the endpoint falls back to the
EfficientNet model and this script says so. With a key it shows both scores,
Gemini's reasoning and which one decided the final tamper score.
"""
import argparse
import json
import os
import tempfile

import requests
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_BILL = os.path.join(HERE, "..", "notes", "demo_documents", "A1", "1_hospital_bill.png")


def tampered_copy(src):
    """Paste a crudely edited amount onto the bill: a white box with new digits."""
    img = Image.open(src).convert("RGB")
    w, h = img.size
    draw = ImageDraw.Draw(img)
    box = (int(w * 0.62), int(h * 0.70), int(w * 0.92), int(h * 0.76))
    draw.rectangle(box, fill=(255, 255, 255))
    try:
        font = ImageFont.truetype("arialbd.ttf", max(14, int(h * 0.035)))
    except OSError:
        font = ImageFont.load_default()
    draw.text((box[0] + 6, box[1] + 2), "Rs. 2,85,000", fill=(20, 20, 20), font=font)
    out = os.path.join(tempfile.gettempdir(), "hcvs_tampered_bill.png")
    img.save(out)
    return out


def analyse(url, path):
    with open(path, "rb") as f:
        r = requests.post(f"{url}/analyze-document", files={"file": (os.path.basename(path), f, "image/png")}, timeout=180)
    r.raise_for_status()
    return r.json()


def show(label, d):
    dbg = d.get("_debug", {})
    print(f"\n== {label}")
    print(f"   final tamper score : {d.get('tamper_probability')}  (suspicious: {d.get('is_suspicious')})")
    print(f"   EfficientNet model : {dbg.get('trained_model_score')}")
    print(f"   Gemini             : {dbg.get('genai_score')}")
    print(f"   decided by         : {d.get('decision_source')} / {dbg.get('score_source')}")
    print(f"   Gemini reasoning   : {dbg.get('genai_reasoning')}")
    print(f"   heatmap            : {d.get('heatmap_file') or 'none'}")
    for c in d.get("model_comparisons", []):
        print(f"   comparison         : {json.dumps(c)}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("bill", nargs="?", default=DEFAULT_BILL)
    ap.add_argument("--url", default="http://localhost:8000")
    a = ap.parse_args()
    genuine = analyse(a.url, a.bill)
    show("Genuine bill", genuine)
    show("Tampered copy (amount pasted over)", analyse(a.url, tampered_copy(a.bill)))
    if genuine.get("_debug", {}).get("genai_score") is None:
        print("\nGemini did not answer — see 'Gemini reasoning' above (e.g. GEMINI_API_KEY not set).")
