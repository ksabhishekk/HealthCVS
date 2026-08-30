import pickle
import shap
import pandas as pd
import os
import xgboost

MODEL_PATH = "xgboost_fraud_model.pkl"
ISOLATION_FOREST_PATH = "isolation_forest.pkl"
_model = None
_explainer = None
_iso_model = None

EXPECTED_COLS = [
    'claimed_amount', 'market_ceiling', 'days_since_last_claim',
    'hospital_type_private', 'num_claims_12months', 'hospital_rejection_rate',
    'amount_ceiling_ratio'
]

def load_model():
    global _model, _explainer
    if _model is None:
        if not os.path.exists(MODEL_PATH):
            raise FileNotFoundError(f"Model file {MODEL_PATH} not found. Run train_tabular.py first.")
        with open(MODEL_PATH, 'rb') as f:
            _model = pickle.load(f)
        _explainer = shap.TreeExplainer(_model)

def load_isolation_forest():
    global _iso_model
    if _iso_model is None:
        if not os.path.exists(ISOLATION_FOREST_PATH):
            raise FileNotFoundError(f"Model file {ISOLATION_FOREST_PATH} not found. Run train_isolation_forest.py first.")
        with open(ISOLATION_FOREST_PATH, 'rb') as f:
            _iso_model = pickle.load(f)

def get_fraud_score(features_dict: dict) -> float:
    load_model()
    df = pd.DataFrame([features_dict])
    df = df[EXPECTED_COLS]

    # Predict probability of the positive class (fraud)
    proba = _model.predict_proba(df)[0][1]
    return float(proba)

# Empirically-calibrated anchors for IsolationForest's score_samples() output on
# this model/synthetic distribution (see ai-service dev notes — measured p1≈-0.45
# for "very normal" synthetic claims down to ≈-0.70 for a deliberately extreme
# outlier case). Not a universal constant — re-measure if the training data changes.
_ANOMALY_LOW_ANCHOR = -0.45   # score_samples() value treated as "not anomalous" (0%)
_ANOMALY_HIGH_ANCHOR = -0.70  # score_samples() value treated as "fully anomalous" (100%)

def get_anomaly_score(features_dict: dict) -> float:
    """
    Unsupervised anomaly score (0-100) from IsolationForest — how statistically
    unusual this claim's features are relative to the training distribution,
    independent of (and blind to) whatever XGBoost's supervised model predicts.
    Higher = more anomalous. This is what lets the system flag claims that don't
    match any pattern XGBoost was ever trained to recognize.
    """
    load_isolation_forest()
    df = pd.DataFrame([features_dict])
    df = df[EXPECTED_COLS]

    raw = _iso_model.score_samples(df)[0]  # more negative = more anomalous
    span = _ANOMALY_LOW_ANCHOR - _ANOMALY_HIGH_ANCHOR
    anomaly_pct = (_ANOMALY_LOW_ANCHOR - raw) / span * 100
    return float(min(max(anomaly_pct, 0.0), 100.0))

def get_hybrid_fraud_score(features_dict: dict) -> dict:
    """
    Blends the supervised XGBoost score with the unsupervised IsolationForest
    anomaly score: 70% XGBoost (a specific fraud-pattern classifier, even if
    trained on synthetic labels — see project write-up) + 30% anomaly score
    (catches statistically unusual claims regardless of whether they match any
    pattern XGBoost was ever shown). This hybrid approach is standard practice
    in real fraud systems, where confirmed fraud labels are always scarce.
    Returns all three components so the XAI layer can show the breakdown.
    """
    xgb_score = get_fraud_score(features_dict) * 100
    anomaly_score = get_anomaly_score(features_dict)
    hybrid_score = (xgb_score * 0.70) + (anomaly_score * 0.30)
    return {
        'hybrid_score': round(hybrid_score, 2),
        'xgboost_score': round(xgb_score, 2),
        'anomaly_score': round(anomaly_score, 2),
    }

def explain_prediction(features_dict: dict) -> list[str]:
    """
    Returns a list of plain English sentences explaining the prediction.
    """
    load_model()
    
    # Create DataFrame from input
    df = pd.DataFrame([features_dict])
    
    # Ensure columns match the training order
    expected_cols = [
        'claimed_amount', 'market_ceiling', 'days_since_last_claim',
        'hospital_type_private', 'num_claims_12months', 'hospital_rejection_rate',
        'amount_ceiling_ratio'
    ]
    df = df[expected_cols]
    
    # Get SHAP values
    shap_values = _explainer.shap_values(df)
    
    if isinstance(shap_values, list):
        vals = shap_values[1][0] 
    else:
        # Sometimes SHAP returns just an array for binary classification in XGBoost
        if len(shap_values.shape) == 3:
             vals = shap_values[0, :, 1]
        else:
             vals = shap_values[0]
        
    explanations = []
    
    feature_names = {
        'claimed_amount': 'Claimed amount',
        'market_ceiling': 'Market ceiling',
        'days_since_last_claim': 'Days since last claim',
        'hospital_type_private': 'Private hospital type',
        'num_claims_12months': 'Number of claims in the last 12 months',
        'hospital_rejection_rate': 'Hospital rejection rate',
        'amount_ceiling_ratio': 'Claim-to-ceiling ratio'
    }
    
    for i, col in enumerate(expected_cols):
        val = vals[i]
        feature_val = df.iloc[0][col]
        # Ignore very small impacts to avoid clutter
        if abs(val) > 0.05:
            direction = "increased" if val > 0 else "decreased"
            # For simplicity in this demo, map SHAP log-odds magnitude to a "percentage"
            # scale. A SHAP value of 1.0 is quite large, let's say it's ~20%
            impact_percent = min(abs(val) * 20, 99.9)
            
            # Format feature value cleanly
            if isinstance(feature_val, float):
                val_str = f"{feature_val:.2f}"
            else:
                val_str = str(feature_val)
                
            sentence = f"{feature_names[col]} (value: {val_str}) {direction} fraud risk by {impact_percent:.1f}%."
            explanations.append(sentence)
            
    # Sort explanations by the biggest impact
    # To do this correctly we could pair them with `abs(val)` and sort
    
    if not explanations:
        explanations.append("No single feature significantly impacted the fraud risk.")
        
    return explanations
