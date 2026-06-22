import os
import glob
import tensorflow as tf
import numpy as np

# ---- CONFIG ----
REAL_DIR = os.path.join(os.path.expanduser("~"), "Desktop", "real")
FAKE_DIR = os.path.join(os.path.expanduser("~"), "Desktop", "fake")
IMAGE_SIZE = (300, 300)

# Auto-find all model files in current directory
MODEL_PATTERNS = ["*.h5", "*.keras"]


def find_model_files():
    files = []
    for pattern in MODEL_PATTERNS:
        files.extend(glob.glob(pattern))
    return sorted(set(files))


def load_and_preprocess(path):
    img = tf.keras.utils.load_img(path, target_size=IMAGE_SIZE)
    arr = tf.keras.utils.img_to_array(img)
    arr = np.expand_dims(arr, axis=0)
    return arr


def load_test_images():
    """Load all test images once, reused across all models."""
    items = []  # (path, true_label)
    for true_label, folder in [("real", REAL_DIR), ("fake", FAKE_DIR)]:
        if not os.path.isdir(folder):
            print(f"[warning] {folder} not found")
            continue
        for filename in os.listdir(folder):
            if filename.lower().endswith(".png"):
                items.append((os.path.join(folder, filename), true_label))
    return items


def evaluate_model_file(model_path, test_items):
    try:
        model = tf.keras.models.load_model(model_path)
    except Exception as e:
        return {"error": str(e)}

    results = []
    for path, true_label in test_items:
        arr = load_and_preprocess(path)
        preds = model.predict(arr, verbose=0)[0]
        tamper_prob = float(preds[1])
        predicted_label = "fake" if tamper_prob >= 0.5 else "real"
        results.append((true_label, tamper_prob, predicted_label))

    total = len(results)
    if total == 0:
        return {"error": "no test images found"}

    correct = sum(1 for t, p, pred in results if t == pred)
    tp = sum(1 for t, p, pred in results if t == "fake" and pred == "fake")
    fn = sum(1 for t, p, pred in results if t == "fake" and pred == "real")
    tn = sum(1 for t, p, pred in results if t == "real" and pred == "real")
    fp = sum(1 for t, p, pred in results if t == "real" and pred == "fake")

    precision = tp / (tp + fp) * 100 if (tp + fp) > 0 else 0.0
    recall = tp / (tp + fn) * 100 if (tp + fn) > 0 else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) > 0 else 0.0

    real_probs = [p for t, p, pred in results if t == "real"]
    fake_probs = [p for t, p, pred in results if t == "fake"]
    real_mean = sum(real_probs) / len(real_probs) if real_probs else 0.0
    fake_mean = sum(fake_probs) / len(fake_probs) if fake_probs else 0.0
    gap = fake_mean - real_mean

    del model
    tf.keras.backend.clear_session()

    return {
        "total": total, "correct": correct,
        "tp": tp, "fn": fn, "tn": tn, "fp": fp,
        "accuracy": correct / total * 100,
        "precision": precision, "recall": recall, "f1": f1,
        "gap": gap,
    }


def main():
    model_files = find_model_files()
    if not model_files:
        print("No .h5 or .keras files found in current directory.")
        return

    print(f"Found {len(model_files)} model file(s) to test:")
    for f in model_files:
        print(f"  - {f}")

    test_items = load_test_images()
    print(f"\nLoaded {len(test_items)} test images "
          f"({sum(1 for _, l in test_items if l=='real')} real, "
          f"{sum(1 for _, l in test_items if l=='fake')} fake)\n")

    all_results = {}
    for model_path in model_files:
        print(f"Evaluating {model_path} ...")
        res = evaluate_model_file(model_path, test_items)
        all_results[model_path] = res
        if "error" in res:
            print(f"  [error] {res['error']}")
        else:
            print(f"  accuracy={res['accuracy']:.1f}%  gap={res['gap']:+.3f}  "
                  f"TP={res['tp']} FN={res['fn']} precision={res['precision']:.1f}% recall={res['recall']:.1f}%")

    # Rank by gap (most reliable signal of actual learning), descending
    valid_results = {k: v for k, v in all_results.items() if "error" not in v}
    ranked = sorted(valid_results.items(), key=lambda x: x[1]["gap"], reverse=True)

    print("\n" + "=" * 80)
    print("  RANKING (by mean probability gap: fake_mean - real_mean)")
    print("=" * 80)
    print(f"{'Rank':<5}{'Model':<35}{'Gap':<10}{'Accuracy':<10}{'TP':<5}{'FN':<5}{'Precision':<10}{'Recall':<10}")
    print("-" * 80)
    for i, (model_path, res) in enumerate(ranked, 1):
        print(f"{i:<5}{model_path:<35}{res['gap']:+.3f}     {res['accuracy']:<10.1f}{res['tp']:<5}{res['fn']:<5}{res['precision']:<10.1f}{res['recall']:<10.1f}")

    if ranked:
        best_model, best_res = ranked[0]
        print("\n" + "=" * 80)
        print(f"  BEST MODEL: {best_model}")
        print(f"  Gap: {best_res['gap']:+.3f}  |  Accuracy: {best_res['accuracy']:.1f}%  |  "
              f"TP: {best_res['tp']}  |  Precision: {best_res['precision']:.1f}%  |  Recall: {best_res['recall']:.1f}%")
        print("=" * 80)
        print("\nNote: a higher gap means the model separates real vs fake more confidently.")
        print("A model with gap near 0 (or negative) is not learning the task,")
        print("regardless of what its accuracy number says.")


if __name__ == "__main__":
    main()
