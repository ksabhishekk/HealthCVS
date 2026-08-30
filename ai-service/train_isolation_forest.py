"""
train_isolation_forest.py
--------------------------
Unsupervised anomaly detector, complementary to the supervised XGBoost model
in train_tabular.py/explain_tabular.py.

Why: XGBoost needs labeled fraud examples to learn from, and no real labeled
claims dataset exists yet (train_tabular.py's labels are synthetic — honestly
disclosed in the project's write-up). IsolationForest needs NO labels at all —
it learns what a "normal" claim's feature distribution looks like and flags
statistical outliers. This is standard practice in real fraud systems, where
confirmed fraud labels are always scarce: combine a supervised model (catches
known patterns) with an unsupervised one (catches anything unusual, including
patterns nobody has labeled before). scikit-learn is already a dependency —
no new packages needed for this.

Trained on the same synthetic feature distribution as train_tabular.py for
now, for consistency. Swap in real accumulated claim data (pulled from
MongoDB) once enough real claims exist — the whole point of an unsupervised
model is that it gets more useful as real data accumulates, without ever
needing anyone to go back and label historical claims as fraud/not-fraud.

Usage:
    cd ai-service
    python train_isolation_forest.py
"""
import pickle

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest

MODEL_PATH = "isolation_forest.pkl"


def generate_and_train():
    np.random.seed(7)  # different seed from train_tabular.py — independent synthetic draw
    n_samples = 2000

    claimed_amount = np.random.uniform(5000, 500000, n_samples)
    market_ceiling = np.random.uniform(10000, 200000, n_samples)
    days_since_last_claim = np.random.randint(0, 1000, n_samples)
    hospital_type_private = np.random.randint(0, 2, n_samples)
    num_claims_12months = np.random.randint(0, 10, n_samples)
    hospital_rejection_rate = np.random.uniform(0, 1, n_samples)
    amount_ceiling_ratio = claimed_amount / market_ceiling

    df = pd.DataFrame({
        'claimed_amount': claimed_amount,
        'market_ceiling': market_ceiling,
        'days_since_last_claim': days_since_last_claim,
        'hospital_type_private': hospital_type_private,
        'num_claims_12months': num_claims_12months,
        'hospital_rejection_rate': hospital_rejection_rate,
        'amount_ceiling_ratio': amount_ceiling_ratio,
    })

    # contamination=0.1 assumes ~10% of claims are statistical outliers worth a
    # second look — a tuning knob, not a claim about real fraud prevalence.
    model = IsolationForest(n_estimators=200, contamination=0.1, random_state=7)
    model.fit(df)

    with open(MODEL_PATH, 'wb') as f:
        pickle.dump(model, f)
    print(f"Isolation Forest trained on {n_samples} synthetic samples, saved to {MODEL_PATH}")


if __name__ == "__main__":
    generate_and_train()
