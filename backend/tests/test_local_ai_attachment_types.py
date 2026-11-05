"""Supported image and text formats pass both upload and extraction validation."""
from __future__ import annotations

import json
import io
import tempfile
import unittest
from pathlib import Path

from backend.local_api.domain.ai_attachments import AiAttachments, extract
from backend.local_api.domain.phynite_core import ApiError
from backend.local_api.domain.api import PhyniteApi
from backend.local_api.services import LocalServices


class LocalAiAttachmentTypeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.services = LocalServices(Path(self.temporary.name), "http://127.0.0.1:49170", "http://127.0.0.1:3000")
        self.attachments = AiAttachments(PhyniteApi(self.services))
        self.conversation = {"id": "aic_types", "projectKey": None}

    def ticket(self, filename):
        result = self.attachments.handle(self.services.owner, self.conversation, "POST", None, "", {"filename": filename, "sizeBytes": 12, "sha256": "0" * 64})
        return json.loads(result["body"])["attachment"]

    def test_gif_images_and_code_files_are_accepted(self):
        self.assertEqual(self.ticket("diffraction.gif")["mediaType"], "image/gif")
        for name in ("analysis.py", "notebook.ipynb", "paper.tex", "refs.bib", "INCAR", "KPOINTS", "OUTCAR", "run.f90"):
            self.assertEqual(self.ticket(name)["mediaType"], "text/plain", name)

    def test_licensed_vasp_potcar_and_legacy_binary_formats_are_rejected(self):
        for name in ("POTCAR", "report.doc", "sheet.xls", "slides.pptx"):
            with self.assertRaises(ApiError, msg=name) as caught:
                self.ticket(name)
            self.assertEqual(caught.exception.code, "AI_ATTACHMENT_TYPE")

    def test_still_gif_is_readable_and_animation_needs_explicit_frame_selection(self):
        from PIL import Image

        image = Image.new("RGB", (2, 2), "white")
        still = io.BytesIO()
        image.save(still, format="GIF")
        self.assertTrue(extract(still.getvalue(), "structure.gif", "image/gif")["visual"])
        animated = io.BytesIO()
        image.save(animated, format="GIF", save_all=True, append_images=[Image.new("RGB", (2, 2), "black")])
        with self.assertRaises(ApiError) as caught:
            extract(animated.getvalue(), "trajectory.gif", "image/gif")
        self.assertEqual(caught.exception.code, "AI_ATTACHMENT_INVALID")

    def test_docx_retains_scientific_text_tables_and_references(self):
        from docx import Document

        document = Document()
        document.add_paragraph("Energy = -12.5 eV")
        table = document.add_table(rows=1, cols=2)
        table.cell(0, 0).text = "a (Å)"
        table.cell(0, 1).text = "5.43"
        source = io.BytesIO()
        document.save(source)
        result = extract(source.getvalue(), "results.docx", self.ticket("results.docx")["mediaType"])
        self.assertEqual(result["sections"][0], {"reference": "paragraph 1", "text": "Energy = -12.5 eV"})
        self.assertEqual(result["sections"][1], {"reference": "table 1, row 1", "text": "a (Å)\t5.43"})

    def test_xlsx_retains_cell_values_and_never_invents_formula_results(self):
        from openpyxl import Workbook

        workbook = Workbook()
        sheet = workbook.active
        sheet.title = "Results"
        sheet.append(["Energy (eV)", -12.5, "=1+2"])
        source = io.BytesIO()
        workbook.save(source)
        result = extract(source.getvalue(), "results.xlsx", self.ticket("results.xlsx")["mediaType"])
        self.assertEqual(result["sheets"], ["Results"])
        self.assertEqual(result["sections"][0]["reference"], "Results!A1:C1")
        cells = json.loads(result["sections"][0]["text"])
        self.assertEqual(cells[1], {"cell": "B1", "value": -12.5})
        self.assertEqual(cells[2], {"cell": "C1", "formula": "=1+2", "cachedValue": None})
        self.assertTrue(any("not evaluated" in warning for warning in result["warnings"]))

    def test_code_and_vasp_text_is_extracted_as_numbered_line_sections(self):
        document = extract(b"import numpy as np\nprint(np.pi)\n", "analysis.py", "text/plain")
        self.assertEqual(document["sections"][0]["reference"], "lines 1–2")
        self.assertIn("np.pi", document["sections"][0]["text"])
        self.assertFalse(document["visual"])
        incar = extract(b"ENCUT = 520\nISMEAR = 0\n", "INCAR", "text/plain")
        self.assertIn("ENCUT = 520", incar["sections"][0]["text"])
        with self.assertRaises(ApiError):
            extract(b"PAW_PBE Fe 06Sep2000\n", "POTCAR", "text/plain")


if __name__ == "__main__":
    unittest.main()
