import os
import time
import requests
from dotenv import load_dotenv

from icd_department_map import department_matches
from verification_cache import get_cached, set_cached

load_dotenv()

# ── Semantic similarity model (ICD description vs prescription text) ─────────
# Replaces the earlier TF-IDF approach, which is pure word-overlap and has no
# notion that "hypertension" and "high blood pressure" mean the same thing.
# Biomedical model preferred (trained on medical literature — this is the
# "upgrade to BioBERT/ClinicalBERT" item from the project roadmap); falls back
# to a general-purpose model if the biomedical one can't be downloaded.
_SEMANTIC_MODEL_NAME = "pritamdeka/S-PubMedBert-MS-MARCO"
_SEMANTIC_FALLBACK_MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
_semantic_model = None

# Calibrated in calibrate_semantic_threshold.py against 8 hand-built
# (ICD description, prescription text) pairs — no real labeled claims dataset
# exists yet (same honest limitation as the tabular model's synthetic training
# data). Measured: true matches scored 0.883-0.904, true mismatches scored
# 0.828-0.848 — a narrow ~0.035 margin, because biomedical BERT embeddings
# compress similarity into a tight high range for any in-domain medical text
# (a known property, not a bug). Set slightly toward the mismatch side to
# avoid over-flagging legitimate claims, since this is only a 20%-weight soft
# signal, not an auto-reject. Re-run the calibration script and revisit this
# once real claim text accumulates — this margin is tight enough that it's
# worth validating against real data before leaning on it heavily.
SEMANTIC_MATCH_THRESHOLD = 0.86


def _load_semantic_model():
    global _semantic_model
    if _semantic_model is None:
        from sentence_transformers import SentenceTransformer
        try:
            _semantic_model = SentenceTransformer(_SEMANTIC_MODEL_NAME)
        except Exception as e:
            print(f"[WARN] Could not load {_SEMANTIC_MODEL_NAME} ({e}), falling back to {_SEMANTIC_FALLBACK_MODEL_NAME}")
            _semantic_model = SentenceTransformer(_SEMANTIC_FALLBACK_MODEL_NAME)
    return _semantic_model


def verify_doctor_domain(icd_code: str, doctor_departments: list[str]) -> tuple[bool | None, list[str] | None, str]:
    """
    Cross-checks the treating doctor's department/specialization against the
    expected specialty for the claim's ICD-10 diagnosis. Returns
    (domain_match, expected_departments, reason). domain_match is None when
    the check is inconclusive (missing ICD code, unmapped chapter, or no
    department on record) — callers should treat None as "not applicable",
    not as a fraud signal.
    """
    return department_matches(icd_code, doctor_departments)

def verify_prescription_consistency(icd_code: str, ocr_text: str) -> tuple[bool, str]:
    """
    Fetches the ICD-10 description from the NIH API and uses TF-IDF cosine
    similarity to check whether the OCR text semantically matches the diagnosis.
    Returns (is_consistent, reason_string).
    """
    if not icd_code:
        return False, "No ICD code provided."

    try:
        # Fetch disease description from NIH API (increased timeout + retry)
        url = f"https://clinicaltables.nlm.nih.gov/api/icd10cm/v3/search?terms={icd_code}"

        for attempt in range(3):
            try:
                response = requests.get(url, timeout=15)
                response.raise_for_status()
                break
            except requests.RequestException:
                if attempt == 2:
                    raise
                time.sleep(1)

        data = response.json()

        # Format: [count, [codes], None, [[code, description], ...]]
        if data[0] == 0 or len(data) < 4 or not data[3]:
            return False, f"ICD code '{icd_code}' not found in NIH database."

        description = data[3][0][1]

        # Check for exact ICD code match (accounting for dot variations in OCR text)
        normalized_icd = icd_code.replace('.', '').lower()
        normalized_ocr = ocr_text.replace('.', '').lower()
        if normalized_icd in normalized_ocr:
            return True, f"Found exact ICD code '{icd_code}' in OCR text. Diagnosis: {description}"

        # Semantic approach: biomedical sentence-transformer embeddings + cosine
        # similarity (see calibration notes at the top of this file).
        lines = [line.strip() for line in ocr_text.split('\n') if len(line.strip()) > 3]
        if not lines:
            lines = [ocr_text]

        try:
            from sentence_transformers import util

            model = _load_semantic_model()
            desc_emb = model.encode(description.lower(), convert_to_tensor=True)
            line_embs = model.encode([line.lower() for line in lines], convert_to_tensor=True)
            cosine_sims = util.cos_sim(desc_emb, line_embs)[0].cpu().numpy()

            max_sim = float(cosine_sims.max())
            best_match_idx = int(cosine_sims.argmax())
            best_match_line = lines[best_match_idx]

            if max_sim > SEMANTIC_MATCH_THRESHOLD:
                return True, f"Semantic match (similarity: {max_sim:.2f}). Diagnosis '{description}' matches: '{best_match_line}'."
            else:
                return False, f"No semantic match for diagnosis: {description}. Best similarity: {max_sim:.2f}"
        except Exception as e:
            return False, f"Failed to process text for NLP similarity: {e}"

    except requests.RequestException as e:
        return False, f"Error fetching ICD data: {str(e)}"

