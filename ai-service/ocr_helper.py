import cv2
import pytesseract

# Paste your actual Tesseract install path here
pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'


def extract_text_from_image(image_path: str) -> str:
    """
    Reads an image file, converts to grayscale, applies Otsu thresholding
    for better OCR accuracy, and returns the extracted text string.
    """
    image = cv2.imread(image_path)
    if image is None:
        raise ValueError(f"Could not read image at path: {image_path}")

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    _, processed = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
    text = pytesseract.image_to_string(processed)
    return text
