import katex from "katex";

export function MathText({ text, className = "" }: { text: string; className?: string }) {
  const parts = text.split(/(\$[^$]+\$)/g);
  return (
    <span className={`math-text ${className}`.trim()}>
      {parts.map((part, index) => {
        if (part.startsWith("$") && part.endsWith("$")) {
          const latex = part.slice(1, -1);
          try {
            return (
              <span
                key={`${latex}-${index}`}
                className="math-inline"
                dangerouslySetInnerHTML={{
                  __html: katex.renderToString(latex, {
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
