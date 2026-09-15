"""
genai_helper.py
---------------
Sends a document image to a generative AI vision model (Google Gemini Flash)
for an independent tamper-probability estimate.

Returns a dict:
    {
        "available": True,
        "score": 0.0–1.0,
        "reasoning": "short text",
    }

or on any failure:
    {
        "available": False,
        "score": None,
        "reasoning": "why it failed",
    }

This module must NEVER raise — the /analyze-document endpoint falls back
to the trained model score when GenAI is unavailable.

Requires env var GEMINI_API_KEY (free-tier key from Google AI Studio).
"""

import base64
import json
import os
import re
import traceback

import requests

_GEMINI_MODEL = "gemini-3.6-flash"
_GEMINI_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    f"{_GEMINI_MODEL}:generateContent"
)

_PROMPT = (
    "You are a document-forensics expert. Examine this medical bill / "
    "hospital document image and estimate the probability that it has been "
    "digitally tampered with (e.g. amounts edited, text pasted, seals "
    "duplicated, metadata inconsistencies, suspicious compression artifacts).\n\n"
    "Respond ONLY with valid JSON — no markdown fencing, no extra text:\n"
    '{"tamper_probability": <float 0.0 to 1.0>, "reasoning": "<1-2 sentences>"}'
)


def _unavailable(reason: str) -> dict:
    return {"available": False, "score": None, "reasoning": reason}


def analyze_image_with_genai(image_path: str) -> dict:
    """
    Send *image_path* to Gemini Flash for an independent tamper-probability
    estimate. Returns a dict with keys ``available``, ``score``, ``reasoning``.

    This function catches every exception internally and returns an
    "unavailable" result instead of raising, so the caller never needs
    try/except around it.
    """
    try:
        api_key = os.environ.get("GEMINI_API_KEY", "").strip()
        if not api_key:
            return _unavailable("GEMINI_API_KEY environment variable not set")

        # Read and base64-encode the image
        with open(image_path, "rb") as f:
            image_bytes = f.read()
        image_b64 = base64.b64encode(image_bytes).decode("utf-8")

        # Detect MIME type from the first few bytes
        if image_bytes[:4] == b"\x89PNG":
            mime = "image/png"
        elif image_bytes[:2] == b"\xff\xd8":
            mime = "image/jpeg"
        elif image_bytes[:4] in (b"II\x2a\x00", b"MM\x00\x2a"):
            mime = "image/tiff"
        else:
            mime = "image/jpeg"  # safe default

        payload = {
            "contents": [
                {
                    "parts": [
                        {"text": _PROMPT},
                        {
                            "inline_data": {
                                "mime_type": mime,
                                "data": image_b64,
                            }
                        },
                    ]
                }
            ],
            "generationConfig": {
                "temperature": 0.1,   # near-deterministic
                "maxOutputTokens": 1024,
                "thinkingConfig": {
                    "thinkingLevel": "MINIMAL"
                },
                "responseMimeType": "application/json",
                "responseSchema": {
                    "type": "OBJECT",
                    "properties": {
                        "tamper_probability": {"type": "NUMBER"},
                        "reasoning": {"type": "STRING"}
                    },
                    "required": ["tamper_probability", "reasoning"]
                },
            },
        }

        resp = requests.post(
            _GEMINI_URL,
            params={"key": api_key},
            json=payload,
            timeout=30,
        )

        # Handle HTTP-level errors
        if resp.status_code == 429:
            return _unavailable("Gemini API rate limit exceeded")
        if resp.status_code == 403:
            return _unavailable("Gemini API key invalid or quota exhausted")
        if resp.status_code != 200:
            return _unavailable(
                f"Gemini API HTTP {resp.status_code}: {resp.text[:200]}"
            )

        # Parse the response structure
        body = resp.json()

        # Check for API-level error object
        if "error" in body:
            return _unavailable(
                f"Gemini API error: {body['error'].get('message', str(body['error']))}"
            )

        candidates = body.get("candidates", [])
        if not candidates:
            return _unavailable("Gemini returned no candidates")

        text = (
            candidates[0]
            .get("content", {})
            .get("parts", [{}])[0]
            .get("text", "")
        )
        if not text:
            return _unavailable("Gemini returned empty text")

        print(f"[DEBUG] Gemini raw response text: {repr(text)}")

        # Strip markdown code fences if present
        cleaned = re.sub(r"```(?:json)?\s*", "", text).strip().rstrip("`")

        try:
            result = json.loads(cleaned)
        except json.JSONDecodeError:
            # Fallback: extract the first {...} block
            match = re.search(r"\{.*?\}", cleaned, re.DOTALL)
            if not match:
                return _unavailable(f"Could not parse Gemini JSON. Raw text: {repr(cleaned)}")
            try:
                result = json.loads(match.group(0))
            except json.JSONDecodeError:
                return _unavailable(f"Could not parse extracted JSON. Raw text: {repr(cleaned)}")
        score = float(result["tamper_probability"])
        reasoning = str(result.get("reasoning", ""))

        if not (0.0 <= score <= 1.0):
            return _unavailable(
                f"Gemini returned out-of-range score: {score}"
            )

        return {
            "available": True,
            "score": score,
            "reasoning": reasoning,
        }

    except json.JSONDecodeError as e:
        return _unavailable(f"Could not parse Gemini JSON response: {e}")
    except KeyError as e:
        return _unavailable(f"Missing key in Gemini response: {e}")
    except requests.ConnectionError:
        return _unavailable("Network error connecting to Gemini API")
    except requests.Timeout:
        return _unavailable("Gemini API request timed out")
    except Exception:
        return _unavailable(f"Unexpected error: {traceback.format_exc()}")
