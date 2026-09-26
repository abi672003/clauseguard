"""The CUAD clause taxonomy, mapped onto ClauseGuard's obligation model.

CUAD ships 41 expert-annotated categories. Five of them are document metadata
(who, when, which law) and enrich the contract header. The other 36 describe
duties, restrictions and dates - those become trackable obligations.

`claim_template` is the load-bearing field. It is the natural-language assertion
the pipeline will *claim* about the contract once it classifies a clause into
this category. The verifier's entire job is to decide whether the clause
actually entails that assertion - so the template has to state the duty plainly
and make no commitment the clause text could not support.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Category:
    name: str
    obligation_type: str
    severity: str
    claim_template: str
    keywords: tuple[str, ...] = ()
    is_obligation: bool = True


# ----------------------------------------------------------------- metadata
METADATA_CATEGORIES: dict[str, str] = {
    "Document Name": "title",
    "Parties": "parties",
    "Agreement Date": "agreement_date",
    "Effective Date": "effective_date",
    "Governing Law": "governing_law",
}

# --------------------------------------------------------------- obligations
_CATEGORIES: tuple[Category, ...] = (
    # ---- dates & lifecycle -------------------------------------------------
    Category("Expiration Date", "deadline", "high",
             "This agreement expires or terminates on a specified date or after a specified term.",
             ("expire", "expiration", "term of this agreement", "shall terminate on")),
    Category("Renewal Term", "renewal", "high",
             "This agreement renews for a further term after the initial term ends.",
             ("renew", "renewal", "successive", "extend for")),
    Category("Notice Period To Terminate Renewal", "renewal", "critical",
             "A party must give advance notice within a specified period to stop this "
             "agreement from renewing.",
             ("notice", "prior to", "days written notice", "unless either party")),
    Category("Termination For Convenience", "termination", "high",
             "A party may terminate this agreement for convenience, without cause.",
             ("terminate", "for convenience", "without cause", "upon notice")),
    Category("Post-Termination Services", "termination", "medium",
             "A party must continue to provide services after this agreement terminates.",
             ("after termination", "post-termination", "wind-down", "transition")),
    Category("Warranty Duration", "deadline", "medium",
             "A warranty given under this agreement lasts for a specified period.",
             ("warrant", "warranty period", "for a period of")),

    # ---- money -------------------------------------------------------------
    Category("Minimum Commitment", "payment", "high",
             "A party must meet a minimum purchase, order or payment commitment.",
             ("minimum", "at least", "shall purchase", "commitment")),
    Category("Revenue/Profit Sharing", "payment", "high",
             "A party must share revenue or profit with the counterparty.",
             ("revenue share", "profit", "percentage of", "royalt")),
    Category("Price Restrictions", "restriction", "medium",
             "A party is restricted in how it may change prices under this agreement.",
             ("price", "increase", "pricing", "shall not raise")),
    Category("Liquidated Damages", "liability", "high",
             "A party owes a pre-agreed sum as liquidated damages if it breaches.",
             ("liquidated damages", "penalty", "shall pay", "as damages")),
    Category("Cap On Liability", "liability", "high",
             "Liability under this agreement is capped at a specified amount.",
             ("shall not exceed", "aggregate liability", "limited to", "cap")),
    Category("Uncapped Liability", "liability", "critical",
             "A party's liability under this agreement is uncapped for certain claims.",
             ("unlimited", "no limitation", "shall not apply to")),

    # ---- ongoing duties ----------------------------------------------------
    Category("Audit Rights", "audit", "medium",
             "A party may audit or inspect the other party's records under this agreement.",
             ("audit", "inspect", "books and records", "upon reasonable notice")),
    Category("Insurance", "insurance", "high",
             "A party must maintain insurance coverage during the term of this agreement.",
             ("insurance", "coverage", "shall maintain", "policy")),
    Category("Change Of Control", "reporting", "high",
             "A change of control of a party triggers rights or obligations under this agreement.",
             ("change of control", "merger", "acquisition", "assign")),

    # ---- restrictive covenants --------------------------------------------
    Category("Non-Compete", "restriction", "critical",
             "A party is restricted from competing with the counterparty.",
             ("shall not compete", "non-compete", "competing business")),
    Category("Exclusivity", "restriction", "critical",
             "A party is bound by an exclusivity obligation under this agreement.",
             ("exclusive", "sole", "shall not engage")),
    Category("No-Solicit Of Customers", "restriction", "high",
             "A party is restricted from soliciting the counterparty's customers.",
             ("solicit", "customers", "shall not")),
    Category("No-Solicit Of Employees", "restriction", "high",
             "A party is restricted from soliciting or hiring the counterparty's employees.",
             ("solicit", "employees", "hire", "shall not")),
    Category("Non-Disparagement", "restriction", "medium",
             "A party is restricted from disparaging the counterparty.",
             ("disparage", "negative statement", "shall not")),
    Category("Competitive Restriction Exception", "restriction", "low",
             "An exception narrows a competitive restriction in this agreement.",
             ("except", "notwithstanding", "shall not apply")),
    Category("Most Favored Nation", "restriction", "high",
             "A party must offer terms at least as favourable as those given to others.",
             ("most favored", "no less favorable", "best price")),
    Category("Anti-Assignment", "restriction", "medium",
             "A party may not assign this agreement without the other party's consent.",
             ("assign", "consent", "shall not transfer")),
    Category("Rofr/Rofo/Rofn", "restriction", "medium",
             "A party holds a right of first refusal, offer or negotiation under this agreement.",
             ("right of first", "refusal", "first offer", "first negotiation")),
    Category("Volume Restriction", "restriction", "medium",
             "A party is subject to a volume or quantity restriction.",
             ("volume", "quantity", "shall not exceed", "maximum")),
    Category("Covenant Not To Sue", "restriction", "medium",
             "A party covenants not to sue the counterparty.",
             ("covenant not to sue", "shall not bring", "waive")),

    # ---- intellectual property --------------------------------------------
    Category("Ip Ownership Assignment", "ip", "high",
             "Intellectual property is assigned between the parties under this agreement.",
             ("assign", "ownership", "all right, title")),
    Category("Joint Ip Ownership", "ip", "medium",
             "Intellectual property is jointly owned by the parties under this agreement.",
             ("jointly own", "joint ownership", "co-own")),
    Category("License Grant", "ip", "high",
             "A party grants the other a licence under this agreement.",
             ("grant", "license", "hereby grants")),
    Category("Non-Transferable License", "ip", "medium",
             "A licence granted under this agreement is non-transferable.",
             ("non-transferable", "may not sublicense", "personal to")),
    Category("Affiliate License-Licensor", "ip", "low",
             "The licensor's affiliates are covered by a licence under this agreement.",
             ("affiliate", "licensor", "license")),
    Category("Affiliate License-Licensee", "ip", "low",
             "The licensee's affiliates are covered by a licence under this agreement.",
             ("affiliate", "licensee", "license")),
    Category("Unlimited/All-You-Can-Eat-License", "ip", "medium",
             "A licence granted under this agreement is unlimited in scope or volume.",
             ("unlimited", "all-you-can-eat", "without restriction")),
    Category("Irrevocable Or Perpetual License", "ip", "medium",
             "A licence granted under this agreement is irrevocable or perpetual.",
             ("irrevocable", "perpetual", "in perpetuity")),
    Category("Source Code Escrow", "ip", "medium",
             "Source code must be placed into escrow under this agreement.",
             ("escrow", "source code", "deposit")),

    # ---- misc --------------------------------------------------------------
    Category("Third Party Beneficiary", "other", "low",
             "A third party has enforceable rights under this agreement.",
             ("third party beneficiary", "for the benefit of")),
)

CATEGORIES: dict[str, Category] = {c.name: c for c in _CATEGORIES}
OBLIGATION_CATEGORY_NAMES: tuple[str, ...] = tuple(CATEGORIES)
ALL_CUAD_CATEGORIES: tuple[str, ...] = OBLIGATION_CATEGORY_NAMES + tuple(METADATA_CATEGORIES)

OBLIGATION_TYPES: tuple[str, ...] = (
    "deadline", "renewal", "termination", "payment", "reporting",
    "restriction", "liability", "ip", "audit", "insurance", "other",
)

SEVERITY_RANK: dict[str, int] = {"low": 0, "medium": 1, "high": 2, "critical": 3}


def category_for(name: str | None) -> Category | None:
    return CATEGORIES.get(name) if name else None


def is_metadata(name: str) -> bool:
    return name in METADATA_CATEGORIES


def normalise_cuad_question_id(qid: str) -> str:
    """CUAD ids look like '<TITLE>__<Category>'."""
    return qid.rsplit("__", 1)[-1].strip()
