"""Reader for MathType equations (MTEF version 5) stored in Word OLE objects.

Written from Design Science's public "MTEF v.5" format description. The reader
builds a record tree and refuses anything it does not fully understand, so a
caller can fall back to the equation's preview image instead of guessing.
"""
from __future__ import annotations

import io
import struct
from dataclasses import dataclass, field

import olefile

MAX_EQUATION_BYTES = 2 * 1024 * 1024
MAX_RECORDS = 50_000
MAX_DEPTH = 64

# Record tags.
END, LINE, CHAR, TMPL, PILE, MATRIX, EMBELL, RULER = 0, 1, 2, 3, 4, 5, 6, 7
FONT_STYLE_DEF, SIZE, FULL, SUB, SUB2, SYM, SUBSYM = 8, 9, 10, 11, 12, 13, 14
COLOR, COLOR_DEF, FONT_DEF, EQN_PREFS, ENCODING_DEF = 15, 16, 17, 18, 19
FUTURE = 100

# Option bits.
OPT_NUDGE = 0x08
OPT_CHAR_EMBELL = 0x01
OPT_CHAR_FUNC_START = 0x02
OPT_CHAR_ENC_CHAR_8 = 0x04
OPT_CHAR_ENC_CHAR_16 = 0x10
OPT_CHAR_ENC_NO_MTCODE = 0x20
OPT_LINE_NULL = 0x01
OPT_LP_RULER = 0x02
OPT_LINE_LSPACE = 0x04
OPT_COLOR_CMYK = 0x01
OPT_COLOR_SPOT = 0x02
OPT_COLOR_NAME = 0x04


class MtefError(ValueError):
    """The bytes are not a complete MTEF v5 equation this reader understands."""


@dataclass
class Node:
    kind: str  # line, char, tmpl, pile, matrix
    options: int = 0
    typeface: int = 0
    mtcode: int | None = None
    embells: list[int] = field(default_factory=list)
    selector: int = 0
    variation: int = 0
    rows: int = 0
    cols: int = 0
    halign: int = 0
    children: list["Node"] = field(default_factory=list)

    @property
    def null(self) -> bool:
        return self.kind == "line" and bool(self.options & OPT_LINE_NULL)


@dataclass
class Equation:
    inline: bool
    product_version: tuple[int, int]
    lines: list[Node]
    tex_input: str | None = None  # TeX the author typed, when MathType kept it


def equation_native(ole_bytes: bytes) -> bytes:
    """Return the MTEF bytes from an OLE object's "Equation Native" stream."""
    try:
        ole = olefile.OleFileIO(io.BytesIO(ole_bytes))
    except Exception as exc:  # olefile raises several unrelated types
        raise MtefError("not an OLE compound file") from exc
    try:
        if not ole.exists("Equation Native"):
            raise MtefError("no Equation Native stream")
        if ole.get_size("Equation Native") > MAX_EQUATION_BYTES:
            raise MtefError("equation stream too large")
        stream = ole.openstream("Equation Native").read()
    finally:
        ole.close()
    if len(stream) < 28:
        raise MtefError("equation stream too short")
    # EQNOLEFILEHDR: cbHdr (WORD), version (DWORD), cf (WORD), cbObject (DWORD), 4 reserved DWORDs.
    header_size, = struct.unpack_from("<H", stream, 0)
    size, = struct.unpack_from("<I", stream, 8)
    if header_size != 28 or size > len(stream) - header_size:
        raise MtefError("unexpected equation stream header")
    return stream[header_size:header_size + size] if size else stream[header_size:]


class _Reader:
    def __init__(self, data: bytes):
        self.data = data
        self.pos = 0
        self.records = 0
        self.tex_input: str | None = None

    def byte(self) -> int:
        if self.pos >= len(self.data):
            raise MtefError("truncated equation")
        value = self.data[self.pos]
        self.pos += 1
        return value

    def word(self) -> int:
        low = self.byte()
        return low | (self.byte() << 8)

    def cstring(self) -> bytes:
        end = self.data.find(b"\x00", self.pos)
        if end < 0:
            raise MtefError("unterminated string")
        value = self.data[self.pos:end]
        self.pos = end + 1
        return value

    def skip(self, count: int) -> None:
        if self.pos + count > len(self.data):
            raise MtefError("truncated equation")
        self.pos += count

    def nudge(self) -> None:
        dx, dy = self.byte(), self.byte()
        if dx == 128 and dy == 128:
            self.skip(4)

    def dimensions(self) -> None:
        """Skip a nibble-packed dimension array: [count] then values ending in 0xF."""
        count = self.byte()
        seen, high = 0, True
        current = 0
        while seen < count:
            if high:
                current = self.byte()
                nibble = current >> 4
            else:
                nibble = current & 0x0F
            high = not high
            if nibble == 0x0F:
                seen += 1

    def ruler(self) -> None:
        stops = self.byte()
        self.skip(stops * 3)

    def variation(self) -> int:
        first = self.byte()
        if first & 0x80:
            return (first & 0x7F) | (self.byte() << 7)
        return first


def parse_mtef(data: bytes) -> Equation:
    reader = _Reader(data)
    if reader.byte() != 5:
        raise MtefError("only MTEF version 5 is supported")
    reader.byte()  # platform
    if reader.byte() != 0:
        raise MtefError("equation was not written by MathType")
    major, minor = reader.byte(), reader.byte()
    reader.cstring()  # application key, e.g. DSMT7
    inline = bool(reader.byte() & 0x01)
    # The equation ends at its top-level END. MathType reuses its buffer, so
    # bytes after it are often leftovers of an earlier edit, not equation data.
    lines = _object_list(reader, 0, top_level=True)
    return Equation(inline=inline, product_version=(major, minor), lines=lines, tex_input=reader.tex_input)


