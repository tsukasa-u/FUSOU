/** @jsxImportSource react */
import { useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

export interface LatexRendererProps {
  /** LaTeX string (without surrounding $) */
  latex: string;
  /** Display mode (block) vs inline */
  displayMode?: boolean;
  /** Additional CSS class */
  className?: string;
  /** Fallback text shown on parse error */
  fallback?: string;
}

/**
 * Renders a LaTeX string using KaTeX.
 *
 * Handles parse errors gracefully by falling back to monospace text.
 */
export function LatexRenderer({
  latex,
  displayMode = true,
  className = "",
  fallback,
}: LatexRendererProps) {
  const html = useMemo(() => {
    if (!latex) return "";
    try {
      return katex.renderToString(latex, {
        displayMode,
        throwOnError: false,
        trust: true,
        strict: false,
      });
    } catch {
      return "";
    }
  }, [latex, displayMode]);

  if (!html) {
    return (
      <code className={`font-mono text-sm ${className}`}>
        {fallback || latex || "N/A"}
      </code>
    );
  }

  return (
    <span className={className} dangerouslySetInnerHTML={{ __html: html }} />
  );
}

export default LatexRenderer;
