"""Private, stateless PDF processor. Nest/worker owns all persistence and tenancy."""
import base64
import hmac
import json
import math
import os
import threading

import pymupdf
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from starlette.concurrency import run_in_threadpool

TOKEN = os.environ.get("JIANTI_PROCESSOR_TOKEN", "")
if len(TOKEN) < 32:
    raise RuntimeError("JIANTI_PROCESSOR_TOKEN must contain at least 32 characters")

app = FastAPI(title="Jianti PDF processor", docs_url=None, redoc_url=None)
slots = threading.BoundedSemaphore(1)
MAX_BYTES = 100 * 1024 * 1024
MAX_PIXELS = 16_000_000


@app.exception_handler(HTTPException)
async def http_error(_request: Request, exc: HTTPException):
    return JSONResponse({"error": str(exc.detail), "code": f"processor_http_{exc.status_code}",
                         "retryable": exc.status_code in (429, 503)}, status_code=exc.status_code)


@app.get("/ready")
def ready():
    return {"ok": True, "protocolVersion": 1, "pid": os.getpid(), "instanceId": os.environ.get("JIANTI_INSTANCE_ID")}


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
