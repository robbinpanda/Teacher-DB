import katex from "katex";

export function MathText({ text, className = "" }: { text: string; className?: string }) {
  const parts = text.split(/(\$\$[\s\S]+?\$\$|(?<!\\)\$[^$]+?(?<!\\)\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\))/g);
  return (
    <span className={`math-text ${className}`.trim()}>
      {parts.map((part, index) => {
        const displayMode = (part.startsWith("$$") && part.endsWith("$$")) || (part.startsWith("\\[") && part.endsWith("\\]"));
        if (displayMode || (part.startsWith("$") && part.endsWith("$")) || (part.startsWith("\\(") && part.endsWith("\\)"))) {
          const delimiterLength = displayMode || part.startsWith("\\(") ? 2 : 1;
          const latex = part.slice(delimiterLength, -delimiterLength);
          try {
            return (
              <span
                key={`${latex}-${index}`}
                className={displayMode ? "math-display" : "math-inline"}
                dangerouslySetInnerHTML={{
                  __html: katex.renderToString(latex, {
                    displayMode,
                    throwOnError: false,
                    output: "html",
                  }),
                }}
              />
            );
          } catch {
            return <span key={index}>{part}</span>;
          }
        }
        const normalizedText = part
          .replace(/\\r\\n(?=\s|[（(【\[]|$)/g, "\n")
          .replace(/\\n(?=\s|[（(【\[]|$)/g, "\n");
        return <span key={index}>{normalizedText}</span>;
      })}
    </span>
  );
}
