import os
import requests
from dotenv import load_dotenv

load_dotenv()

def verify_prescription_consistency(icd_code: str, ocr_text: str) -> tuple[bool, str]:
    """
    Fetches the ICD-10 description from the NIH API and checks if key terms 
    from the description exist in the OCR text.
    Returns (is_consistent, reason_string).
    """
    if not icd_code:
         return False, "No ICD code provided."
         
    try:
        # Fetch disease description from NIH API
        url = f"https://clinicaltables.nlm.nih.gov/api/icd10cm/v3/search?terms={icd_code}"
        response = requests.get(url, timeout=5)
        response.raise_for_status()
        data = response.json()
        
        # Format: [count, [codes], None, [[code, description], ...]]
        if data[0] == 0 or len(data) < 4 or not data[3]:
            return False, f"ICD code '{icd_code}' not found in NIH database."
            
        # Get the first matching description (e.g., "Type 2 diabetes mellitus...")
        description = data[3][0][1]
        
        # Simple keyword overlap check: 
        # Check if any significant word (>4 chars) from the description is in the OCR text
        words = [w.lower() for w in description.split() if len(w) > 4]
        if not words:
            # Fallback if description has no long words
            words = [description.lower()]
            
        ocr_lower = ocr_text.lower()
        matched_words = [w for w in words if w in ocr_lower]
        
        # Also do a quick check against the exact ICD code being in the OCR text
        if icd_code.lower() in ocr_lower:
            return True, f"Found exact ICD code '{icd_code}' in OCR text."
            
        if matched_words:
            return True, f"Found matching medical terms ({', '.join(matched_words)}) for ICD '{icd_code}' ({description})."
        else:
            return False, f"No overlapping terms found for diagnosis: {description}."
            
    except requests.RequestException as e:
        return False, f"Error fetching ICD data: {str(e)}"

def verify_doctor_credentials(reg_no: str) -> tuple[bool, str]:
    """
    Checks if the doctor's registration number is valid via Apify Actor.
    Returns (is_verified, doctor_name).
    """
    if not reg_no:
        return False, "No registration number provided"
    api_token = os.environ.get("APIFY_TOKEN")

    if not api_token:
        return False, "APIFY_TOKEN environment variable is not set."
        
    try:
        # Run the Apify actor synchronously and get the dataset items
        url = f"https://api.apify.com/v2/acts/hQpzzhlkeQdWfOrby/run-sync-get-dataset-items?token={api_token}"
        
        # Common inputs for such an actor: registrationNumber, regNo, query.
        payload = {"registrationNumber": reg_no}
        
        # Extended timeout as scraping actors might take longer to complete
        response = requests.post(url, json=payload, timeout=60)
        
        if response.status_code == 200 or response.status_code == 201:
            data = response.json()
            if data and isinstance(data, list) and len(data) > 0:
                result = data[0]
                # Common output fields for Doctor scraping
                doctor_name = result.get("name") or result.get("fullName") or result.get("doctorName") or "Unknown Name"
                return True, doctor_name
            else:
                return False, "Doctor registration number not found in registry or scraper returned empty."
        elif response.status_code == 401:
            return False, "Unauthorized: Invalid Apify API Token."
        else:
            return False, f"API Error: {response.status_code} - {response.text}"
            
    except requests.RequestException as e:
        return False, f"Error reaching Apify API: {str(e)}"
