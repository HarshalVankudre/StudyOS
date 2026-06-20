/**
 * Convert common LaTeX text commands to Markdown so they render properly
 * in the Streamdown renderer. Does NOT touch content inside math delimiters
 * ($$...$$ or $...$) — that's real math for KaTeX.
 *
 * This is a safety net: the AI is instructed to use Markdown directly, but
 * some models fall back to LaTeX text commands like \texttt{...} which
 * Streamdown renders as raw text.
 */
export function sanitizeLatexText(input: string): string {
  // Split on math delimiters to avoid touching real math.
  // $$...$$ (display) and $...$ (inline) — keep math regions untouched.
  const mathRegex = /(\$\$[\s\S]*?\$\$|\$[^$\n]+\$)/g;
  const parts = input.split(mathRegex);

  return parts
    .map((part, i) => {
      // Odd indices are math regions captured by the split — leave them alone.
      if (i % 2 === 1) return part;

      return part
        // \texttt{...}        →  `...`   (inline code)
        .replace(/\\texttt\{([^{}]*)\}/g, "`$1`")
        // \textbf{...}        →  **...**  (bold)
        .replace(/\\textbf\{([^{}]*)\}/g, "**$1**")
        // \textit{...}        →  *...*   (italic)
        .replace(/\\textit\{([^{}]*)\}/g, "*$1*")
        // \emph{...}          →  *...*   (emphasis)
        .replace(/\\emph\{([^{}]*)\}/g, "*$1*")
        // \text{...}          →  ...     (plain text inside math-like contexts)
        .replace(/\\text\{([^{}]*)\}/g, "$1")
        // \item               →  -       (list items)
        .replace(/(^|\n)\\item\s+/g, "$1- ")
        // \\                  →  newline (LaTeX line break)
        .replace(/\\\\/g, "\n")
        // \textsc{...}        →  ...     (small caps — no MD equivalent, just unwrap)
        .replace(/\\textsc\{([^{}]*)\}/g, "$1")
        // Strip remaining \command{...} patterns but keep their content
        .replace(/\\[a-zA-Z]+\{([^{}]*)\}/g, "$1")
        // Strip bare \commands (like \LaTeX, \newline, \vspace{...})
        .replace(/\\[a-zA-Z]+(?:\s|$)/g, " ")
        .replace(/\\[a-zA-Z]+$/g, "");
    })
    .join("");
}
