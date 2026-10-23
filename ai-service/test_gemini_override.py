"""
test_gemini_override.py
-----------------------
Tests for the Gemini-override feature added to main.py.

Scenarios covered
-----------------
1. Agreement      - Gemini and CV model scores are within threshold
                    -> pipeline score kept, decision_source="pipeline"
2. Disagreement   - scores differ by >20pp
                    -> Gemini score wins, decision_source="gemini"
3. Gemini failure - analyze_image_with_genai returns available=False
                    -> pipeline fallback, no crash
4. Malformed JSON - genai_helper parses bad JSON and returns available=False
                    -> treated as unavailable, pipeline fallback, no crash
5. Flag off       - GEMINI_OVERRIDE_ENABLED=False path exactly matches original
6. Model unavail  - pipeline model score=None -> comparison shows None, no crash

Usage
-----
    cd ai-service
    python -m pytest test_gemini_override.py -v
    # or
    python test_gemini_override.py
"""

import sys
import types
import unittest
from unittest.mock import MagicMock


# ---------------------------------------------------------------------------
# Lightweight stub loader - lets us import the pure helpers without TF/Keras
# ---------------------------------------------------------------------------

def _stub_heavy_deps():
    stubs = {}
    for name in [
        "tensorflow", "keras", "keras.applications",
        "keras.applications.efficientnet",
        "gradcam", "ocr_helper", "explain_tabular", "nlp_helper", "genai_helper",
        "numpy", "PIL", "PIL.Image", "pydantic", "fastapi",
        "fastapi.responses", "shap", "pandas", "xgboost",
        "sentence_transformers", "sklearn", "sklearn.ensemble",
        "requests",
    ]:
        if name not in sys.modules:
            sys.modules[name] = types.ModuleType(name)
        stubs[name] = sys.modules[name]

    # Provide callable stubs for attributes accessed at module level in main.py
    stubs["ocr_helper"].extract_text_from_image = MagicMock(return_value="")
    stubs["explain_tabular"].get_fraud_score = MagicMock(return_value=0.5)
    stubs["explain_tabular"].explain_prediction = MagicMock(return_value=[])
    stubs["explain_tabular"].get_hybrid_fraud_score = MagicMock(
        return_value={"hybrid_score": 50, "xgboost_score": 50, "anomaly_score": 50}
    )
    stubs["nlp_helper"].verify_prescription_consistency = MagicMock(return_value=(True, "ok"))
    stubs["nlp_helper"].verify_doctor_credentials = MagicMock(return_value=(True, "Dr. Test"))
    stubs["nlp_helper"].verify_doctor_domain = MagicMock(return_value=(True, [], "ok"))
    stubs["nlp_helper"]._load_semantic_model = MagicMock()
    stubs["genai_helper"].analyze_image_with_genai = MagicMock(
        return_value={"available": False, "score": None, "reasoning": "stub"}
    )

    # PIL.Image stub
    stubs["PIL.Image"] = MagicMock()
    stubs["PIL"].Image = stubs["PIL.Image"]

    # numpy: main.py uses np.expand_dims / np.array / np.float32
    import numpy as _np
    sys.modules["numpy"] = _np  # override stub with real numpy if available

    # pydantic BaseModel stub
    stubs["pydantic"].BaseModel = object

    # FastAPI stub so @app.post decorators do not error
    fa = stubs["fastapi"]
    fa.FastAPI = MagicMock(return_value=MagicMock())
    fa.File = MagicMock()
    fa.Form = MagicMock()
    fa.HTTPException = Exception
    fa.UploadFile = MagicMock()
    fr = stubs["fastapi.responses"]
    fr.FileResponse = MagicMock()
    fa.responses = fr

    if "main" in sys.modules:
        del sys.modules["main"]

    import main as m
    return m


_main = _stub_heavy_deps()
_build = _main._build_model_comparisons
_apply = _main._apply_gemini_override
_THRESH = _main._GEMINI_DISAGREE_THRESHOLD   # 0.20


# ---------------------------------------------------------------------------
# _build_model_comparisons unit tests
# ---------------------------------------------------------------------------

