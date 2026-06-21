"""
train_model.py
--------------
Run this ONCE to train the forgery-detection model.
Training typically takes 1-2 hours; run it overnight.

After completion, `forgery_detector.h5` will be created in this directory.

Usage:
    cd ai-service
    python train_model.py
"""

import tensorflow as tf
from tensorflow.keras import layers, models
from tensorflow.keras.applications.efficientnet import preprocess_input  # CORRECTED

# ---------------------------------------------------------------------------
# 1. Load datasets
# ---------------------------------------------------------------------------
train_ds = tf.keras.utils.image_dataset_from_directory(
    "dataset/train",
    image_size=(300, 300),
    batch_size=32,
    label_mode="int",
    shuffle=True,
    seed=42,
)

val_ds = tf.keras.utils.image_dataset_from_directory(
    "dataset/validation",
    image_size=(300, 300),
    batch_size=32,
    label_mode="int",
    shuffle=False,
)

# ---------------------------------------------------------------------------
# 2. Data augmentation pipeline (applied only on training set)
# ---------------------------------------------------------------------------
augmentation = tf.keras.Sequential(
    [
        layers.RandomFlip("horizontal"),
        layers.RandomRotation(0.05),
        layers.RandomBrightness(0.1),
    ]
)

# CORRECTED: use preprocess_input — NOT /255.0
# EfficientNet expects inputs scaled with its own normalization, not 0-1 range.
train_ds = train_ds.map(
    lambda x, y: (preprocess_input(augmentation(x, training=True)), y),
    num_parallel_calls=tf.data.AUTOTUNE,
)
val_ds = val_ds.map(
    lambda x, y: (preprocess_input(x), y),
    num_parallel_calls=tf.data.AUTOTUNE,
)

# Prefetch for performance
train_ds = train_ds.prefetch(tf.data.AUTOTUNE)
val_ds   = val_ds.prefetch(tf.data.AUTOTUNE)

# ---------------------------------------------------------------------------
# 3. Build model: frozen EfficientNetB3 backbone + custom head
# ---------------------------------------------------------------------------
base_model = tf.keras.applications.EfficientNetB3(
    input_shape=(300, 300, 3),
    include_top=False,
    weights="imagenet",
)
base_model.trainable = False  # freeze pretrained weights

model = models.Sequential(
    [
        base_model,
        layers.GlobalAveragePooling2D(),
        layers.Dropout(0.3),
        layers.Dense(2, activation="softmax"),  # 0=genuine, 1=tampered
    ]
)

model.compile(
    optimizer=tf.keras.optimizers.Adam(learning_rate=1e-4),
    loss="sparse_categorical_crossentropy",
    metrics=["accuracy"],
)

model.summary()

# ---------------------------------------------------------------------------
# 4. Train
# ---------------------------------------------------------------------------
callbacks = [
    tf.keras.callbacks.ModelCheckpoint(
        "forgery_detector_best.h5",
        save_best_only=True,
        monitor="val_accuracy",
        verbose=1,
    ),
    tf.keras.callbacks.EarlyStopping(
        patience=3,
        monitor="val_accuracy",
        restore_best_weights=True,
        verbose=1,
    ),
]

history = model.fit(
    train_ds,
    validation_data=val_ds,
    epochs=10,
    callbacks=callbacks,
)

# ---------------------------------------------------------------------------
# 5. Save final model
# ---------------------------------------------------------------------------
model.save("forgery_detector.h5")
print("\n✅ Training complete. Model saved as forgery_detector.h5")
