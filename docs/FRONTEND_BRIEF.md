# ClauseGuard frontend brief

## Product framing
ClauseGuard is a **contract obligation monitor that refuses to trust itself**. Every
obligation it extracts is re-checked against the exact clause it came from by an
entailment model before it is tracked. The UI's whole job is to make that
verification step *visible and legible* — that is the product's differentiator and
the thing a buyer is paying for.

The tone is **forensic instrument**, not consumer SaaS. Think Bloomberg terminal
crossed with a scientific instrument: dense, precise, confident, dark. Never cute.

## Stack (fixed)
React 18 + TypeScript + Vite · TailwindCSS · react-router-dom v6 ·
@tanstack/react-query v5 · @react-three/fiber + @react-three/drei + three ·
framer-motion · recharts · lucide-react

## Design tokens (already in `src/index.css` as CSS vars — use them, do not invent colors)
| Token | Value | Use |
|---|---|---|
| `--bg` | `#06080F` | page ground |
| `--bg-elev` | `#0B1020` | panels |
| `--surface` | `rgba(255,255,255,0.04)` | glass cards |
| `--border` | `rgba(255,255,255,0.09)` | hairlines |
| `--text` | `#E6ECF5` | primary text |
| `--muted` | `#8A97AD` | secondary text |
| `--accent` | `#4F8CFF` | primary action / verification blue |
| `--grounded` | `#2DD4A7` | verdict: entailed ✓ |
| `--uncertain` | `#F5B544` | verdict: indecision band |
| `--ungrounded` | `#FF5A6E` | verdict: not entailed ✗ |
Tailwind exposes these as `bg-bg`, `text-muted`, `text-grounded`, `border-border`, etc.

Type: `Inter` for UI, `JetBrains Mono` for clause text, scores, and IDs. Numbers
that matter are monospace and tabular.

## Motion rules
- Everything eases `cubic-bezier(0.22, 1, 0.36, 1)`, 240–420ms.
- Page transitions: 12px rise + fade, staggered children at 40ms.
- 3D scenes idle-animate continuously but **slowly** (< 0.15 rad/s). Never distracting.
- Respect `prefers-reduced-motion`: drop to static renders.

## 3D scenes (react-three-fiber) — these are the signature
1. **VerificationCore** (landing hero) — a slowly rotating icosahedron wireframe
   "core". Clause shards (small planes with text-like ticks) orbit inward, pass
   through the core, and emerge tinted `--grounded`, `--uncertain` or `--ungrounded`.
   Instanced meshes; ~120 shards max; must hold 60fps on integrated graphics.
2. **ObligationConstellation** (dashboard) — 3D scatter, one point per obligation.
   x = entailment probability, y = days-until-due (log-ish), z = severity rank.
   Colored by verdict. Hover raycast → tooltip with title + score. Click → navigate
   to the obligation. Uses `<Points>`/instanced mesh, orbit controls damped.
3. **PipelineFlow** (live analysis) — 9 stage nodes on a gentle arc, connected by
   tubes. The active stage pulses; completed stages fill `--accent`; a packet
   travels the tube between stages. Driven by the WebSocket `ProgressEvent.stage`.
4. **ClauseLattice** (contract detail, optional) — clause blocks stacked in 3D,
   height = length, color = verdict of any obligation drawn from it.

Every 3D scene must: lazy-load via `React.lazy`, render inside `<Suspense>` with a
skeleton, cap `dpr={[1, 1.75]}`, and degrade to a static 2D fallback if WebGL is
unavailable.

## Screens
| Route | Purpose |
|---|---|
| `/` | Landing: VerificationCore hero, the 17–88% hallucination stat, the one-line claim, CTA into the app, live ablation delta pulled from the API |
| `/dashboard` | ObligationConstellation + KPI tiles + verdict split + due-date timeline + recent escalations |
| `/contracts` | Table of contracts, upload dropzone, "Load real CUAD contracts" seed button, per-row status + counts |
| `/contracts/:id` | Split view: contract text with highlighted clause spans (left) ↔ obligations list (right). Selecting an obligation scrolls+glows its source clause. Shows PipelineFlow when analysis is running. |
| `/obligations` | Filterable/sortable obligation register; filters for status, type, severity, verdict; due-date view |
| `/obligations/:id` | **The money screen.** Premise (clause, verbatim) vs Hypothesis (the claim) side by side, three-way entailment bar (entail/neutral/contradiction), threshold marker, verdict chip, agent rationale + risk flags, and the audit trail. |
| `/review` | Human-in-the-loop queue. Card per escalation showing clause, claim, entailment evidence, agent reasoning; Approve / Reject with notes. Optimistic update. |
| `/research` | The ablation. Verifier-ON vs verifier-OFF bar comparison of false-obligation rate, precision/recall/F1 table, calibration curve (threshold sweep), methodology note, "Run ablation" button. |

## Non-negotiables
- Nothing is mocked. Every number on screen comes from the API.
- Loading states everywhere (skeletons, not spinners where possible); explicit empty
  states that tell the user what to do ("No contracts yet — load the CUAD sample").
- Error boundaries per route; API failures surface a readable message, never a blank page.
- Responsive to 400px: 3D canvases shrink and grids collapse to one column.
- Accessible: focus rings, `aria-label`s on icon buttons, contrast ≥ 4.5:1 for text.
