/**
 * Typed fetch client for the ClauseGuard API (docs/API_CONTRACT.md, frozen).
 * Every component must go through this module — no bare fetch, no mock data.
 */
import type {
  AblationReport,
  AblationStarted,
  AblationStatus,
  AnalyzeRequest,
  AnalyzeQueued,
  CalibrationReport,
  CalendarResponse,
  ClauseOut,
  ContractDetail,
  ContractSummary,
  DashboardStats,
  DeleteResponse,
  HealthOut,
  ObligationDetail,
  ObligationStatus,
  Paginated,
  PipelineRunOut,
  ProgressEvent as PipelineProgressEvent,
  ReviewResolve,
  ReviewStats,
  ReviewTaskOut,
  RunAblationRequest,
  SeedRequest,
  SeedResponse,
  Severity,
  TextIngestRequest,
  Verdict,
} from '@/lib/types';

/** Base URL for every call. Vite proxies `/api` to the FastAPI dev server. */
export const API_BASE: string = import.meta.env.VITE_API_BASE ?? '/api/v1';

/* ------------------------------------------------------------------ error */
export class ApiError extends Error {
  readonly status: number;
  readonly detail: unknown;

  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
    // keep `instanceof ApiError` working when compiled down
    Object.setPrototypeOf(this, ApiError.prototype);
  }

  /** True when the failure is a network/CORS problem rather than an HTTP status. */
  get isNetworkError(): boolean {
    return this.status === 0;
  }
}

/* --------------------------------------------------------------- internals */
type QueryValue = string | number | boolean | null | undefined;

function withQuery(path: string, params?: Record<string, QueryValue>): string {
  if (!params) return `${API_BASE}${path}`;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.append(key, String(value));
  }
  const qs = search.toString();
  return qs ? `${API_BASE}${path}?${qs}` : `${API_BASE}${path}`;
}

async function readErrorMessage(response: Response): Promise<{ message: string; detail: unknown }> {
  const fallback = `${response.status} ${response.statusText || 'Request failed'}`;
  try {
    const text = await response.text();
    if (!text) return { message: fallback, detail: undefined };
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === 'object') {
        const detail = (parsed as { detail?: unknown }).detail;
        if (typeof detail === 'string' && detail.trim()) {
          return { message: detail, detail: parsed };
        }
        if (Array.isArray(detail) && detail.length > 0) {
          // FastAPI validation errors
          const first = detail[0] as { msg?: unknown };
          if (typeof first?.msg === 'string') return { message: first.msg, detail: parsed };
        }
        const message = (parsed as { message?: unknown }).message;
        if (typeof message === 'string' && message.trim()) {
          return { message, detail: parsed };
        }
      }
      return { message: fallback, detail: parsed };
    } catch {
      return { message: text.slice(0, 300), detail: text };
    }
  } catch {
    return { message: fallback, detail: undefined };
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init?.headers ?? {}),
      },
    });
  } catch (cause) {
    const message =
      cause instanceof Error ? cause.message : 'Network request failed';
    throw new ApiError(0, `Cannot reach the ClauseGuard API — ${message}`, cause);
  }

  if (!response.ok) {
    const { message, detail } = await readErrorMessage(response);
    throw new ApiError(response.status, message, detail);
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  if (!text) return undefined as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(response.status, 'API returned a malformed JSON body', text);
  }
}

function getJson<T>(path: string, params?: Record<string, QueryValue>): Promise<T> {
  return request<T>(withQuery(path, params));
}

