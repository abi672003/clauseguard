import { useEffect, useState } from "react";
import {
  fetchContract,
  fetchSampleContracts,
  verifyClaim,
  type Contract,
  type SampleContract,
  type VerifyResult,
} from "./api";
import AnnotatedDocument from "./components/AnnotatedDocument";
import ClausePanel from "./components/ClausePanel";
import "./app.css";

export default function App() {
  const [samples, setSamples] = useState<SampleContract[]>([]);
  const [contract, setContract] = useState<Contract | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [verifyResults, setVerifyResults] = useState<Record<number, VerifyResult>>({});
  const [verifying, setVerifying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSampleContracts(20).then(setSamples).catch((e) => setError(String(e)));
  }, []);

  async function openContract(id: string) {
    setLoading(true);
    setError(null);
    setSelectedIndex(null);
    setVerifyResults({});
    try {
      setContract(await fetchContract(id));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify(hypothesis: string) {
    if (selectedIndex === null || !contract) return;
    const clause = contract.clauses[selectedIndex];
    setVerifying(true);
    try {
      const result = await verifyClaim(clause.text, hypothesis);
      setVerifyResults((prev) => ({ ...prev, [selectedIndex]: result }));
    } catch (e) {
      setError(String(e));
    } finally {
      setVerifying(false);
    }
  }

  const selectedClause = selectedIndex !== null ? contract?.clauses[selectedIndex] ?? null : null;

  return (
    <div className="app-shell">
      <aside className="rail">
        <h1 className="rail-title">CLAUSEGUARD</h1>
        <p className="rail-sub">contract review</p>
        <div className="contract-list">
          {samples.map((s) => (
            <button
              key={s.id}
              className={`contract-item ${contract?.id === s.id ? "contract-item-active" : ""}`}
              onClick={() => openContract(s.id)}
            >
              <span className="contract-item-title mono">{s.title.slice(0, 42)}</span>
              <span className="contract-item-meta">{s.n_clauses} annotated clauses</span>
            </button>
          ))}
        </div>
      </aside>

      <main className="reading-pane">
        {!contract && !loading && <div className="empty-state">Select a contract from the rail</div>}
        {loading && <div className="empty-state">Loading contract…</div>}
        {error && <div className="empty-state error mono">{error}</div>}

        {contract && !loading && (
          <>
            <div className="doc-header">
              <h2 className="serif doc-title">{contract.title}</h2>
              <p className="doc-sub">
                Click a highlighted clause to inspect it and verify a claimed obligation against the
                exact cited text.
              </p>
            </div>
            <AnnotatedDocument
              text={contract.text}
              clauses={contract.clauses}
              selectedIndex={selectedIndex}
              onSelect={setSelectedIndex}
              verifyResults={verifyResults}
            />
          </>
        )}
      </main>

      {selectedClause && (
        <ClausePanel
          clause={selectedClause}
          result={selectedIndex !== null ? verifyResults[selectedIndex] : undefined}
          onVerify={handleVerify}
          verifying={verifying}
        />
      )}
    </div>
  );
}
