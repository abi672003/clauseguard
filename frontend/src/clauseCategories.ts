// Mirrors src/clauseguard/extraction/deadline_mapping.py's TRACKABLE_CLAUSE_TYPES
// so the document view's highlight colors match what the backend actually
// tracks as an obligation.
const TRACKABLE: Record<string, string> = {
  "Agreement Date": "reference",
  "Effective Date": "reference",
  "Expiration Date": "deadline",
  "Renewal Term": "renewal",
  "Notice Period To Terminate Renewal": "renewal",
  "Termination For Convenience": "termination",
  "Post-Termination Services": "termination",
  "Warranty Duration": "duration",
  "Liquidated Damages": "penalty",
  "Uncapped Liability": "penalty",
  "Cap On Liability": "penalty",
  "Minimum Commitment": "penalty",
};

export function categoryFor(clauseType: string): string {
  return TRACKABLE[clauseType] ?? "other";
}

export const CATEGORY_LABELS: Record<string, string> = {
  reference: "Reference Date",
  deadline: "Deadline",
  renewal: "Renewal Condition",
  termination: "Termination Condition",
  duration: "Duration Obligation",
  penalty: "Penalty Term",
  other: "Other Clause",
};
