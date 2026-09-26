/**
 * Hand-written TypeScript mirrors of backend/app/schemas.py.
 * Keep this file in lockstep with that module — it is the wire contract.
 *
 * Wire note: pydantic `datetime` and `date` serialise to ISO-8601 strings,
 * so every temporal field is typed `string` here.
 */

/* ------------------------------------------------------------------ enums */
export type Verdict = 'grounded' | 'ungrounded' | 'uncertain';

export type AgentAction = 'auto_track' | 'escalate' | 'reject';

export type ObligationStatus =
  | 'auto_tracked'
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'expired';

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export type ObligationType =
  | 'deadline'
  | 'renewal'
  | 'termination'
  | 'payment'
  | 'reporting'
  | 'restriction'
  | 'liability'
  | 'ip'
  | 'audit'
  | 'insurance'
  | 'other';

export type PolicyMode = 'llm' | 'deterministic';

export type ReviewState = 'open' | 'approved' | 'rejected';

export type ReviewDecision = 'approve' | 'reject';

export type AblationArmName = 'verifier_on' | 'verifier_off';

export type HealthStatus = 'ok' | 'degraded';

/** Pipeline stages, in emission order. */
export type PipelineStage =
  | 'queued'
  | 'ingest'
  | 'segment'
  | 'prefilter'
  | 'extract'
  | 'deadline'
  | 'verify'
  | 'agent'
  | 'persist'
  | 'complete'
  | 'failed';

export const PIPELINE_STAGES = [
  'queued',
  'ingest',
  'segment',
  'prefilter',
  'extract',
  'deadline',
  'verify',
  'agent',
  'persist',
  'complete',
] as const satisfies readonly PipelineStage[];

/* ----------------------------------------------------------- generic bits */
/** Every list endpoint returns this envelope. */
export interface Paginated<T> {
  items: T[];
  total: number;
}

/** Mirrors `dict[str, Any]` — narrow at the call site rather than casting. */
export type JsonObject = Record<string, unknown>;

/* ----------------------------------------------------------------- clause */
export interface ClauseOut {
  id: string;
  index: number;
  text: string;
  char_start: number;
  char_end: number;
  category: string | null;
  category_score: number;
  runner_up: string | null;
  runner_up_score: number;
  prefilter_score: number;
  is_candidate: boolean;
}

/* ----------------------------------------------------------- verification */
export interface VerificationOut {
  id: string;
  premise: string;
  hypothesis: string;
  entailment: number;
  neutral: number;
  contradiction: number;
  margin: number;
  verdict: Verdict;
  threshold_used: number;
  model_name: string;
  latency_ms: number;
  evidence_sentence: string | null;
  created_at: string;
}

/* ------------------------------------------------------------------ agent */
export interface AgentDecisionOut {
  id: string;
  action: AgentAction;
  rationale: string;
  risk_flags: string[];
  confidence: number;
  policy_mode: PolicyMode;
  model_name: string | null;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
}

/* ------------------------------------------------------------- obligation */
export interface ObligationOut {
  id: string;
  contract_id: string;
  clause_id: string;
  obligation_type: ObligationType;
  title: string;
  claim: string;
  obligor: string | null;
  obligee: string | null;
  /** ISO date (YYYY-MM-DD). */
  due_date: string | null;
  due_date_basis: string | null;
  recurrence: string | null;
  notice_period_days: number | null;
  monetary_amount: number | null;
  currency: string | null;
  severity: Severity;
  extraction_confidence: number;
  status: ObligationStatus;
  created_at: string;
}

/** Everything a reviewer needs to adjudicate one obligation. */
export interface ObligationDetail extends ObligationOut {
  clause: ClauseOut | null;
  verification: VerificationOut | null;
  decision: AgentDecisionOut | null;
  contract_title: string | null;
}

/* --------------------------------------------------------------- contract */
export interface ContractSummary {
  id: string;
  title: string;
  filename: string | null;
  source: string;
  contract_type: string | null;
  party_a: string | null;
  party_b: string | null;
  /** ISO date (YYYY-MM-DD). */
  effective_date: string | null;
  governing_law: string | null;
  char_count: number;
  status: string;
  created_at: string;
  processed_at: string | null;
  obligation_count: number;
  tracked_count: number;
  review_count: number;
  rejected_count: number;
}

export interface ContractDetail extends ContractSummary {
  raw_text: string;
  clauses: ClauseOut[];
  obligations: ObligationDetail[];
  latest_run: PipelineRunOut | null;
}

/* ----------------------------------------------------------- pipeline run */
export interface StageTiming {
  stage: string;
  ms: number;
  detail: JsonObject;
}