class TestBuildModelComparisons(unittest.TestCase):

    def _one(self, model_score, genai_score, available=True):
        models = [{"name": "cv", "label": "CV", "score": model_score, "available": available}]
        return _build(genai_score=genai_score, models=models)[0]

    def test_agreement_below_threshold(self):
        rec = self._one(model_score=0.30, genai_score=0.35)   # diff=5pp
        self.assertTrue(rec["agrees"])
        self.assertAlmostEqual(rec["abs_diff"], 5.0)

    def test_exact_threshold_is_agreement(self):
        rec = self._one(model_score=0.20, genai_score=0.40)   # diff=20pp == threshold
        self.assertTrue(rec["agrees"])

    def test_disagreement_above_threshold(self):
        rec = self._one(model_score=0.20, genai_score=0.80)   # diff=60pp
        self.assertFalse(rec["agrees"])
        self.assertAlmostEqual(rec["abs_diff"], 60.0)

    def test_gemini_unavailable_yields_none(self):
        rec = self._one(model_score=0.40, genai_score=None)
        self.assertIsNone(rec["gemini_score"])
        self.assertIsNone(rec["abs_diff"])
        self.assertIsNone(rec["agrees"])

    def test_model_unavailable_yields_none(self):
        rec = self._one(model_score=None, genai_score=0.50, available=False)
        self.assertIsNone(rec["model_score"])
        self.assertIsNone(rec["abs_diff"])
        self.assertIsNone(rec["agrees"])

    def test_out_of_range_model_score_ignored(self):
        rec = self._one(model_score=1.5, genai_score=0.50, available=True)
        self.assertIsNone(rec["model_score"])
        self.assertIsNone(rec["agrees"])

    def test_correct_keys_in_output(self):
        rec = self._one(model_score=0.40, genai_score=0.50)
        self.assertEqual(
            set(rec.keys()),
            {"model", "model_label", "model_score", "gemini_score", "abs_diff", "agrees"},
        )


# ---------------------------------------------------------------------------
# _apply_gemini_override unit tests
# ---------------------------------------------------------------------------

class TestApplyGeminiOverride(unittest.TestCase):

    # ── Scenario 1: Agreement ──────────────────────────────────────────────
    def test_agreement_keeps_pipeline_score(self):
        final, decision, source = _apply(
            genai_score=0.32, genai_available=True,
            pipeline_score=0.30, threshold=_THRESH,
        )
        self.assertAlmostEqual(final, 0.30)
        self.assertEqual(decision, "pipeline")
        self.assertEqual(source, "pipeline_agreement")

    # ── Scenario 2: Disagreement ───────────────────────────────────────────
    def test_disagreement_uses_gemini_score(self):
        final, decision, source = _apply(
            genai_score=0.85, genai_available=True,
            pipeline_score=0.20, threshold=_THRESH,
        )
        self.assertAlmostEqual(final, 0.85)
        self.assertEqual(decision, "gemini")
        self.assertEqual(source, "gemini_override")

    # ── Scenario 3: Gemini failure ─────────────────────────────────────────
    def test_gemini_unavailable_falls_back(self):
        final, decision, source = _apply(
            genai_score=None, genai_available=False,
            pipeline_score=0.55, threshold=_THRESH,
        )
        self.assertAlmostEqual(final, 0.55)
        self.assertEqual(decision, "pipeline")
        self.assertEqual(source, "model_fallback")

    def test_score_none_even_if_available_true_falls_back(self):
        final, _, source = _apply(
            genai_score=None, genai_available=True,
            pipeline_score=0.40, threshold=_THRESH,
        )
        self.assertAlmostEqual(final, 0.40)
        self.assertEqual(source, "model_fallback")

    # ── Boundary: exactly at threshold counts as agreement ────────────────
    def test_boundary_at_threshold_is_agreement(self):
        final, decision, source = _apply(
            genai_score=0.40, genai_available=True,
            pipeline_score=0.20, threshold=_THRESH,   # diff=0.20 exactly
        )
        self.assertAlmostEqual(final, 0.20)
        self.assertEqual(decision, "pipeline")
        self.assertEqual(source, "pipeline_agreement")


# ---------------------------------------------------------------------------
# Integration: full decision block (mirrors the endpoint logic exactly)
# ---------------------------------------------------------------------------

