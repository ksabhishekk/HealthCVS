"""
train_model.py
--------------
Two-phase fine-tuning of EfficientNetB3 for bill forgery detection.

FIX APPLIED: Previous version froze the entire EfficientNetB3 backbone, leaving
only 3,074 trainable params (the final Dense layer). The model could not learn
forgery-specific features and collapsed to always predicting the majority class.

Phase 1 — warm-up (frozen backbone):
    Train only the new head for a few epochs so random weights stabilise.
Phase 2 — fine-tune (top N layers unfrozen):
    Unfreeze the last UNFREEZE_LAYERS layers of EfficientNetB3 and continue
    at a much lower LR (1e-5) so pretrained weights adapt without catastrophic
    forgetting.

Also fixed:
    - Class weights computed from label counts to handle class imbalance.
    - EarlyStopping monitors val_loss (more stable) and uses patience=5.
    - ModelCheckpoint saves the best epoch, not the last.

Usage:
    cd ai-service
    python train_model.py
"""

import collections

import numpy as np
import tensorflow as tf
from tensorflow.keras import layers, models
from tensorflow.keras.applications.efficientnet import preprocess_input  # CORRECTED

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
IMAGE_SIZE      = (300, 300)
BATCH_SIZE      = 16           # smaller batch → more gradient updates per epoch
PHASE1_EPOCHS   = 5            # warm-up: frozen backbone
PHASE2_EPOCHS   = 20           # fine-tune: top layers unfrozen
UNFREEZE_LAYERS = 30           # how many top layers of EfficientNetB3 to unfreeze
PHASE1_LR       = 1e-4
PHASE2_LR       = 1e-5         # must be much lower to avoid catastrophic forgetting

# ---------------------------------------------------------------------------
# 1. Load datasets
# ---------------------------------------------------------------------------
raw_train_ds = tf.keras.utils.image_dataset_from_directory(
    "dataset/train",
    image_size=IMAGE_SIZE,
    batch_size=BATCH_SIZE,
    label_mode="int",
    shuffle=True,
    seed=42,
)

raw_val_ds = tf.keras.utils.image_dataset_from_directory(
    "dataset/validation",
    image_size=IMAGE_SIZE,
    batch_size=BATCH_SIZE,
    label_mode="int",
    shuffle=False,
)

# Print class index mapping so we can verify genuine=0, tampered=1
print("\nClass indices (should be: genuine=0, tampered=1):")
print(raw_train_ds.class_names)   # alphabetical → ['genuine', 'tampered']

# ---------------------------------------------------------------------------
# 2. Compute class weights from training labels (fixes imbalance)
# ---------------------------------------------------------------------------
label_counts: dict[int, int] = collections.Counter()
for _, labels in raw_train_ds:
    for lbl in labels.numpy():
        label_counts[int(lbl)] += 1

total_samples = sum(label_counts.values())
n_classes     = len(label_counts)

# sklearn-style "balanced" formula: weight_i = total / (n_classes * count_i)
class_weight = {
    cls: total_samples / (n_classes * count)
    for cls, count in label_counts.items()
}
print(f"\nClass counts  : {dict(label_counts)}")
print(f"Class weights : {class_weight}")
# e.g. with 577 genuine / 192 fake → fake gets ~3× higher weight

# ---------------------------------------------------------------------------
# 3. Data augmentation + preprocessing pipeline
# ---------------------------------------------------------------------------
augmentation = tf.keras.Sequential(
    [
        layers.RandomFlip("horizontal"),
        layers.RandomRotation(0.05),
        layers.RandomBrightness(0.1),
        layers.RandomContrast(0.1),       # extra: forgeries often change contrast
        layers.GaussianNoise(0.05),       # extra: helps detect copy-paste artifacts
    ],
    name="augmentation",
)

