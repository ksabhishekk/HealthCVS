import pandas as pd
import numpy as np
import xgboost as xgb
import pickle

def generate_and_train():
    # Set random seed for reproducibility
    np.random.seed(42)

    # Generate 2000 synthetic samples
    n_samples = 2000

    # Features
    claimed_amount = np.random.uniform(5000, 500000, n_samples)
    market_ceiling = np.random.uniform(10000, 200000, n_samples)
    days_since_last_claim = np.random.randint(0, 1000, n_samples)
    hospital_type_private = np.random.randint(0, 2, n_samples)
    num_claims_12months = np.random.randint(0, 10, n_samples)
    hospital_rejection_rate = np.random.uniform(0, 1, n_samples)
    amount_ceiling_ratio = claimed_amount / market_ceiling

    # Combine into a DataFrame
    df = pd.DataFrame({
        'claimed_amount': claimed_amount,
        'market_ceiling': market_ceiling,
        'days_since_last_claim': days_since_last_claim,
        'hospital_type_private': hospital_type_private,
        'num_claims_12months': num_claims_12months,
        'hospital_rejection_rate': hospital_rejection_rate,
        'amount_ceiling_ratio': amount_ceiling_ratio
    })

    # Create a target variable (fraud or not fraud)
    # Higher ratio, more claims, higher rejection rate -> higher chance of fraud
    fraud_prob = 1 / (1 + np.exp(-(
        0.5 * df['amount_ceiling_ratio'] +
        0.3 * df['num_claims_12months'] +
        2.0 * df['hospital_rejection_rate'] -
        4.0
    )))

    # Convert probabilities to binary target
    target = np.random.binomial(1, fraud_prob)

    print(f"Generated {n_samples} samples. Fraud cases: {np.sum(target)} ({np.sum(target)/n_samples*100:.1f}%)")

    # Train XGBoost model
    model = xgb.XGBClassifier(use_label_encoder=False, eval_metric='logloss')
    model.fit(df, target)

    # Save the model
    model_path = 'xgboost_fraud_model.pkl'
    with open(model_path, 'wb') as f:
        pickle.dump(model, f)

    print(f"Model saved to {model_path}")

if __name__ == "__main__":
    generate_and_train()
