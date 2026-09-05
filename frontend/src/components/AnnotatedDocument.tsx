import { Fragment } from "react";
import type { Clause, VerifyResult } from "../api";
import { categoryFor } from "../clauseCategories";

interface Props {
  text: string;
  clauses: Clause[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  verifyResults: Record<number, VerifyResult>;
}

interface Segment {
  clause: Clause;
  index: number;
}

function nonOverlapping(clauses: Clause[]): Segment[] {
  const withIndex = clauses.map((c, index) => ({ clause: c, index }));
  const sorted = [...withIndex].sort((a, b) => a.clause.start - b.clause.start);
  const result: Segment[] = [];
  let lastEnd = -1;
  for (const seg of sorted) {
    if (seg.clause.start >= lastEnd) {
      result.push(seg);
      lastEnd = seg.clause.end;
    }
  }
  return result;
}

function labelColor(result: VerifyResult | undefined): string | null {
  if (!result || !result.model_available || !result.label) return null;
  if (result.label === "Entailment") return "var(--entail)";
  if (result.label === "Contradiction") return "var(--contradict)";
  return "var(--not-mentioned)";
}

export default function AnnotatedDocument({ text, clauses, selectedIndex, onSelect, verifyResults }: Props) {
  const segments = nonOverlapping(clauses);

  const parts: React.ReactNode[] = [];
  let cursor = 0;

  segments.forEach((seg) => {
    if (seg.clause.start > cursor) {
      parts.push(<Fragment key={`plain-${cursor}`}>{text.slice(cursor, seg.clause.start)}</Fragment>);
    }
    const category = categoryFor(seg.clause.clause_type);
    const isSelected = selectedIndex === seg.index;
    const verification = verifyResults[seg.index];
    const annotationColor = labelColor(verification);

    parts.push(
      <mark
        key={`clause-${seg.index}`}
        className={`clause-highlight cat-${category} ${isSelected ? "clause-selected" : ""}`}
        style={annotationColor ? { borderBottomColor: annotationColor, borderBottomWidth: 4 } : undefined}
        onClick={() => onSelect(seg.index)}
      >
        {text.slice(seg.clause.start, seg.clause.end)}
        {verification?.label && (
          <sup className="inline-verify-badge" style={{ color: annotationColor ?? undefined }}>
            {verification.label === "Entailment" ? "✓" : verification.label === "Contradiction" ? "✗" : "?"}
          </sup>
        )}
      </mark>
    );
    cursor = seg.clause.end;
  });

  if (cursor < text.length) {
    parts.push(<Fragment key="tail">{text.slice(cursor)}</Fragment>);
  }

  return <div className="document-paper serif">{parts}</div>;
}
