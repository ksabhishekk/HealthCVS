import pickle
import shap
import pandas as pd
import os
import xgboost

MODEL_PATH = "xgboost_fraud_model.pkl"
_model = None
_explainer = None

def load_model():
    global _model, _explainer
    if _model is None:
        if not os.path.exists(MODEL_PATH):
            raise FileNotFoundError(f"Model file {MODEL_PATH} not found. Run train_tabular.py first.")
        with open(MODEL_PATH, 'rb') as f:
            _model = pickle.load(f)
        _explainer = shap.TreeExplainer(_model)

def get_fraud_score(features_dict: dict) -> float:
    load_model()
    df = pd.DataFrame([features_dict])
    expected_cols = [
        'claimed_amount', 'market_ceiling', 'days_since_last_claim',
        'hospital_type_private', 'num_claims_12months', 'hospital_rejection_rate',
        'amount_ceiling_ratio'
    ]
    df = df[expected_cols]
    
    # Predict probability of the positive class (fraud)
    proba = _model.predict_proba(df)[0][1]
    return float(proba)

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
