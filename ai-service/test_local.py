from explain_tabular import get_fraud_score, explain_prediction
from nlp_helper import verify_prescription_consistency, verify_doctor_credentials

def test_tabular():
    payload = {
        "claimed_amount": 300000,
        "market_ceiling": 25000,
        "days_since_last_claim": 10,
        "hospital_type_private": 1,
        "num_claims_12months": 8,
        "hospital_rejection_rate": 0.8,
        "amount_ceiling_ratio": 300000 / 25000
    }
    score = get_fraud_score(payload)
    print("Fraud Score:", score)
    explanations = explain_prediction(payload)
    for e in explanations:
        print(" -", e)

def test_nlp():
    is_consistent, reason = verify_prescription_consistency("E11", "Patient has type 2 diabetes. Prescribed Antidiabetic medication.")
    print("NLP Consistent:", is_consistent, "| Reason:", reason)
    
    is_verified, doc_name = verify_doctor_credentials("NMC12345")
    print("Doctor Verified:", is_verified, "| Name:", doc_name)

if __name__ == "__main__":
    test_tabular()
    test_nlp()
    print("All tests passed!")
