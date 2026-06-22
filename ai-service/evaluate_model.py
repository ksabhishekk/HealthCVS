"""
evaluate_model.py
-----------------
Evaluates the trained forgery-detection model against the validation set.

Prints:
  - Overall accuracy
  - Confusion matrix  (rows = actual, cols = predicted)
  - Precision, Recall, F1 for the TAMPERED class
  - Distribution of tamper probabilities (genuine vs tampered images)

A healthy model should show nonzero True Positives (tampered correctly flagged).
If TP == 0, the model is still predicting majority class — re-check training.

Usage:
    cd ai-service
    python evaluate_model.py
"""

import os
import numpy as np
import tensorflow as tf
from tensorflow.keras.applications.efficientnet import preprocess_input

# ---------------------------------------------------------------------------
# 1. Load best available model
# ---------------------------------------------------------------------------
MODEL_PATH = "forgery_detector_best_phase2.keras"

if not os.path.exists(MODEL_PATH):
    raise FileNotFoundError(
        f"No model file found at {MODEL_PATH}. Run train_model.py first."
    )

print(f"Loading model from: {MODEL_PATH}")
model = tf.keras.models.load_model(MODEL_PATH)

# ---------------------------------------------------------------------------
# 2. Load validation dataset (same settings as training)
# ---------------------------------------------------------------------------
IMAGE_SIZE  = (300, 300)
BATCH_SIZE  = 16
THRESHOLD   = 0.50   # tamper_prob > this → predicted tampered

val_ds = tf.keras.utils.image_dataset_from_directory(
    "dataset/validation",
    image_size=IMAGE_SIZE,
    batch_size=BATCH_SIZE,
    label_mode="int",
    shuffle=False,
)

print(f"Class names (index order): {val_ds.class_names}")
# Expected: ['genuine', 'tampered']  →  genuine=0, tampered=1

# Apply same preprocessing as training (no augmentation)
val_ds_preprocessed = val_ds.map(
    lambda x, y: (preprocess_input(x), y),
    num_parallel_calls=tf.data.AUTOTUNE,
).prefetch(tf.data.AUTOTUNE)

# ---------------------------------------------------------------------------
# 3. Collect predictions
# ---------------------------------------------------------------------------
all_labels = []
all_probs  = []   # tamper probability (preds[:, 1])

for images, labels in val_ds_preprocessed:
    preds = model.predict(images, verbose=0)
    all_probs.extend(preds[:, 1].tolist())   # index 1 = tampered class
    all_labels.extend(labels.numpy().tolist())

all_labels = np.array(all_labels)
all_probs  = np.array(all_probs)
all_preds  = (all_probs > THRESHOLD).astype(int)

# ---------------------------------------------------------------------------
# 4. Confusion matrix
# ---------------------------------------------------------------------------
TP = int(np.sum((all_preds == 1) & (all_labels == 1)))
TN = int(np.sum((all_preds == 0) & (all_labels == 0)))
FP = int(np.sum((all_preds == 1) & (all_labels == 0)))
FN = int(np.sum((all_preds == 0) & (all_labels == 1)))

total    = len(all_labels)
accuracy = (TP + TN) / total

precision = TP / (TP + FP) if (TP + FP) > 0 else 0.0
recall    = TP / (TP + FN) if (TP + FN) > 0 else 0.0
f1        = (2 * precision * recall / (precision + recall)
             if (precision + recall) > 0 else 0.0)

print("\n" + "="*55)
print("  EVALUATION RESULTS")
print("="*55)
print(f"\n  Total images : {total}")
print(f"  Genuine      : {int(np.sum(all_labels == 0))}")
print(f"  Tampered     : {int(np.sum(all_labels == 1))}")

print("\n  Confusion Matrix (rows=actual, cols=predicted)")
print(f"                  Pred:Genuine  Pred:Tampered")
print(f"  Actual:Genuine      {TN:>5}          {FP:>5}")
print(f"  Actual:Tampered     {FN:>5}          {TP:>5}")

print(f"\n  Accuracy  : {accuracy*100:.1f}%")
print(f"  Precision : {precision*100:.1f}%  (of flagged, how many were truly tampered)")
print(f"  Recall    : {recall*100:.1f}%  (of all tampered, how many were caught)")
print(f"  F1 Score  : {f1*100:.1f}%")

# ---------------------------------------------------------------------------
# 5. Tamper probability distribution
# ---------------------------------------------------------------------------
genuine_probs  = all_probs[all_labels == 0]
tampered_probs = all_probs[all_labels == 1]

print("\n  Tamper probability distribution:")
print(f"    Genuine images  — mean: {genuine_probs.mean():.3f}  "
      f"min: {genuine_probs.min():.3f}  max: {genuine_probs.max():.3f}")
if len(tampered_probs) > 0:
    print(f"    Tampered images — mean: {tampered_probs.mean():.3f}  "
          f"min: {tampered_probs.min():.3f}  max: {tampered_probs.max():.3f}")

# ---------------------------------------------------------------------------
# 6. Diagnosis
# ---------------------------------------------------------------------------
print("\n" + "="*55)
if TP == 0:
    print("  ⚠  TP=0: Model is still predicting majority class.")
    print("     The two means above will be very similar (both ~0.2-0.4).")
    print("     Action: Increase UNFREEZE_LAYERS or PHASE2_EPOCHS in train_model.py")
    print("             and retrain.")
else:
    sep = tampered_probs.mean() - genuine_probs.mean()
    print(f"  ✅ Model is learning! TP={TP}, FN={FN}")
    print(f"     Mean probability gap (tampered - genuine): {sep:+.3f}")
    if sep < 0.15:
        print("     Gap is small — consider more fine-tuning epochs.")
    else:
        print("     Good separation. Model is usable.")
print("="*55 + "\n")