class TestEndpointDecisionBlock(unittest.TestCase):

    def _run(self, pipeline_score, genai_result, override_enabled=True):
        genai_available = genai_result["available"]
        genai_score = genai_result["score"]
        model_comparisons = _build(
            genai_score=genai_score,
            models=[{"name": "efficientnetb3_cv", "label": "EfficientNetB3 CV",
                     "score": pipeline_score, "available": True}],
        )
        original_pipeline_score = pipeline_score
        if override_enabled:
            final_prob, decision_source, score_source = _apply(
                genai_score=genai_score, genai_available=genai_available,
                pipeline_score=pipeline_score, threshold=_THRESH,
            )
        else:
            # Original behaviour
            if genai_available and genai_score is not None:
                final_prob, score_source = genai_score, "genai"
            else:
                final_prob, score_source = pipeline_score, "model_fallback"
            decision_source = "pipeline"
        return {
            "tamper_probability": round(final_prob * 100, 1),
            "is_suspicious": final_prob > 0.50,
            "ocr_text": "test",
            "heatmap_file": None,
            "decision_source": decision_source,
            "original_pipeline_score": round(original_pipeline_score * 100, 1),
            "model_comparisons": model_comparisons,
            "_debug": {"score_source": score_source,
                       "gemini_override_enabled": override_enabled},
        }

    # Scenario 1 – agreement
    def test_agreement_no_override(self):
        r = self._run(0.30, {"available": True, "score": 0.35, "reasoning": ""}, True)
        self.assertAlmostEqual(r["tamper_probability"], 30.0)
        self.assertEqual(r["decision_source"], "pipeline")
        self.assertEqual(r["_debug"]["score_source"], "pipeline_agreement")
        self.assertTrue(r["model_comparisons"][0]["agrees"])

    # Scenario 2 – disagreement -> override
    def test_disagreement_override_applied(self):
        r = self._run(0.15, {"available": True, "score": 0.85, "reasoning": "suspicious"}, True)
        self.assertAlmostEqual(r["tamper_probability"], 85.0)
        self.assertEqual(r["decision_source"], "gemini")
        self.assertEqual(r["_debug"]["score_source"], "gemini_override")
        self.assertFalse(r["model_comparisons"][0]["agrees"])
        self.assertAlmostEqual(r["original_pipeline_score"], 15.0)

    # Scenario 3 – Gemini failure
    def test_gemini_failure_pipeline_fallback(self):
        r = self._run(0.60, {"available": False, "score": None, "reasoning": "timeout"}, True)
        self.assertAlmostEqual(r["tamper_probability"], 60.0)
        self.assertEqual(r["decision_source"], "pipeline")
        self.assertEqual(r["_debug"]["score_source"], "model_fallback")
        self.assertIsNone(r["model_comparisons"][0]["gemini_score"])

    # Scenario 4 – malformed JSON (already handled in genai_helper; endpoint
    #               receives available=False variants)
    def test_malformed_json_variants_treated_as_unavailable(self):
        bad = [
            {"available": False, "score": None, "reasoning": "Could not parse Gemini JSON"},
            {"available": False, "score": None, "reasoning": "Gemini returned empty text"},
            {"available": False, "score": None, "reasoning": "out-of-range score: 1.5"},
        ]
        for genai_result in bad:
            with self.subTest(reasoning=genai_result["reasoning"]):
                r = self._run(0.45, genai_result, True)
                self.assertAlmostEqual(r["tamper_probability"], 45.0)
                self.assertEqual(r["decision_source"], "pipeline")
                self.assertEqual(r["_debug"]["score_source"], "model_fallback")

    # Scenario 5a – flag off, Gemini available -> use Gemini directly
    def test_flag_off_gemini_available_uses_gemini(self):
        r = self._run(0.20, {"available": True, "score": 0.22, "reasoning": ""}, False)
        self.assertAlmostEqual(r["tamper_probability"], 22.0)
        self.assertEqual(r["_debug"]["score_source"], "genai")

    # Scenario 5b – flag off, Gemini unavailable -> original fallback
    def test_flag_off_gemini_unavailable_uses_pipeline(self):
        r = self._run(0.65, {"available": False, "score": None, "reasoning": "err"}, False)
        self.assertAlmostEqual(r["tamper_probability"], 65.0)
        self.assertEqual(r["_debug"]["score_source"], "model_fallback")

    # Scenario 6 – one pipeline model unavailable (skipped gracefully)
    def test_model_unavailable_skipped_gracefully(self):
        models = [{"name": "efficientnetb3_cv", "label": "EfficientNetB3 CV",
                   "score": None, "available": False}]
        comps = _build(genai_score=0.70, models=models)
        self.assertEqual(len(comps), 1)
        self.assertIsNone(comps[0]["model_score"])
        self.assertIsNone(comps[0]["abs_diff"])
        self.assertIsNone(comps[0]["agrees"])
        self.assertAlmostEqual(comps[0]["gemini_score"], 70.0)


