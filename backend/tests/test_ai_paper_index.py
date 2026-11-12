"""Real 120-page PDF extraction and owner-scoped structural reading without a model."""
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from pypdf import PdfWriter
from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject
from backend.local_api.services import LocalServices
from backend.local_api.domain.api import PhyniteApi
from backend.local_api.domain.ai_attachments import AiAttachments, extract
from backend.local_api.domain.ai_workspace import ApiError


def paper_pdf(count=120):
    writer = PdfWriter()
    font = writer._add_object(DictionaryObject({NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'), NameObject('/BaseFont'): NameObject('/Helvetica')}))
    for index in range(count):
        page = writer.add_blank_page(width=612, height=792)
        page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): font})})
        lines = {0: ['Abstract', 'PDF indexing fixture, not scientific data.'], 11: ['2. Computational Methods', 'Method fixture: ecutwfc = 80 Ry and PBEsol.', 'Figure 2. Test geometry caption.'], 80: ['References', '[1] Fixture paper 2025 doi:10.1234/fixture'], 119: ['Appendix', 'End of retained evidence.']}.get(index, [f'Page {index + 1} fixture text.'])
        stream = DecodedStreamObject()
        stream.set_data(('BT /F1 12 Tf 50 750 Td ' + ' '.join(f'({line}) Tj 0 -16 Td' for line in lines) + ' ET').encode())
        page[NameObject('/Contents')] = writer._add_object(stream)
    writer.add_outline_item('Computational Methods', 11)
    out = io.BytesIO(); writer.write(out)
    return out.getvalue()


class AiPaperIndexTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        services = LocalServices(Path(temporary.name), 'http://127.0.0.1:8792', 'http://127.0.0.1:3000')
        self.files, self.owner = AiAttachments(PhyniteApi(services)), services.owner
        self.conversation = {'id': 'aic_paper', 'projectKey': None}

    def stored(self, document):
        raw = json.dumps(document).encode()
        self.files.services.s3.put_object(Bucket=self.files.services.bucket, Key='fixture-extracted', Body=raw)
        item = self.files.ai.put(self.owner, 'AI_ATTACHMENT', 'aif_paper', {'conversationId': 'aic_paper', 'projectKey': None, 'status': 'ready', 'filename': 'fixture.pdf', 'pages': document.get('pages'), 'sha256': 'a' * 64, 'extractedKey': 'fixture-extracted', 'extractedSha256': hashlib.sha256(raw).hexdigest()})
        self.files.ai.put(self.owner, 'AI_MESSAGE#aic_paper', 'aim_paper', {'attachmentIds': [item['id']]})
        return item

    def read(self, **payload):
        return self.files.read(self.owner, self.conversation, {'id': 'aif_paper', **payload})

    def test_120_pages_methodology_search_and_direct_jump_in_three_calls(self):
        document = extract(paper_pdf(), 'fixture.pdf', 'application/pdf')
        self.assertEqual(document['pages'], 120)
        self.assertEqual(len(document['pagesIndex']), 120)
        self.assertTrue(document['captions'])
        self.assertIn('10.1234/fixture', document['references'][0]['dois'])
        self.stored(document)
        index = self.read(includeIndex=True)['index']
        self.assertIn('Computational Methods', json.dumps(index))
        hit = self.read(search=True, query='ecutwfc PBEsol')['hits'][0]
        self.assertEqual(hit['page'], 12)
        result = self.read(offset=hit['sectionIndex'], pageStart=12, pageEnd=12)
        self.assertIn('80 Ry', result['sections'][0]['text'])
        self.assertIsNone(result['nextOffset'])
        self.assertLessEqual(len(json.dumps(result).encode()), 16000)

    def test_page_cap_and_invalid_ranges_or_section_ids_fail_closed(self):
        with self.assertRaises(ApiError): extract(paper_pdf(151), 'fixture.pdf', 'application/pdf')
        self.stored(extract(paper_pdf(3), 'fixture.pdf', 'application/pdf'))
        for payload in [{'pageStart': 2, 'pageEnd': 1}, {'pageStart': True}, {'section': 'missing'}, {'query': 'x', 'search': True, 'maxHits': 999}]:
            with self.subTest(payload=payload), self.assertRaises(ApiError): self.read(**payload)
        with self.assertRaises(ApiError): self.files.read('other-owner', self.conversation, {'id': 'aif_paper'})
        with self.assertRaises(ApiError): self.files.read(self.owner, {'id': 'aic_other', 'projectKey': None}, {'id': 'aif_paper'})

    def test_utf8_continuation_preserves_every_character_and_checksum(self):
        text = '科学 evidence ' * 4000
        self.stored({'sections': [{'reference': 'paragraph 1', 'text': text}], 'warnings': []})
        result, chunks = self.read(), []
        for _ in range(30):
            chunks.append(result['sections'][0]['text'])
            if result['nextOffset'] is None: break
            result = self.read(offset=result['nextOffset'], textOffset=result['nextTextOffset'])
        self.assertEqual(''.join(chunks), text)
        self.files.services.s3.put_object(Bucket=self.files.services.bucket, Key='fixture-extracted', Body=b'{}')
        with self.assertRaisesRegex(ApiError, 'checksum'): self.read()
