import os
import time
import requests
from dotenv import load_dotenv

load_dotenv()

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

        # NLP Approach: Use TF-IDF and Cosine Similarity
        from sklearn.feature_extraction.text import TfidfVectorizer
        from sklearn.metrics.pairwise import cosine_similarity

        # Split OCR text into lines/chunks to compare against the description
        lines = [line.strip() for line in ocr_text.split('\n') if len(line.strip()) > 3]
        if not lines:
            lines = [ocr_text]

        documents = [description.lower()] + [line.lower() for line in lines]

        vectorizer = TfidfVectorizer(stop_words='english')
        try:
            tfidf_matrix = vectorizer.fit_transform(documents)
            cosine_sims = cosine_similarity(tfidf_matrix[0:1], tfidf_matrix[1:]).flatten()

            max_sim = cosine_sims.max()
            best_match_idx = cosine_sims.argmax()
            best_match_line = lines[best_match_idx]

            if max_sim > 0.15:
                return True, f"Semantic match (similarity: {max_sim:.2f}). Diagnosis '{description}' matches: '{best_match_line}'."
            else:
                return False, f"No semantic match for diagnosis: {description}. Best similarity: {max_sim:.2f}"
        except ValueError:
            return False, "Failed to process text for NLP similarity (empty content)."

    except requests.RequestException as e:
        return False, f"Error fetching ICD data: {str(e)}"

def verify_doctor_credentials(reg_no: str) -> tuple[bool, str]:
    """
    Checks if the doctor's registration number is valid via Apify Actor.
    Uses async run + polling because the scraper takes 1-5 minutes to complete.
    Returns (is_verified, doctor_name).
    """
    if not reg_no:
        return False, "No registration number provided"
    api_token = os.environ.get("APIFY_TOKEN")

    if not api_token:
        return False, "APIFY_TOKEN environment variable is not set."

    try:
        # Step 1: Start the actor run (don't wait for it synchronously)
        start_url = f"https://api.apify.com/v2/acts/hQpzzhlkeQdWfOrby/runs?token={api_token}"
        payload = {"registrationNumber": reg_no}

        start_resp = requests.post(start_url, json=payload, timeout=30)

        if start_resp.status_code == 401:
            return False, "Unauthorized: Invalid Apify API Token."
        if start_resp.status_code not in (200, 201):
            return False, f"Failed to start Apify actor: {start_resp.status_code} - {start_resp.text[:200]}"

        run_data = start_resp.json().get("data", {})
        run_id = run_data.get("id")

        if not run_id:
            return False, "Failed to get run ID from Apify."

        # Step 2: Poll for completion (actor takes 50s-5min typically)
        status_url = f"https://api.apify.com/v2/actor-runs/{run_id}?token={api_token}"
        max_wait = 300  # 5 minutes max
        poll_interval = 10  # check every 10 seconds
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
                return False, f"Apify actor run {run_status.lower()}."

        else:
            return False, "Doctor verification timed out after 5 minutes."

        # Step 3: Fetch the dataset items
        dataset_id = status_resp.json().get("data", {}).get("defaultDatasetId")
        if not dataset_id:
            return False, "No dataset returned from Apify run."

        items_url = f"https://api.apify.com/v2/datasets/{dataset_id}/items?token={api_token}"
        items_resp = requests.get(items_url, timeout=15)

        if items_resp.status_code != 200:
            return False, f"Failed to fetch results: {items_resp.status_code}"

        data = items_resp.json()
        if data and isinstance(data, list) and len(data) > 0:
            result = data[0]
            # Try multiple common field names for doctor name
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
                # Return sample data so we can see the actual field names
                sample_keys = list(result.keys())[:8] if isinstance(result, dict) else []
                sample_data = {k: str(result[k])[:50] for k in sample_keys}
                return False, f"Doctor found but could not extract name. Fields: {sample_data}"

            return True, doctor_name
        else:
            return False, "Doctor registration number not found in registry."

    except requests.RequestException as e:
        return False, f"Error reaching Apify API: {str(e)}"