function sendJson<T>(
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  return request<T>(`${API_BASE}${path}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/* ----------------------------------------------------------------- health */
export function getHealth(): Promise<HealthOut> {
  return getJson<HealthOut>('/health');
}

/* -------------------------------------------------------------- contracts */
export interface ListContractsParams {
  status?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

export function listContracts(
  params: ListContractsParams = {},
): Promise<Paginated<ContractSummary>> {
  const { status, q, limit = 50, offset = 0 } = params;
  return getJson<Paginated<ContractSummary>>('/contracts', { status, q, limit, offset });
}

export interface UploadContractOptions {
  analyze?: boolean;
  verifier_enabled?: boolean;
}

export function uploadContract(
  file: File,
  options: UploadContractOptions = {},
): Promise<ContractSummary> {
  const form = new FormData();
  form.append('file', file);
  if (options.analyze !== undefined) form.append('analyze', String(options.analyze));
  if (options.verifier_enabled !== undefined) {
    form.append('verifier_enabled', String(options.verifier_enabled));
  }
  // No Content-Type header: the browser sets the multipart boundary.
  return request<ContractSummary>(`${API_BASE}/contracts/upload`, {
    method: 'POST',
    body: form,
  });
}

export function ingestText(body: TextIngestRequest): Promise<ContractSummary> {
  return sendJson<ContractSummary>('POST', '/contracts/text', body);
}

/** Loads real CUAD contracts into the database. */
export function seedContracts(body: SeedRequest = {}): Promise<SeedResponse> {
  return sendJson<SeedResponse>('POST', '/contracts/seed', {
    limit: body.limit ?? 8,
    analyze: body.analyze ?? true,
  });
}

export function getContract(contractId: string): Promise<ContractDetail> {
  return getJson<ContractDetail>(`/contracts/${encodeURIComponent(contractId)}`);
}

export function deleteContract(contractId: string): Promise<DeleteResponse> {
  return sendJson<DeleteResponse>('DELETE', `/contracts/${encodeURIComponent(contractId)}`);
}

/** Queues analysis and returns immediately (202). Watch `openPipelineSocket`
 *  for progress, or poll `getContract` until status leaves "processing". */
export function analyzeContract(
  contractId: string,
  body: AnalyzeRequest = {},
): Promise<AnalyzeQueued> {
  return sendJson<AnalyzeQueued>(
    'POST',
    `/contracts/${encodeURIComponent(contractId)}/analyze`,
    body,
  );
}

export function getContractClauses(
  contractId: string,
  params: { candidates_only?: boolean } = {},
): Promise<ClauseOut[]> {
  return getJson<ClauseOut[]>(`/contracts/${encodeURIComponent(contractId)}/clauses`, {
    candidates_only: params.candidates_only,
  });
}

export function getContractRuns(contractId: string): Promise<PipelineRunOut[]> {
  return getJson<PipelineRunOut[]>(`/contracts/${encodeURIComponent(contractId)}/runs`);
}

/* ------------------------------------------------------------ obligations */
export interface ListObligationsParams {
  status?: ObligationStatus;
  type?: string;
  severity?: Severity;
  verdict?: Verdict;
  contract_id?: string;
  /** ISO date (YYYY-MM-DD). */
  due_before?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

export function listObligations(
  params: ListObligationsParams = {},
): Promise<Paginated<ObligationDetail>> {
  const { limit = 50, offset = 0, ...rest } = params;
  return getJson<Paginated<ObligationDetail>>('/obligations', { ...rest, limit, offset });
}

export function getObligation(obligationId: string): Promise<ObligationDetail> {
  return getJson<ObligationDetail>(`/obligations/${encodeURIComponent(obligationId)}`);
}

/** `from` / `to` are ISO dates (YYYY-MM-DD). */
export function getCalendar(
  params: { from?: string; to?: string } = {},
): Promise<CalendarResponse> {
  return getJson<CalendarResponse>('/obligations/calendar', {
    from: params.from,
    to: params.to,
  });
}

export function setObligationStatus(
  obligationId: string,
  status: ObligationStatus,
): Promise<ObligationDetail> {
  return sendJson<ObligationDetail>(
    'PATCH',
    `/obligations/${encodeURIComponent(obligationId)}/status`,
    { status },
  );
}

/* ----------------------------------------------------------------- review */
export interface ReviewQueueParams {
  state?: 'open' | 'approved' | 'rejected';
  limit?: number;
  offset?: number;
}

export function getReviewQueue(
  params: ReviewQueueParams = {},
): Promise<Paginated<ReviewTaskOut>> {
  const { state = 'open', limit = 25, offset = 0 } = params;
  return getJson<Paginated<ReviewTaskOut>>('/review/queue', { state, limit, offset });
}

export function resolveReview(taskId: string, body: ReviewResolve): Promise<ReviewTaskOut> {
  return sendJson<ReviewTaskOut>('POST', `/review/${encodeURIComponent(taskId)}/resolve`, {
    decision: body.decision,
    reviewer: body.reviewer ?? 'analyst',
    notes: body.notes ?? null,
  });
}

export function getReviewStats(): Promise<ReviewStats> {
  return getJson<ReviewStats>('/review/stats');
}

/* -------------------------------------------------------------- analytics */
export function getDashboard(): Promise<DashboardStats> {
  return getJson<DashboardStats>('/analytics/dashboard');
}

export function getAblation(): Promise<AblationReport[]> {
  return getJson<AblationReport[]>('/analytics/ablation');
}

/** Starts the ablation and returns immediately (202). The run takes minutes -
 *  poll `getAblationStatus`, then refetch `getAblation`. */
export function runAblation(body: RunAblationRequest = {}): Promise<AblationStarted> {
  return sendJson<AblationStarted>('POST', '/analytics/ablation/run', body);
}

export function getAblationStatus(): Promise<AblationStatus> {
  return getJson<AblationStatus>('/analytics/ablation/status');
}

export function getCalibration(): Promise<CalibrationReport> {
  return getJson<CalibrationReport>('/analytics/calibration');
}

/* ---------------------------------------------------------------- sockets */
/** Resolves the absolute ws:// or wss:// origin for the pipeline socket. */
function socketUrl(path: string): string {
  const absolute = /^https?:\/\//i.test(API_BASE);
  if (absolute) {
    return `${API_BASE.replace(/^http/i, 'ws')}${path}`;
  }
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${window.location.host}${API_BASE}${path}`;
}

export interface PipelineSocketHandlers {
  onOpen?: () => void;
  onClose?: (event: CloseEvent) => void;
  onError?: (event: Event) => void;
}

/**
 * Streams `ProgressEvent`s for one contract's analysis run.
 * The caller owns the socket and must `close()` it on unmount.
 */
export function openPipelineSocket(
  contractId: string,
  onEvent: (event: PipelineProgressEvent) => void,
  handlers: PipelineSocketHandlers = {},
): WebSocket {
  const socket = new WebSocket(socketUrl(`/ws/pipeline/${encodeURIComponent(contractId)}`));

  socket.onmessage = (message: MessageEvent<string>) => {
    try {
      onEvent(JSON.parse(message.data) as PipelineProgressEvent);
    } catch {
      // A frame we cannot parse is not worth tearing the stream down for.
    }
  };

  if (handlers.onOpen) socket.onopen = handlers.onOpen;
  if (handlers.onClose) socket.onclose = handlers.onClose;
  if (handlers.onError) socket.onerror = handlers.onError;

  return socket;
}
