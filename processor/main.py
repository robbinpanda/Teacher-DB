"""Private, stateless PDF processor. Nest/worker owns all persistence and tenancy."""
import base64
import hmac
import json
import math
import os
import threading

import pymupdf
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from starlette.concurrency import run_in_threadpool

from processor.word.docx import MAX_DOCX_BYTES, DocxError, read_docx
from processor.word.office import convert, is_legacy_doc

TOKEN = os.environ.get("JIANTI_PROCESSOR_TOKEN", "")
if len(TOKEN) < 32:
    raise RuntimeError("JIANTI_PROCESSOR_TOKEN must contain at least 32 characters")

app = FastAPI(title="Jianti PDF processor", docs_url=None, redoc_url=None)
slots = threading.BoundedSemaphore(1)
docx_slots = threading.BoundedSemaphore(1)
DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
DOC_TYPE = "application/msword"
MAX_BYTES = 100 * 1024 * 1024
MAX_PIXELS = 16_000_000


@app.exception_handler(HTTPException)
async def http_error(_request: Request, exc: HTTPException):
    return JSONResponse({"error": str(exc.detail), "code": f"processor_http_{exc.status_code}",
                         "retryable": exc.status_code in (429, 503)}, status_code=exc.status_code)


@app.get("/ready")
def ready():
    return {"ok": True, "protocolVersion": 1, "pid": os.getpid(), "instanceId": os.environ.get("JIANTI_INSTANCE_ID")}


async def _word_body(request: Request) -> bytes:
    if not hmac.compare_digest(request.headers.get("x-processor-token", ""), TOKEN):
        raise HTTPException(401, "Processor authentication failed")
    content_type = request.headers.get("content-type", "").split(";")[0]
    if content_type not in (DOCX_TYPE, DOC_TYPE):
        raise HTTPException(415, "Expected a Word document")
    content = bytearray()
    async for chunk in request.stream():
        if len(content) + len(chunk) > MAX_DOCX_BYTES:
            raise HTTPException(413, "Word 文件超过 60 MB")
        content.extend(chunk)
    data = bytes(content)
    if (content_type == DOC_TYPE) != is_legacy_doc(data):
        raise HTTPException(415, "文件内容与 Word 格式不符")
    return data


def _parse_word(data: bytes) -> dict:
    legacy = is_legacy_doc(data)
    result = read_docx(convert(data, ".doc", "docx") if legacy else data)
    result["report"]["convertedFrom"] = "doc" if legacy else None
    return result


@app.post("/v1/docx/parse")
async def parse_docx(request: Request):
    """Read a .docx (or legacy .doc, converted first) into text blocks with placeholders and a report."""
    if not docx_slots.acquire(blocking=False):
        raise HTTPException(429, "Word processor is busy; retry later")
    try:
        data = await _word_body(request)
        try:
            return await run_in_threadpool(_parse_word, data)
        except DocxError as exc:
            raise HTTPException(422, str(exc)) from exc
        except Exception as exc:  # malformed XML, broken images
            raise HTTPException(422, "Word 文件无法解析，请在 Word 中另存为 .docx 后重试") from exc
    finally:
        docx_slots.release()


@app.post("/v1/docx/render")
async def render_docx(request: Request):
    """Print a Word document with its own layout (LibreOffice) for page-positioned papers."""
    if not docx_slots.acquire(blocking=False):
        raise HTTPException(429, "Word processor is busy; retry later")
    try:
        data = await _word_body(request)
        suffix = ".doc" if is_legacy_doc(data) else ".docx"
        try:
            pdf = await run_in_threadpool(convert, data, suffix, "pdf")
        except DocxError as exc:
            raise HTTPException(422, str(exc)) from exc
        return Response(pdf, media_type="application/pdf")
    finally:
        docx_slots.release()


@app.post("/v1/pdf/pages")
async def pages(request: Request):
    if not hmac.compare_digest(request.headers.get("x-processor-token", ""), TOKEN):
        raise HTTPException(401, "Processor authentication failed")
    if request.headers.get("content-type", "").split(";")[0] != "application/pdf":
        raise HTTPException(415, "Expected application/pdf")
    if not slots.acquire(blocking=False):
        raise HTTPException(429, "PDF processor is busy; retry later")
    document = None
    try:
        content = bytearray()
        async for chunk in request.stream():
            if len(content) + len(chunk) > MAX_BYTES:
                raise HTTPException(413, "PDF exceeds 100 MB")
            content.extend(chunk)
        try:
            document = pymupdf.open(stream=content, filetype="pdf")
        except Exception as exc:
            raise HTTPException(422, "Invalid PDF") from exc
        if document.needs_pass or not 1 <= len(document) <= 250:
            raise HTTPException(422, "PDF must be unencrypted and contain 1 to 250 pages")
        # Validate geometry before committing streaming headers.
        if any(page.rect.width <= 0 or page.rect.height <= 0 for page in document):
            raise HTTPException(422, "Invalid PDF page dimensions")
    except BaseException:
        if document is not None:
            document.close()
        slots.release()
        raise

    def render_page(index):
        page = document[index]
        scale = min(1.65, math.sqrt(MAX_PIXELS / (page.rect.width * page.rect.height)))
        pixmap = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), colorspace=pymupdf.csRGB, alpha=False)
        image = pixmap.tobytes("jpeg", jpg_quality=90)
        return json.dumps({"type": "page", "pageNumber": index + 1,
                           "width": pixmap.width, "height": pixmap.height,
                           "jpeg": base64.b64encode(image).decode("ascii")}) + "\n"

    async def events():
        try:
            yield json.dumps({"type": "metadata", "protocolVersion": 1, "pageCount": len(document)}) + "\n"
            for index in range(len(document)):
                yield await run_in_threadpool(render_page, index)
            yield json.dumps({"type": "complete", "pageCount": len(document)}) + "\n"
        except Exception:
            yield json.dumps({"type": "error", "error": "PDF page rendering failed"}) + "\n"
        finally:
            document.close()
            slots.release()

    return StreamingResponse(events(), media_type="application/x-ndjson")
