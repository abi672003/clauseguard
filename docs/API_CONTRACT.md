# ClauseGuard API contract (frozen)

Base URL: `/api/v1`. All responses JSON. Source of truth: `backend/app/schemas.py`.

## Health
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/health` | — | `HealthOut` |

## Contracts
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/contracts` | query: `status,q,limit=50,offset=0` | `{items: ContractSummary[], total: number}` |
| POST | `/contracts/upload` | multipart `file` (+ `analyze=true`, `verifier_enabled`) | `ContractSummary` |
| POST | `/contracts/text` | `TextIngestRequest` | `ContractSummary` |
| POST | `/contracts/seed` | `SeedRequest` `{limit, analyze}` | `{seeded: ContractSummary[]}` — loads real CUAD contracts |
| GET | `/contracts/{id}` | — | `ContractDetail` |
| DELETE | `/contracts/{id}` | — | `{deleted: true}` |
| POST | `/contracts/{id}/analyze` | `AnalyzeRequest` | `PipelineRunOut` |
| GET | `/contracts/{id}/clauses` | query: `candidates_only` | `ClauseOut[]` |
| GET | `/contracts/{id}/runs` | — | `PipelineRunOut[]` |

## Obligations
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/obligations` | query: `status,type,severity,verdict,contract_id,due_before,q,limit,offset` | `{items: ObligationDetail[], total: number}` |
| GET | `/obligations/{id}` | — | `ObligationDetail` |
| GET | `/obligations/calendar` | query: `from,to` (ISO dates) | `{days: [{date, items: ObligationOut[]}]}` |
| PATCH | `/obligations/{id}/status` | `{status: ObligationStatus}` | `ObligationDetail` |

## Review queue (human-in-the-loop)
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/review/queue` | query: `state=open,limit,offset` | `{items: ReviewTaskOut[], total: number}` |
| POST | `/review/{task_id}/resolve` | `ReviewResolve` | `ReviewTaskOut` |
| GET | `/review/stats` | — | `{open, approved, rejected, mean_age_hours}` |

## Analytics & research
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/analytics/dashboard` | — | `DashboardStats` |
| GET | `/analytics/ablation` | — | `AblationReport[]` |
| POST | `/analytics/ablation/run` | `{n_samples?, run_label?}` | `AblationReport` |
| GET | `/analytics/calibration` | — | `{threshold, curve: [{threshold, precision, recall, f1, false_obligation_rate}]}` |

## WebSocket
`WS /api/v1/ws/pipeline/{contract_id}` streams `ProgressEvent`:
```json
{"contract_id":"ab12","stage":"verify","message":"Verifying 18 claims","pct":0.72,"payload":{}}
```
Stages, in order: `queued, ingest, segment, prefilter, extract, deadline, verify, agent, persist, complete` (or `failed`).

## Key enums
- `Verdict` = `grounded | ungrounded | uncertain`
- `AgentAction` = `auto_track | escalate | reject`
- `ObligationStatus` = `auto_tracked | pending_review | approved | rejected | expired`
- `severity` = `low | medium | high | critical`
- `obligation_type` = `deadline | renewal | termination | payment | reporting | restriction | liability | ip | audit | insurance | other`