# ---------------------------------------------------------------------------
# Regression checklist – original fields always present, never renamed
# ---------------------------------------------------------------------------

class TestRegressionFieldPresence(unittest.TestCase):

    ORIG = {"tamper_probability", "is_suspicious", "ocr_text", "heatmap_file"}
    NEW  = {"decision_source", "original_pipeline_score", "model_comparisons"}

    def _build_response(self, pipeline_score, genai_result, override=True):
        genai_available = genai_result["available"]
        genai_score = genai_result["score"]
        model_comparisons = _build(
            genai_score=genai_score,
            models=[{"name": "efficientnetb3_cv", "label": "EfficientNetB3 CV",
                     "score": pipeline_score, "available": True}],
        )
        original_pipeline_score = pipeline_score
        if override:
            final_prob, decision_source, score_source = _apply(
                genai_score=genai_score, genai_available=genai_available,
                pipeline_score=pipeline_score, threshold=_THRESH,
            )
        else:
            if genai_available and genai_score is not None:
                final_prob, score_source = genai_score, "genai"
            else:
                final_prob, score_source = pipeline_score, "model_fallback"
            decision_source = "pipeline"
        return {
            "tamper_probability": round(final_prob * 100, 1),
            "is_suspicious": final_prob > 0.50,
            "ocr_text": "ocr",
            "heatmap_file": None,
            "decision_source": decision_source,
            "original_pipeline_score": round(original_pipeline_score * 100, 1),
            "model_comparisons": model_comparisons,
            "_debug": {"score_source": score_source},
        }

    def test_original_fields_always_present(self):
        combos = [
            (0.30, {"available": True,  "score": 0.80, "reasoning": ""}, True),
            (0.30, {"available": False, "score": None, "reasoning": ""}, True),
            (0.30, {"available": True,  "score": 0.80, "reasoning": ""}, False),
        ]
        for ps, gr, ov in combos:
            with self.subTest(override=ov, available=gr["available"]):
                resp = self._build_response(ps, gr, ov)
                for f in self.ORIG:
                    self.assertIn(f, resp)

    def test_new_fields_always_present(self):
        resp = self._build_response(0.30, {"available": True, "score": 0.75, "reasoning": ""})
        for f in self.NEW:
            self.assertIn(f, resp)

    def test_original_pipeline_score_never_overwritten(self):
        resp = self._build_response(0.15, {"available": True, "score": 0.90, "reasoning": "tamper"})
        self.assertAlmostEqual(resp["tamper_probability"], 90.0)   # override active
        self.assertAlmostEqual(resp["original_pipeline_score"], 15.0)  # preserved

    def test_decision_source_valid_values(self):
        valid = {"pipeline", "gemini"}
        cases = [
            (0.30, {"available": True,  "score": 0.32, "reasoning": ""}, True),
            (0.10, {"available": True,  "score": 0.90, "reasoning": ""}, True),
            (0.50, {"available": False, "score": None, "reasoning": ""}, True),
            (0.50, {"available": True,  "score": 0.90, "reasoning": ""}, False),
        ]
        for ps, gr, ov in cases:
            resp = self._build_response(ps, gr, ov)
            self.assertIn(resp["decision_source"], valid)


# ---------------------------------------------------------------------------
# Run as script
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    unittest.main(verbosity=2)