def verify_doctor_credentials(reg_no: str) -> tuple[bool, str]:
    """
    Checks if the doctor's registration number is valid via Apify Actor.
    Supports a single registration number or a comma-separated list of numbers.
    Runs the verifications in parallel via ThreadPoolExecutor.
    Returns (is_verified, doctor_name).
    """
    if not reg_no:
        return False, "No registration number provided"

    # Split by comma to handle multiple registration numbers
    regs = [r.strip() for r in reg_no.split(",") if r.strip()]
    if not regs:
        return False, "No registration number provided"

    # Check if mock mode is enabled for development/testing
    if os.environ.get("MOCK_DOCTOR_VERIFY", "").lower() == "true":
        mock_names = {
            "5002": "Bhupendranath Gupta Bhaya",
            "12345": "Dr. Deepak Joshi",
            "15002": "Sibaprasad Sur",
            "5001": "Pasupati Vaidhinathan Thampo"
        }
        verified_names = []
        all_ok = True
        for r in regs:
            if r in mock_names:
                verified_names.append(mock_names[r])
            else:
                if r.isdigit():
                    verified_names.append(f"Mock Doctor (Reg: {r})")
                else:
                    all_ok = False
                    verified_names.append(f"UNVERIFIED ({r})")
        return all_ok, ", ".join(verified_names)

    import concurrent.futures

    def verify_single(r: str) -> tuple[bool, str]:
        # Validate that the registration number contains only digits (Apify actor constraint)
        if not r.isdigit():
            return False, f"Invalid format ({r})"

        api_token = os.environ.get("APIFY_TOKEN")
        if not api_token:
            return False, "APIFY_TOKEN not set"

        try:
            # Step 1: Start the actor run
            start_url = f"https://api.apify.com/v2/acts/hQpzzhlkeQdWfOrby/runs?token={api_token}"
            payload = {"registrationId": r, "maxResults": 1}
            start_resp = requests.post(start_url, json=payload, timeout=30)

            if start_resp.status_code == 401:
                return False, "Unauthorized: Invalid Apify token."
            if start_resp.status_code not in (200, 201):
                return False, f"Failed to start run (status {start_resp.status_code})"

            run_data = start_resp.json().get("data", {})
            run_id = run_data.get("id")
            if not run_id:
                return False, "Failed to get run ID"

            # Step 2: Poll for completion
            status_url = f"https://api.apify.com/v2/actor-runs/{run_id}?token={api_token}"
            max_wait = 300
            poll_interval = 10
            elapsed = 0

            while elapsed < max_wait:
                time.sleep(poll_interval)
                elapsed += poll_interval
                status_resp = requests.get(status_url, timeout=15)
                if status_resp.status_code != 200:
                    continue
                run_status = status_resp.json().get("data", {}).get("status")
                if run_status == "SUCCEEDED":
                    break
                elif run_status in ("FAILED", "ABORTED", "TIMED-OUT"):
                    return False, f"Apify run {run_status.lower()}"
            else:
                return False, "Timeout"

            # Step 3: Fetch the dataset items
            dataset_id = status_resp.json().get("data", {}).get("defaultDatasetId")
            if not dataset_id:
                return False, "No dataset ID"

            items_url = f"https://api.apify.com/v2/datasets/{dataset_id}/items?token={api_token}"
            items_resp = requests.get(items_url, timeout=15)
            if items_resp.status_code != 200:
                return False, "Failed to fetch dataset"

            data = items_resp.json()
            if data and isinstance(data, list) and len(data) > 0:
                result = data[0]
                doctor_name = (
                    result.get("name") or
                    result.get("fullName") or
                    result.get("doctorName") or
                    result.get("registeredName") or
                    result.get("physicianName") or
                    result.get("doctor_name") or
                    None
                )
                if not doctor_name:
                    return False, "Name empty in registry payload"
                return True, doctor_name
            else:
                return False, "Not found"
        except Exception as e:
            return False, str(e)

    # Check the disk cache first — skip the 1-5 min Apify scrape entirely for
    # any reg number verified recently. Only the cache misses go to the executor.
    results_map = {}
    to_verify = []
    for r in regs:
        cached = get_cached(r)
        if cached is not None:
            results_map[r] = cached
        else:
            to_verify.append(r)

    if to_verify:
        with concurrent.futures.ThreadPoolExecutor(max_workers=len(to_verify)) as executor:
            futures = {executor.submit(verify_single, r): r for r in to_verify}
            for future in concurrent.futures.as_completed(futures):
                reg = futures[future]
                try:
                    ok, name = future.result()
                except Exception as e:
                    ok, name = False, str(e)
                results_map[reg] = (ok, name)
                set_cached(reg, ok, name)
    
    verified_names = []
    all_ok = True
    for r in regs:
        ok, name = results_map.get(r, (False, "Unknown error"))
        if ok:
            verified_names.append(name)
        else:
            all_ok = False
            verified_names.append(f"UNVERIFIED ({name})")

    return all_ok, ", ".join(verified_names)
