"""LibreOffice conversions: legacy .doc to .docx, and a document's own layout to PDF.

Each call uses a throwaway LibreOffice profile and directory, with a timeout,
so a broken file cannot leave state behind or hang the processor.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from .docx import DocxError

CONVERT_TIMEOUT_SECONDS = 150
MAX_OUTPUT_BYTES = 200 * 1024 * 1024
OLE_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
ZIP_MAGIC = b"PK\x03\x04"


def soffice_path() -> str | None:
    configured = os.environ.get("JIANTI_SOFFICE_PATH")
    if configured and Path(configured).exists():
        return configured
    for name in ("soffice", "libreoffice"):
        found = shutil.which(name)
        if found:
            return found
    for candidate in (r"C:\Program Files\LibreOffice\program\soffice.exe", "/usr/lib/libreoffice/program/soffice"):
        if Path(candidate).exists():
            return candidate
    return None


def is_legacy_doc(data: bytes) -> bool:
    return data[:8] == OLE_MAGIC


def convert(data: bytes, source_suffix: str, target: str) -> bytes:
    """Convert with headless LibreOffice; target is "docx" or "pdf"."""
    if target not in ("docx", "pdf") or source_suffix not in (".doc", ".docx"):
        raise ValueError("unsupported conversion")
    executable = soffice_path()
    if not executable:
        raise DocxError("服务器未安装 Word 版式转换组件（LibreOffice），暂时无法处理此文件")
    with tempfile.TemporaryDirectory(prefix="jianti-office-") as folder:
        work = Path(folder)
        source = work / f"source{source_suffix}"
        source.write_bytes(data)
        profile = (work / "profile").resolve().as_uri()
        output = work / "out"
        output.mkdir()
        filter_name = "docx:MS Word 2007 XML" if target == "docx" else "pdf:writer_pdf_Export"
        command = [executable, f"-env:UserInstallation={profile}", "--headless", "--norestore", "--nolockcheck",
                   "--convert-to", filter_name, "--outdir", str(output), str(source)]
        try:
            subprocess.run(command, check=False, timeout=CONVERT_TIMEOUT_SECONDS, cwd=folder,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           env={**os.environ, "HOME": folder})
        except subprocess.TimeoutExpired as exc:
            raise DocxError("Word 版式转换超时，请在 Word 中另存为 .docx 或 PDF 后重试") from exc
        produced = output / f"source.{target}"
        if not produced.exists() or produced.stat().st_size == 0:
            raise DocxError("Word 文件无法转换，请在 Word 中另存为 .docx 或 PDF 后重试")
        if produced.stat().st_size > MAX_OUTPUT_BYTES:
            raise DocxError("转换结果过大")
        result = produced.read_bytes()
    if target == "docx" and not result.startswith(ZIP_MAGIC):
        raise DocxError("Word 文件转换结果无效")
    if target == "pdf" and not result.startswith(b"%PDF-"):
        raise DocxError("Word 版式转换结果无效")
    return result