export interface PipelineRunOut {
  id: string;
  contract_id: string;
  verifier_enabled: boolean;
  agent_mode: string;
  /** Keyed by stage name; values are StageTiming-shaped or raw millisecond numbers. */
  stage_timings: Record<string, unknown>;
  counts: Record<string, number>;
  total_ms: number;
  status: string;
  error: string | null;
  created_at: string;
}

/* ----------------------------------------------------------------- review */
export interface ReviewTaskOut {
  id: string;
  obligation_id: string;
  state: ReviewState;
  reason: string;
  priority: number;
  reviewer: string | null;
  notes: string | null;
  created_at: string;
  resolved_at: string | null;
  obligation: ObligationDetail | null;
}

export interface ReviewResolve {
  decision: ReviewDecision;
  reviewer?: string;
  notes?: string | null;
}

export interface ReviewStats {
  open: number;
  approved: number;
  rejected: number;
  mean_age_hours: number;
}

/* --------------------------------------------------------------- requests */
export interface AnalyzeRequest {
  verifier_enabled?: boolean | null;
  use_agent?: boolean | null;
  /** 1–2000. */
  max_clauses?: number | null;
}

export interface TextIngestRequest {
  title: string;
  /** Minimum 200 characters, enforced by the API. */
  text: string;
  contract_type?: string | null;
  analyze?: boolean;
  verifier_enabled?: boolean | null;
}

export interface SeedRequest {
  /** 1–60, default 8. */
  limit?: number;
  analyze?: boolean;
}

export interface RunAblationRequest {
  n_samples?: number;
  run_label?: string;
  /** Controlled ContractNLI pairs, or the real end-to-end pipeline over CUAD. */
  mode?: 'contractnli' | 'pipeline';
}

/**
 * Analysis and ablation are long-running jobs. Their POST returns a 202 receipt
 * immediately; the work continues in the background. These are not results.
 */
export interface AnalyzeQueued {
  queued: boolean;
  contract_id: string;
  verifier_enabled?: boolean | null;
  /** WebSocket path streaming this run's progress. */
  stream: string;
}

export interface AblationStarted {
  started: boolean;
  run_label: string;
  mode: string;
  n_samples: number;
}

export interface AblationStatus {
  running: boolean;
  progress: number;
  stage: string;
  error: string | null;
}

/* -------------------------------------------------------------- analytics */
/** One bucket of `DashboardStats.by_month`. */
export interface MonthBucket {
  month: string;
  [key: string]: string | number | null;
}

/** One point of `DashboardStats.verdict_scatter` — drives ObligationConstellation. */
export interface VerdictScatterPoint {
  id: string;
  title: string;
  verdict: Verdict;
  entailment: number;
  days_until_due: number | null;
  severity: Severity;
  [key: string]: unknown;
}

export interface DashboardStats {
  contracts: number;
  contracts_processed: number;
  clauses: number;
  candidate_clauses: number;
  obligations: number;
  auto_tracked: number;
  pending_review: number;
  approved: number;
  rejected: number;
  grounded: number;
  ungrounded: number;
  uncertain: number;
  hallucination_rate_blocked: number;
  mean_entailment: number;
  upcoming_30d: number;
  overdue: number;
  by_type: Record<string, number>;
  by_severity: Record<string, number>;
  by_month: MonthBucket[];
  verdict_scatter: VerdictScatterPoint[];
}

export interface AblationArm {
  arm: AblationArmName;
  n_samples: number;
  metrics: Record<string, number>;
}

export interface AblationReport {
  run_label: string;
  dataset: string;
  created_at: string;
  arms: AblationArm[];
  delta: Record<string, number>;
  notes: string | null;
}

export interface CalibrationPoint {
  threshold: number;
  precision: number;
  recall: number;
  f1: number;
  false_obligation_rate: number;
}

export interface CalibrationReport {
  /** The threshold currently in force. */
  threshold: number;
  curve: CalibrationPoint[];
}

/* -------------------------------------------------------------- calendar */
export interface CalendarDay {
  /** ISO date (YYYY-MM-DD). */
  date: string;
  items: ObligationOut[];
}

export interface CalendarResponse {
  days: CalendarDay[];
}

/* ----------------------------------------------------------------- health */
export interface HealthOut {
  status: HealthStatus;
  version: string;
  env: string;
  models_loaded: Record<string, boolean>;
  llm_agent: boolean;
  verifier_enabled: boolean;
  entailment_threshold: number;
  device: string;
  db_contracts: number;
}

/* -------------------------------------------------------- websocket event */
/** Note: shadows the DOM's global `ProgressEvent` — import it deliberately. */
export interface ProgressEvent {
  contract_id: string;
  stage: PipelineStage;
  message: string;
  pct: number;
  payload: JsonObject;
}

/* -------------------------------------------------- misc response shapes */
export interface SeedResponse {
  seeded: ContractSummary[];
}

export interface DeleteResponse {
  deleted: boolean;
}
