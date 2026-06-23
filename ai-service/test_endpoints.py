import pytest
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_tabular_fraud():
    payload = {
        "claimed_amount": 300000,
        "market_ceiling": 25000,
        "days_since_last_claim": 10,
        "hospital_type_private": 1,
        "num_claims_12months": 8,
        "hospital_rejection_rate": 0.8
    }
    response = client.post("/predict/tabular-fraud", json=payload)
    print("Tabular Response:", response.json())
    assert response.status_code == 200
    assert "tabular_fraud_score" in response.json()
    assert "shap_explanations" in response.json()

def test_nlp_validate():
    payload = {
        "icd_code": "E11",
        "ocr_text": "Patient has type 2 diabetes. Prescribed Antidiabetic medication.",
        "doctor_reg_no": "NMC12345"
    }
    response = client.post("/predict/nlp-validate", json=payload)
    print("NLP Response:", response.json())
    assert response.status_code == 200
    assert response.json()["prescription_consistent"] is True
    assert response.json()["doctor_verified"] is True
    assert response.json()["doctor_name"] == "Dr. Alice Smith"

if __name__ == "__main__":
    test_tabular_fraud()
    test_nlp_validate()
    print("All tests passed!")
