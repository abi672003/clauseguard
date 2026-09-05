"""Agentic decision loop: auto-track a claimed obligation only if
verification confidence clears a threshold; otherwise escalate to a human
reviewer with the clause, the claim, and the verifier's reasoning shown.

Brief says "GPT-4o-mini or Claude Haiku 4.5, pick one and be consistent" —
uses Claude Haiku 4.5, matching EchoTrace's agent layer.

The agent doesn't second-guess the verifier's label — it can only decide
auto_track or escalate_to_human, and must write a human-readable reason
citing the actual verification numbers, never inventing new ones.
"""

import json
import os
from pathlib import Path

from anthropic import Anthropic
from dotenv import load_dotenv

from clauseguard.extraction.deadline_mapping import ObligationRecord
from clauseguard.verification.verifier import verify

load_dotenv(Path(__file__).resolve().parents[3] / ".env")

MODEL = "claude-haiku-4-5-20251001"
CONFIDENCE_THRESHOLD = 0.5

SYSTEM_PROMPT = """You are ClauseGuard's tracking-decision agent. An obligation has been \
extracted from a contract clause and checked by an entailment verifier \
against the specific clause text it was derived from. You decide whether \
to auto-track this obligation or escalate it to a human reviewer.

Rules:
- Only auto-track if the verifier's label is "Entailment" with confidence \
at or above {threshold}.
- Otherwise, escalate — show the clause, the claimed obligation, and the \
verifier's actual label/confidence/probabilities in your reasoning.
- Never state a confidence or label other than the one you were given.
""".format(threshold=CONFIDENCE_THRESHOLD)

TOOLS = [
    {
        "name": "auto_track_obligation",
        "description": "Auto-track this obligation because verification confirmed it's genuinely entailed by the cited clause.",
        "input_schema": {
            "type": "object",
            "properties": {"reasoning": {"type": "string"}},
            "required": ["reasoning"],
        },
    },
    {
        "name": "escalate_to_human",
        "description": "Escalate to human review because verification did not confirm this obligation is grounded in the cited clause.",
        "input_schema": {
            "type": "object",
            "properties": {"reasoning": {"type": "string"}},
            "required": ["reasoning"],
        },
    },
]


def decide(obligation: ObligationRecord, hypothesis_text: str) -> dict:
    """hypothesis_text: the claimed-obligation statement in plain English
    (e.g. "This contract must be renewed no later than 30 days before
    expiration."), verified against obligation.source_text as the premise."""
    verification = verify(premise=obligation.source_text, hypothesis=hypothesis_text)
    obligation.verification = verification

    client = Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
    messages = [
        {
            "role": "user",
            "content": (
                f"Cited clause: {obligation.source_text!r}\n"
                f"Claimed obligation: {hypothesis_text!r}\n"
                f"Verification result: {json.dumps(verification, indent=2)}"
            ),
        }
    ]

    response = client.messages.create(
        model=MODEL,
        max_tokens=512,
        system=SYSTEM_PROMPT,
        tools=TOOLS,
        messages=messages,
    )

    tool_use = next((b for b in response.content if b.type == "tool_use"), None)
    if tool_use is None:
        obligation.tracked = False
        obligation.escalation_reason = "agent did not submit a structured decision"
        return {"decision": "escalated", "reasoning": obligation.escalation_reason, "verification": verification}

    if tool_use.name == "auto_track_obligation":
        obligation.tracked = True
        return {"decision": "auto_tracked", **tool_use.input, "verification": verification}

    obligation.tracked = False
    obligation.escalation_reason = tool_use.input.get("reasoning")
    return {"decision": "escalated", **tool_use.input, "verification": verification}