def _object_list(reader: _Reader, depth: int, top_level: bool = False) -> list[Node]:
    if depth > MAX_DEPTH:
        raise MtefError("equation nesting too deep")
    nodes: list[Node] = []
    while True:
        if top_level and reader.pos >= len(reader.data):
            return nodes
        reader.records += 1
        if reader.records > MAX_RECORDS:
            raise MtefError("too many records")
        tag = reader.byte()
        if tag == END:
            return nodes
        node = _record(reader, tag, depth)
        if node is not None:
            nodes.append(node)


def _record(reader: _Reader, tag: int, depth: int) -> Node | None:
    if tag >= FUTURE:
        # Extension records carry a one-byte length (0xFF: a 16-bit length follows).
        length = reader.byte()
        if length == 0xFF:
            length = reader.word()
        start = reader.pos
        reader.skip(length)
        payload = reader.data[start:reader.pos]
        label, _, value = payload.partition(b"\x00")
        if label == b"TeX Input Language" and value.rstrip(b"\x00"):
            reader.tex_input = value.rstrip(b"\x00").decode("latin-1")
        return None
    if tag == LINE:
        options = reader.byte()
        if options & OPT_NUDGE:
            reader.nudge()
        if options & OPT_LINE_LSPACE:
            reader.word()
        if options & OPT_LP_RULER:
            # MathType writes the ruler's contents here without a RULER tag.
            reader.ruler()
        node = Node("line", options=options)
        if not options & OPT_LINE_NULL:
            node.children = _object_list(reader, depth + 1)
        return node
    if tag == CHAR:
        options = reader.byte()
        if options & OPT_NUDGE:
            reader.nudge()
        typeface = reader.byte() - 128
        mtcode = None if options & OPT_CHAR_ENC_NO_MTCODE else reader.word()
        if options & OPT_CHAR_ENC_CHAR_8:
            reader.byte()
        if options & OPT_CHAR_ENC_CHAR_16:
            reader.word()
        node = Node("char", options=options, typeface=typeface, mtcode=mtcode)
        if options & OPT_CHAR_EMBELL:
            node.embells = _embellishments(reader)
        return node
    if tag == TMPL:
        options = reader.byte()
        if options & OPT_NUDGE:
            reader.nudge()
        selector = reader.byte()
        variation = reader.variation()
        reader.byte()  # template-specific options
        node = Node("tmpl", options=options, selector=selector, variation=variation)
        node.children = _object_list(reader, depth + 1)
        return node
    if tag == PILE:
        options = reader.byte()
        if options & OPT_NUDGE:
            reader.nudge()
        halign = reader.byte()
        reader.byte()  # vertical alignment
        if options & OPT_LP_RULER:
            # MathType writes the ruler's contents here without a RULER tag.
            reader.ruler()
        node = Node("pile", options=options, halign=halign)
        node.children = _object_list(reader, depth + 1)
        return node
    if tag == MATRIX:
        options = reader.byte()
        if options & OPT_NUDGE:
            reader.nudge()
        reader.byte()  # vertical alignment
        reader.byte()  # horizontal justification
        reader.byte()  # vertical justification
        rows, cols = reader.byte(), reader.byte()
        # Partition line styles: 2 bits for each of rows+1 and cols+1 lines.
        reader.skip(((rows + 1) * 2 + 7) // 8)
        reader.skip(((cols + 1) * 2 + 7) // 8)
        node = Node("matrix", options=options, rows=rows, cols=cols)
        node.children = _object_list(reader, depth + 1)
        return node
    if tag == RULER:
        reader.ruler()
        return None
    if tag == FONT_STYLE_DEF:
        reader.byte()
        reader.byte()
        return None
    if tag == SIZE:
        first = reader.byte()
        if first == 101:
            reader.word()
        elif first == 100:
            reader.byte()
            reader.word()
        else:
            reader.byte()
        return None
    if tag in (FULL, SUB, SUB2, SYM, SUBSYM):
        return None
    if tag == COLOR:
        reader.byte()
        return None
    if tag == COLOR_DEF:
        options = reader.byte()
        reader.skip(4 * 2 if options & OPT_COLOR_CMYK else 3 * 2)
        if options & OPT_COLOR_NAME:
            reader.cstring()
        return None
    if tag == FONT_DEF:
        reader.byte()
        reader.cstring()
        return None
    if tag == EQN_PREFS:
        reader.byte()  # options
        reader.dimensions()  # sizes
        reader.dimensions()  # spacing
        styles = reader.byte()
        for _ in range(styles):
            if reader.byte():
                reader.byte()
        return None
    if tag == ENCODING_DEF:
        reader.cstring()
        return None
    if tag == EMBELL:
        raise MtefError("embellishment outside a character")
    raise MtefError(f"unknown record type {tag}")


def _embellishments(reader: _Reader) -> list[int]:
    kinds: list[int] = []
    while True:
        tag = reader.byte()
        if tag == END:
            return kinds
        if tag == COLOR:
            reader.byte()
            continue
        if tag in (FULL, SUB, SUB2, SYM, SUBSYM):
            continue
        if tag != EMBELL:
            raise MtefError("expected embellishment record")
        options = reader.byte()
        if options & OPT_NUDGE:
            reader.nudge()
        kinds.append(reader.byte())
