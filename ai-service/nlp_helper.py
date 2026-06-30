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

            if max_sim > 0.10:   # lowered from 0.15 — NIH descriptions are very short (3-5 words)
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

    # Verify all registration numbers in parallel using threads
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(regs)) as executor:
        futures = {executor.submit(verify_single, r): r for r in regs}
        for future in concurrent.futures.as_completed(futures):
            reg = futures[future]
            try:
                ok, name = future.result()
                results.append((reg, ok, name))
            except Exception as e:
                results.append((reg, False, str(e)))

    # Map back by original order
    results_map = {res[0]: (res[1], res[2]) for res in results}
    
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
