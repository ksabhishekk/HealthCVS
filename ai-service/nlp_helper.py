# mock ICD-10 to drug family mappings (invented 18 generic mappings)
ICD_TO_DRUG_FAMILY = {
    "E11": "Antidiabetic",          # Type 2 diabetes mellitus
    "I10": "Antihypertensive",      # Essential hypertension
    "J45": "Bronchodilator",        # Asthma
    "E78": "Statin",                # Hypercholesterolemia
    "F32": "Antidepressant",        # Major depressive disorder
    "M17": "NSAID",                 # Osteoarthritis of knee
    "K21": "Proton Pump Inhibitor", # Gastro-esophageal reflux disease
    "N39": "Antibiotic",            # Urinary tract infection
    "L20": "Corticosteroid",        # Atopic dermatitis
    "G43": "Triptan",               # Migraine
    "C50": "Chemotherapy",          # Malignant neoplasm of breast
    "B20": "Antiretroviral",        # HIV disease
    "M81": "Bisphosphonate",        # Osteoporosis
    "I20": "Nitrate",               # Angina pectoris
    "G40": "Anticonvulsant",        # Epilepsy
    "H40": "Prostaglandin analog",  # Glaucoma
    "N40": "Alpha blocker",         # Benign prostatic hyperplasia
    "D50": "Iron supplement"        # Iron deficiency anemia
}

# mock NMC registry
MOCK_NMC_REGISTRY = {
    "NMC12345": "Dr. Alice Smith",
    "NMC67890": "Dr. Bob Jones",
    "NMC11223": "Dr. Charlie Brown",
    "NMC44556": "Dr. Diana Prince",
    "NMC99999": "Dr. Edward Cullen"
}

def verify_prescription_consistency(icd_code: str, ocr_text: str) -> tuple[bool, str]:
    """
    Checks if the ICD code's corresponding drug family is mentioned in the OCR text.
    Returns (is_consistent, reason_string).
    """
    if not icd_code:
         return False, "No ICD code provided."
         
    # Check if we know this ICD code
    # We do a loose match in case they pass "E11.9" etc.
    matched_family = None
    for key, family in ICD_TO_DRUG_FAMILY.items():
        if icd_code.startswith(key):
            matched_family = family
            break
            
    if not matched_family:
        return False, f"ICD code '{icd_code}' not found in supported mappings."
        
    # Check if the drug family is in the OCR text (case-insensitive)
    if matched_family.lower() in ocr_text.lower():
        return True, f"Found corresponding drug family '{matched_family}' for ICD '{icd_code}' in OCR text."
    else:
        return False, f"Missing corresponding drug family '{matched_family}' for ICD '{icd_code}' in OCR text."

def verify_doctor_credentials(reg_no: str) -> tuple[bool, str]:
    """
    Checks if the doctor's registration number is valid.
    Returns (is_verified, doctor_name).
    """
    if reg_no in MOCK_NMC_REGISTRY:
        return True, MOCK_NMC_REGISTRY[reg_no]
    else:
        return False, "Unknown or invalid registration number"
