import { useState } from "react";
import type { Clause, VerifyResult } from "../api";
import { CATEGORY_LABELS, categoryFor } from "../clauseCategories";

interface Props {
  clause: Clause;
  result?: VerifyResult;
  onVerify: (hypothesis: string) => void;
  verifying: boolean;
}

export default function ClausePanel({ clause, result, onVerify, verifying }: Props) {
  const [hypothesis, setHypothesis] = useState("");
  const category = categoryFor(clause.clause_type);

  return (
    <div className="clause-panel">
      <div className={`category-tag cat-${category}`}>{CATEGORY_LABELS[category]}</div>
      <h3 className="mono clause-type-title">{clause.clause_type}</h3>

      <blockquote className="serif cited-text">“{clause.text}”</blockquote>

      {(clause.parsed_date || clause.parsed_duration) && (
        <div className="parsed-facts">
          {clause.parsed_date && (
            <div className="fact-row">
              <span className="fact-label">parsed date</span>
              <span className="mono">{clause.parsed_date}</span>
            </div>
          )}
          {clause.parsed_duration && (
            <div className="fact-row">
              <span className="fact-label">parsed duration</span>
              <span className="mono">
                {clause.parsed_duration[0]} {clause.parsed_duration[1]}(s)
              </span>
            </div>
          )}
        </div>
      )}

      <div className="verify-block">
        <label className="fact-label" htmlFor="hyp-input">
          claimed obligation to verify against this clause
        </label>
        <textarea
          id="hyp-input"
          rows={3}
          value={hypothesis}
          onChange={(e) => setHypothesis(e.target.value)}
          placeholder='e.g. "This clause requires the vendor to give 30 days notice before renewal."'
        />
        <button
          className="verify-button"
          disabled={!hypothesis.trim() || verifying}
          onClick={() => onVerify(hypothesis)}
        >
          {verifying ? "Verifying…" : "Verify against cited clause"}
        </button>
      </div>

      {result && !result.model_available && (
        <div className="verify-pending mono">{result.message}</div>
      )}

      {result && result.model_available && result.label && (
        <div className={`verify-result result-${result.label.toLowerCase()}`}>
          <div className="verify-label mono">{result.label}</div>
          <div className="verify-confidence mono">
            confidence {(100 * (result.confidence ?? 0)).toFixed(0)}%
          </div>
          <div className="verify-probs mono">
            {result.probabilities &&
              Object.entries(result.probabilities).map(([k, v]) => (
                <div key={k} className="prob-row">
                  <span>{k}</span>
                  <span>{(v * 100).toFixed(0)}%</span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
