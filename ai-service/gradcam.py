import numpy as np
import tensorflow as tf
import cv2


def make_gradcam_heatmap(
    img_array: np.ndarray,
    model: tf.keras.Model,
    last_conv_layer_name: str = "top_activation",
) -> np.ndarray:
    """
    Computes a Grad-CAM heatmap for the predicted class.

    Parameters
    ----------
    img_array : np.ndarray
        Pre-processed image array with shape (1, H, W, 3).
    model : tf.keras.Model
        Loaded Keras model.
    last_conv_layer_name : str
        Name of the last convolutional layer in EfficientNetB3
        (default: "top_activation").

    Returns
    -------
    np.ndarray
        2-D heatmap normalised to [0, 1].
    """
    grad_model = tf.keras.models.Model(
        inputs=[model.inputs],
        outputs=[model.get_layer(last_conv_layer_name).output, model.output],
    )

    with tf.GradientTape() as tape:
        conv_outputs, preds = grad_model(img_array)
        pred_index = tf.argmax(preds[0])
        class_channel = preds[:, pred_index]

    grads = tape.gradient(class_channel, conv_outputs)
    pooled_grads = tf.reduce_mean(grads, axis=(0, 1, 2))

    heatmap = conv_outputs[0] @ pooled_grads[..., tf.newaxis]
    heatmap = tf.squeeze(heatmap)
    heatmap = tf.maximum(heatmap, 0) / tf.reduce_max(heatmap)
    return heatmap.numpy()


def overlay_heatmap(
    img_path: str,
    heatmap: np.ndarray,
    save_path: str = "heatmap.jpg",
    alpha: float = 0.4,
) -> str:
    """
    Overlays the Grad-CAM heatmap on the original image and saves it.

    Parameters
    ----------
    img_path : str
        Path to the original image file.
    heatmap : np.ndarray
        2-D heatmap array from make_gradcam_heatmap().
    save_path : str
        Destination path for the output JPEG.
    alpha : float
        Blending factor for the heatmap overlay (0 = no overlay, 1 = full).

    Returns
    -------
    str
        The save_path of the written file.
    """
    img = cv2.imread(img_path)
    heatmap_resized = cv2.resize(heatmap, (img.shape[1], img.shape[0]))
    heatmap_colored = cv2.applyColorMap(
        np.uint8(255 * heatmap_resized), cv2.COLORMAP_JET
    )
    superimposed = np.clip(heatmap_colored * alpha + img, 0, 255).astype(np.uint8)
    cv2.imwrite(save_path, superimposed)
    return save_path
