const API_BASE = "http://localhost:8011";

export interface SampleContract {
  id: string;
  title: string;
  n_clauses: number;
}

export interface Clause {
  clause_type: string;
  text: string;
  start: number;
  end: number;
  parsed_date: string | null;
  parsed_duration: [number, string] | null;
  trackable: boolean;
}

export interface Contract {
  id: string;
  title: string;
  text: string;
  clauses: Clause[];
}

export interface VerifyResult {
  model_available: boolean;
  message?: string;
  label?: "Entailment" | "Contradiction" | "NotMentioned";
  confidence?: number;
  probabilities?: Record<string, number>;
}

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

export function fetchSampleContracts(limit = 20) {
  return getJSON<SampleContract[]>(`/api/contracts/sample?limit=${limit}`);
}

export function fetchContract(id: string) {
  return getJSON<Contract>(`/api/contracts/${encodeURIComponent(id)}`);
}

export async function verifyClaim(premise: string, hypothesis: string): Promise<VerifyResult> {
  const res = await fetch(`${API_BASE}/api/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ premise, hypothesis }),
  });
  if (!res.ok) throw new Error(`verify -> ${res.status}`);
  return res.json();
}