# CORRECTED: use preprocess_input — NOT /255.0
train_ds = (
    raw_train_ds
    .map(lambda x, y: (preprocess_input(augmentation(x, training=True)), y),
         num_parallel_calls=tf.data.AUTOTUNE)
    .prefetch(tf.data.AUTOTUNE)
)
val_ds = (
    raw_val_ds
    .map(lambda x, y: (preprocess_input(x), y),
         num_parallel_calls=tf.data.AUTOTUNE)
    .prefetch(tf.data.AUTOTUNE)
)

# ---------------------------------------------------------------------------
# 4. Build model
# ---------------------------------------------------------------------------
base_model = tf.keras.applications.EfficientNetB3(
    input_shape=(*IMAGE_SIZE, 3),
    include_top=False,
    weights="imagenet",
)
base_model.trainable = False   # frozen for Phase 1

inputs = tf.keras.Input(shape=(*IMAGE_SIZE, 3))
x      = base_model(inputs, training=False)
x      = layers.GlobalAveragePooling2D()(x)
x      = layers.BatchNormalization()(x)
x      = layers.Dropout(0.4)(x)
x      = layers.Dense(128, activation="relu")(x)   # extra capacity
x      = layers.Dropout(0.3)(x)
outputs = layers.Dense(2, activation="softmax", name="predictions")(x)   # 0=genuine 1=tampered

model = tf.keras.Model(inputs, outputs)

# ---------------------------------------------------------------------------
# 5. Shared callbacks
# ---------------------------------------------------------------------------
def make_callbacks(suffix: str) -> list:
    return [
        tf.keras.callbacks.ModelCheckpoint(
            f"forgery_detector_best_{suffix}.keras",
            save_best_only=True,
            monitor="val_loss",
            verbose=1,
        ),
        tf.keras.callbacks.EarlyStopping(
            patience=5,
            monitor="val_loss",
            restore_best_weights=True,
            verbose=1,
        ),
        tf.keras.callbacks.ReduceLROnPlateau(
            monitor="val_loss",
            factor=0.5,
            patience=3,
            verbose=1,
        ),
    ]

# ---------------------------------------------------------------------------
# 6. PHASE 1 — warm-up (backbone frozen)
# ---------------------------------------------------------------------------
print("\n" + "="*60)
print("PHASE 1: Warming up head (backbone frozen)")
print("="*60)

model.compile(
    optimizer=tf.keras.optimizers.Adam(PHASE1_LR),
    loss="sparse_categorical_crossentropy",
    metrics=["accuracy"],
)
model.summary()

model.fit(
    train_ds,
    validation_data=val_ds,
    epochs=PHASE1_EPOCHS,
    class_weight=class_weight,
    callbacks=make_callbacks("phase1"),
)

# ---------------------------------------------------------------------------
# 7. PHASE 2 — fine-tune top layers of backbone
# ---------------------------------------------------------------------------
print("\n" + "="*60)
print(f"PHASE 2: Fine-tuning top {UNFREEZE_LAYERS} layers of EfficientNetB3")
print("="*60)

# Unfreeze the top N layers of the backbone only
base_model.trainable = True
for layer in base_model.layers[:-UNFREEZE_LAYERS]:
    layer.trainable = False

trainable_count = sum(1 for l in model.layers if l.trainable)
print(f"Trainable layers after unfreezing: {trainable_count}")

# Must re-compile after changing trainability
model.compile(
    optimizer=tf.keras.optimizers.Adam(PHASE2_LR),   # much lower LR
    loss="sparse_categorical_crossentropy",
    metrics=["accuracy"],
)

model.fit(
    train_ds,
    validation_data=val_ds,
    epochs=PHASE2_EPOCHS,
    class_weight=class_weight,
    callbacks=make_callbacks("phase2"),
)

# ---------------------------------------------------------------------------
# 8. Save final model
# ---------------------------------------------------------------------------
model.save("forgery_detector.h5")
print("\n✅ Training complete. Model saved as forgery_detector.h5")
print("   Now run: python evaluate_model.py  — confirm confusion matrix shows nonzero TPs.")
