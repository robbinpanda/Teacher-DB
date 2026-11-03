import katex from "katex";
import {
  KATEX_MACROS,
  prepareLatex,
  repairDisplayText,
  scanMathText,
  splitMathBlanks,
  splitOutsideBlanks,
  unescapeTextLiterals,
  wrapBareLatex,
} from "../lib/math-format";

function textWithBareLatex(value: string, keyPrefix: string) {
  const wrapped = wrapBareLatex(value);
  if (wrapped === value) return <span key={keyPrefix}>{value}</span>;
  return (
    <span key={keyPrefix}>
      {scanMathText(wrapped).map((token, index) =>
        token.type === "math"
          ? renderKatex(token.value, token.display, `${keyPrefix}-m${index}`)
          : <span key={`${keyPrefix}-t${index}`}>{unescapeTextLiterals(token.value)}</span>,
      )}
    </span>
  );
}

function renderKatex(latex: string, display: boolean, key: string) {
  try {
    const html = katex.renderToString(prepareLatex(latex, display), {
      displayMode: display,
      throwOnError: true,
      strict: false,
      output: "html",
      trust: false,
      macros: KATEX_MACROS,
    });
    return (
      <span
        key={key}
        className={display ? "math-display" : "math-inline"}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  } catch {
    // A genuinely broken formula should not dump its source into the page.
    // Keep a compact marker with the source available on hover; the residual
    // report lists these questions for page-aware repair.
    return <span key={key} className="math-error" title={latex}>公式待核对</span>;
  }
}

function renderText(value: string, keyPrefix: string) {
  return splitOutsideBlanks(value).map((part, index) =>
    part.type === "blank"
      ? <span key={`${keyPrefix}-b${index}`} className="math-blank" role="img" aria-label="填空横线" />
      : textWithBareLatex(part.value, `${keyPrefix}-p${index}`),
  );
}

function renderMath(latex: string, display: boolean, keyPrefix: string) {
  const parts = splitMathBlanks(latex);
  const hasBlank = parts.some((part) => part.type === "blank");
  if (!hasBlank) return renderKatex(latex, display, keyPrefix);
  return (
    <span key={keyPrefix} className={display ? "math-display" : "math-inline"}>
      {parts.map((part, index) =>
        part.type === "blank"
          ? <span key={`${keyPrefix}-b${index}`} className="math-blank" role="img" aria-label="填空横线" />
          : renderKatex(part.value, display, `${keyPrefix}-m${index}`),
      )}
    </span>
  );
}

export function MathText({ text, className = "" }: { text: string; className?: string }) {
  const tokens = scanMathText(repairDisplayText(text));
  return (
    <span className={`math-text ${className}`.trim()}>
      {tokens.map((token, index) =>
        token.type === "math"
          ? renderMath(token.value, token.display, `math-${index}`)
          : <span key={`text-${index}`}>{renderText(token.value, `text-${index}`)}</span>,
      )}
    </span>
  );
}
