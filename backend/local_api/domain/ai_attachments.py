"""Owner/project/conversation-scoped source files. Parsers never execute file contents."""
from __future__ import annotations
import csv
import hashlib
import io
import json
import re
import secrets
import zipfile
from pathlib import PurePosixPath
from backend.local_api.domain.ai_workspace import clean, fail
from backend.local_api.domain.phynite_core import response, storage_owner

FILE_LIMIT = 10 * 1024 ** 2
TYPES = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp", "pdf": "application/pdf", "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}
TEXT_EXTENSIONS = {"csv", "tsv", "txt", "md", "markdown", "log", "out", "in", "inp", "cif", "xyz", "poscar", "contcar", "xsf", "json", "yaml", "yml", "dat", "upf", "lmp", "lammps"}


def extract(raw: bytes, filename: str, media: str) -> dict:
    if not raw or len(raw) > FILE_LIMIT:
        fail(413, "Use a nonempty file up to 10 MB.", "AI_ATTACHMENT_LIMIT")
    ext = filename.rsplit(".", 1)[-1].lower()
    warnings, sections, metadata = [], [], {}
    if media.startswith("image/"):
        from PIL import Image
        Image.MAX_IMAGE_PIXELS = 20_000_000
        with Image.open(io.BytesIO(raw)) as image:
            if image.format not in {"PNG", "JPEG", "WEBP"} or Image.MIME[image.format] != media or image.width * image.height > 20_000_000:
                fail(422, "Use a valid PNG, JPEG or WebP image up to 20 megapixels.", "AI_ATTACHMENT_INVALID")
            image.verify()
        return {"sections": [], "warnings": [], "visual": True}
    if media == "application/pdf":
        from pypdf import PdfReader, apply_configuration
        if not raw.startswith(b"%PDF-"):
            fail(422, "This is not a valid PDF.", "AI_ATTACHMENT_INVALID")
        with apply_configuration(maximum_declared_stream_length=8_000_000, zlib_maximum_output_length=8_000_000, array_based_stream_maximum_output_length=8_000_000, stream_decoding_work_maximum_length=16_000_000):
            pdf = PdfReader(io.BytesIO(raw), strict=True)
            if pdf.is_encrypted:
                fail(422, "Upload an unencrypted PDF.", "AI_ATTACHMENT_ENCRYPTED")
            if len(pdf.pages) > 50:
                fail(413, "Split this PDF into files of at most 50 pages.", "AI_ATTACHMENT_LIMIT")
            metadata["pages"] = len(pdf.pages)
            total = 0
            for index, page in enumerate(pdf.pages):
                text = page.extract_text() or ""
                total += len(text)
                if total > 8_000_000:
                    fail(413, "Split this PDF into smaller documents before uploading.", "AI_ATTACHMENT_LIMIT")
                for offset in range(0, max(1, len(text)), 8000):
                    sections.append({"reference": f"page {index + 1}" + (f", part {offset // 8000 + 1}" if len(text)>8000 else ""), "text": text[offset:offset+8000]})
                if not text.strip():
                    warnings.append(f"Page {index + 1} has no extractable text; visual PDF reading is required.")
        return {"sections": sections, "warnings": warnings, "visual": True, **metadata}
    if ext in {"docx", "xlsx"}:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            entries = archive.infolist()
            if len(entries) > 10000 or sum(e.file_size for e in entries) > 64 * 1024 ** 2 or any(".." in PurePosixPath(e.filename).parts or PurePosixPath(e.filename).is_absolute() for e in entries):
                fail(413, "This document archive exceeds safe extraction limits.", "AI_ATTACHMENT_LIMIT")
            if any("vbaproject" in e.filename.lower() for e in entries):
                fail(422, "Upload a document without macros.", "AI_ATTACHMENT_INVALID")
    if ext == "docx":
        from docx import Document
        document = Document(io.BytesIO(raw))
        for index, paragraph in enumerate(document.paragraphs):
            if paragraph.text.strip():
                sections.append({"reference": f"paragraph {index + 1}", "text": paragraph.text})
        for table_index, table in enumerate(document.tables):
            for row_index, row in enumerate(table.rows):
                sections.append({"reference": f"table {table_index + 1}, row {row_index + 1}", "text": "\t".join(cell.text for cell in row.cells)})
        warnings.append("DOCX reading includes text and tables; embedded pictures and page layout are not analyzed. Upload a PDF or image for those.")
    elif ext == "xlsx":
        from openpyxl import load_workbook
        values = load_workbook(io.BytesIO(raw), read_only=True, data_only=True, keep_links=False)
        formulas = load_workbook(io.BytesIO(raw), read_only=True, data_only=False, keep_links=False)
        metadata["sheets"] = values.sheetnames
        count = 0
        for sheet, formula_sheet in zip(values, formulas):
            # Never trust a forged huge dimension or allocate an entire sheet.
            sheet.reset_dimensions(); formula_sheet.reset_dimensions()
            sheet.calculate_dimension(force=True); formula_sheet.calculate_dimension(force=True)
            if sheet.max_row > 100000 or sheet.max_column > 1024 or sheet.max_row * sheet.max_column > 2000000:
                fail(413, "Narrow this sheet to at most 100,000 rows, 1,024 columns and two million cell positions before uploading.", "AI_ATTACHMENT_LIMIT")
            for row, formula_row in zip(sheet.iter_rows(), formula_sheet.iter_rows()):
                cells = []
                for cell, formula in zip(row, formula_row):
                    if cell.value is None and formula.value is None:
                        continue
                    count += 1
                    if count > 100000:
                        fail(413, "Use a workbook with at most 100,000 populated cells.", "AI_ATTACHMENT_LIMIT")
                    if formula.data_type == "f":
                        cells.append({"cell": formula.coordinate, "formula": formula.value, "cachedValue": cell.value})
                        if cell.value is None:
                            warnings.append(f"{sheet.title}!{formula.coordinate}: formula has no cached value; it was not evaluated.")
                    else:
                        cells.append({"cell": cell.coordinate, "value": cell.value})
                if cells:
                    sections.append({"reference": f"{sheet.title}!{cells[0]['cell']}:{cells[-1]['cell']}", "text": json.dumps(cells, ensure_ascii=False, default=str)})
        values.close(); formulas.close()
        warnings.append("Spreadsheet formulas are never executed. Values are source values or explicitly labeled cached formula results; charts are not read.")
    else:
        if ext not in TEXT_EXTENSIONS and filename.lower() not in {"poscar", "contcar"}:
            fail(415, "Use an image, PDF, DOCX, XLSX or supported research text file.", "AI_ATTACHMENT_TYPE")
        try:
            text = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            fail(422, "Save this text file as UTF-8 before attaching it.", "AI_ATTACHMENT_ENCODING")
        if "\x00" in text:
            fail(415, "This file contains binary data rather than research text.", "AI_ATTACHMENT_TYPE")
        if ext in {"csv", "tsv"}:
            rows = csv.reader(io.StringIO(text), delimiter="\t" if ext == "tsv" else ",")
            for index, row in enumerate(rows):
                sections.append({"reference": f"row {index + 1}", "text": json.dumps(row, ensure_ascii=False)})
        else:
            lines = text.splitlines()
            sections = [{"reference": f"lines {index + 1}–{index + len(lines[index:index + 100])}", "text": "\n".join(lines[index:index + 100])} for index in range(0, len(lines), 100)]
    if sum(len(section["text"]) for section in sections) > 8_000_000 or len(sections) > 100000:
        fail(413, "Split this document into smaller sections before uploading.", "AI_ATTACHMENT_LIMIT")
    chunks = []
    for section in sections:
        value = section["text"]
        for offset in range(0, max(1, len(value)), 8000):
            chunks.append({"reference": section["reference"] + (f", part {offset // 8000 + 1}" if len(value) > 8000 else ""), "text": value[offset:offset + 8000]})
    return {"sections": chunks, "warnings": warnings[:100], "visual": False, **metadata}


