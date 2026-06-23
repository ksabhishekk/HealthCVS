import os
import requests

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
    Checks if the doctor's registration number is valid via Surepass API.
    Returns (is_verified, doctor_name).
    """
    if not reg_no:
        return False, "No registration number provided"
        
    api_key = os.environ.get("SUREPASS_API_KEY")
    if not api_key:
        return False, "SUREPASS_API_KEY environment variable is not set."
        
    try:
        url = "https://kyc-api.surepass.io/api/v1/doctor/verification"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
        payload = {"id_number": reg_no}
        
        response = requests.post(url, headers=headers, json=payload, timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            if data.get("success"):
                # Surepass usually returns data under 'data' object
                doctor_name = data.get("data", {}).get("full_name", "Unknown Name")
                return True, doctor_name
            else:
                return False, data.get("message", "Verification failed")
        elif response.status_code == 401:
            return False, "Unauthorized: Invalid Surepass API Key."
        elif response.status_code == 404:
            return False, "Doctor registration number not found in registry."
        else:
            return False, f"API Error: {response.status_code}"
            
    except requests.RequestException as e:
        return False, f"Error reaching Surepass API: {str(e)}"