class AiAttachments:
    def __init__(self, api):
        from backend.local_api.domain.ai_workspace import AiWorkspace
        self.ai, self.services = AiWorkspace(api), api.services

    def get(self, owner, conversation, item_id):
        item = self.ai.row(owner, "AI_ATTACHMENT", item_id)
        if item["conversationId"] != conversation["id"] or item["projectKey"] != conversation["projectKey"]:
            fail(404, "This attachment is not in the selected conversation.", "AI_NOT_FOUND")
        return item

    def url(self, item, upload=False):
        params = {"Bucket": self.services.bucket, "Key": item["objectKey"]}
        if upload:
            params.update({"ContentType": item["mediaType"], "ServerSideEncryption": "AES256"})
        return self.services.s3.generate_presigned_url("put_object" if upload else "get_object", Params=params, ExpiresIn=300)

    def handle(self, owner, conversation, method, item_id, operation, payload):
        if method == "POST" and not item_id:
            filename, size, checksum = payload.get("filename"), payload.get("sizeBytes"), payload.get("sha256")
            if not isinstance(filename, str) or not filename.strip() or len(filename) > 200 or any(c in filename for c in "/\\\r\n\x00") or type(size) is not int or not 0 < size <= FILE_LIMIT or not isinstance(checksum, str) or not re.fullmatch(r"[a-f0-9]{64}", checksum):
                fail(400, "Provide a valid filename, SHA-256 and size up to 10 MB.", "AI_ATTACHMENT_INVALID")
            ext = filename.rsplit(".", 1)[-1].lower()
            media = TYPES.get(ext)
            if not media and (ext in TEXT_EXTENSIONS or filename.lower() in {"poscar", "contcar"}):
                media = "text/plain"
            if not media:
                fail(415, "Use PNG/JPEG/WebP, PDF, DOCX, XLSX or research text. Legacy DOC/XLS files must be converted first.", "AI_ATTACHMENT_TYPE")
            item_id = "aif_" + secrets.token_hex(16)
            item = self.ai.put(owner, "AI_ATTACHMENT", item_id, {"conversationId": conversation["id"], "projectKey": conversation["projectKey"], "filename": filename, "sizeBytes": size, "sha256": checksum, "mediaType": media, "status": "uploading", "objectKey": f"users/{storage_owner(owner)}/ai/{conversation['id']}/attachments/{item_id}/source"})
            return response(201, {"attachment": clean(item)})
        item = self.get(owner, conversation, item_id)
        if method == "GET" and operation in {"upload", "content"}:
            if operation == "upload" and item["status"] != "uploading":
                fail(409, "Completed source files are immutable. Attach a new file instead.", "AI_ATTACHMENT_IMMUTABLE")
            if operation == "content" and item["status"] != "ready":
                fail(409, "This file is not ready.", "AI_ATTACHMENT_NOT_READY")
            return response(200, {"attachment": clean(item), "url": self.url(item, operation == "upload")})
        if method == "POST" and operation == "complete":
            if item["status"] == "ready":
                return response(200, {"attachment": clean(item)})
            raw = self.services.s3.get_object(Bucket=self.services.bucket, Key=item["objectKey"])["Body"].read(FILE_LIMIT + 1)
            if len(raw) != item["sizeBytes"] or hashlib.sha256(raw).hexdigest() != item["sha256"]:
                fail(422, "The uploaded bytes do not match the original file. Upload it again.", "AI_ATTACHMENT_CHECKSUM")
            try:
                document = extract(raw, item["filename"], item["mediaType"])
                extracted = json.dumps(document, ensure_ascii=False).encode()
                if len(extracted) > 16 * 1024 ** 2:
                    fail(413, "Split this document into smaller files before uploading; extracted evidence exceeds the reading limit.", "AI_ATTACHMENT_LIMIT")
            except Exception as error:
                from backend.local_api.domain.phynite_core import ApiError
                message = str(error) if isinstance(error, ApiError) else "This file could not be parsed. Check that it is a valid, unencrypted document."
                self.ai.update(owner, "AI_ATTACHMENT", item, {"status": "failed", "error": message})
                if isinstance(error, ApiError):
                    raise
                fail(422, message, "AI_ATTACHMENT_INVALID")
            original_key = item["objectKey"] + "/" + item["sha256"]
            self.services.s3.put_object(Bucket=self.services.bucket, Key=original_key, Body=raw, ContentType=item["mediaType"], ServerSideEncryption="AES256")
            key = original_key + ".json"
            self.services.s3.put_object(Bucket=self.services.bucket, Key=key, Body=extracted, ContentType="application/json", ServerSideEncryption="AES256")
            vision = {}
            if item["mediaType"].startswith("image/"):
                from PIL import Image, ImageOps
                with Image.open(io.BytesIO(raw)) as source:
                    image = ImageOps.exif_transpose(source)
                    if len(raw) > 4_500_000 or max(image.size) > 1568:
                        image.thumbnail((1568, 1568))
                        if image.mode in {"RGBA", "LA"}:
                            alpha = image.convert("RGBA")
                            image = Image.new("RGB", image.size, "white")
                            image.paste(alpha, mask=alpha.getchannel("A"))
                        else:
                            image = image.convert("RGB")
                        buffer = io.BytesIO(); image.save(buffer, format="JPEG", quality=90)
                        prepared = buffer.getvalue()
                        vision_key = original_key + ".vision.jpg"
                        self.services.s3.put_object(Bucket=self.services.bucket, Key=vision_key, Body=prepared, ContentType="image/jpeg", ServerSideEncryption="AES256")
                        vision = {"visionKey": vision_key, "providerSha256": hashlib.sha256(prepared).hexdigest(), "providerMediaType": "image/jpeg"}
                        document["warnings"].append("The image is resized for model reading; the original file and its checksum are retained.")
            item = self.ai.update(owner, "AI_ATTACHMENT", item, {"status": "ready", "objectKey": original_key, "extractedKey": key, **vision, **{k: document[k] for k in ("pages", "sheets", "warnings", "visual") if k in document}})
            return response(200, {"attachment": clean(item)})
        fail(405, "This attachment operation is not supported.")

    def read(self, owner, conversation, payload, provider=False):
        item = self.get(owner, conversation, payload.get("id", ""))
        if item["status"] != "ready":
            fail(409, "This attachment is not ready.", "AI_ATTACHMENT_NOT_READY")
        sent = any(item["id"] in message.get("attachmentIds", []) for message in self.services.list_owner_items(owner, "AI_MESSAGE#" + conversation["id"]))
        if not sent:
            fail(403, "This file has not been sent to the conversation.", "AI_ATTACHMENT_NOT_SENT")
        if provider and item.get("visual"):
            target = {**item, "objectKey": item.get("visionKey", item["objectKey"])}
            return {"attachment": clean(item), "url": self.url(target), "providerMediaType": item.get("providerMediaType", item["mediaType"]), "providerSha256": item.get("providerSha256", item["sha256"])}
        document = json.loads(self.services.s3.get_object(Bucket=self.services.bucket, Key=item["extractedKey"])["Body"].read(16 * 1024 ** 2))
        offset = payload.get("offset", 0)
        if type(offset) is not int or offset < 0:
            fail(400, "Use a nonnegative section offset.")
        sections, length = [], 0
        for section in document["sections"][offset:offset + 100]:
            if length + len(section["text"]) > 16000:
                if not sections:
                    sections.append({**section, "text": section["text"][:16000], "truncated": True})
                break
            sections.append(section); length += len(section["text"])
        return {"attachment": clean(item), "sections": clean(sections), "totalSections": len(document["sections"]), "nextOffset": offset + len(sections) if offset + len(sections) < len(document["sections"]) else None, "warnings": document["warnings"], "untrusted": True}
