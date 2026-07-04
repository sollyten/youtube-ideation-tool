import { useEffect, useState } from "react";
import { api, ApiError, type Profile, type ScoredIdea } from "../api";
import { IdeaCards } from "../components/IdeaCards";

interface OutlierBreakdown {
  channel: string;
  title: string;
  url: string;
  multiplier: number;
  topic: string;
  format: string;
  thumbnail: string;
  why_it_overperformed: string;
  transcript_accessed: boolean;
}

/** Deep Competitor Analysis + the "generate ideas from these outliers" CTA. */
export function CompetitorTab({ profile }: { profile: Profile }) {
  const [reportId, setReportId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [recombBusy, setRecombBusy] = useState(false);
  const [recombIdeas, setRecombIdeas] = useState<ScoredIdea[] | null>(null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);

  // Load the latest competitor report if one exists.
  useEffect(() => {
    api
      .listReports({ profileId: profile.id, type: "competitor" })
      .then(async (r) => {
        if (r.reports[0]) {
          const full = await api.getReport(r.reports[0].id);
          setReportId(full.report.id);
          setAnalysis((full.report.payload as any).analysis);
        }
      })
      .catch(() => {});
  }, [profile.id]);

  const run = async () => {
    setBusy(true);
    setError("");
    setRecombIdeas(null);
    try {
      const result = await api.competitorAnalysis(profile.id);
      setReportId(result.reportId);
      setAnalysis(result.analysis);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Analysis failed");
    } finally {
      setBusy(false);
    }
  };

  const recombine = async () => {
    if (!reportId) return;
    setRecombBusy(true);
    setError("");
    try {
      const result = await api.recombine(profile.id, reportId);
      setRecombIdeas(result.ideas);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Recombination failed");
    } finally {
      setRecombBusy(false);
    }
  };

  const breakdowns: OutlierBreakdown[] = analysis?.outlier_breakdowns ?? [];

  return (
    <div>
      <div className="row spread" style={{ marginBottom: 12 }}>
        <p className="muted" style={{ margin: 0 }}>
          Decompose competitor outliers into reusable topics and formats.
        </p>
        {!profile.readOnly && (
          <button className="btn btn-primary" onClick={run} disabled={busy}>
            {busy ? (
              <>
                <span className="spinner" /> Analyzing…
              </>
            ) : analysis ? (
              "Re-run analysis"
            ) : (
              "Run competitor analysis"
            )}
          </button>
        )}
      </div>
      {busy && (
        <p className="muted">Deep research via Perplexity — reading thumbnails and transcripts. A few minutes.</p>
      )}
      {error && <p className="error">{error}</p>}

      {!analysis && !busy && <p className="muted">No competitor report yet.</p>}

      {analysis && (
        <>
          <table className="table" style={{ marginBottom: 20 }}>
            <thead>
              <tr>
                <th>Title</th>
                <th>Mult.</th>
                <th>Topic</th>
                <th>Format</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {breakdowns.map((b, i) => (
                <>
                  <tr key={i} className="clickable" onClick={() => setExpanded(expanded === i ? null : i)} style={{ cursor: "pointer" }}>
                    <td>
                      <a href={b.url} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }} onClick={(e) => e.stopPropagation()}>
                        {b.title}
                      </a>
                      <div className="muted" style={{ fontSize: 12 }}>{b.channel}</div>
                    </td>
                    <td>{b.multiplier}x</td>
                    <td>{b.topic}</td>
                    <td>{b.format}</td>
                    <td className="muted">{expanded === i ? "▲" : "▼"}</td>
                  </tr>
                  {expanded === i && (
                    <tr>
                      <td colSpan={5} style={{ background: "var(--bg)" }}>
                        <p style={{ margin: "0 0 8px" }}>
                          <span className="muted">Thumbnail:</span> {b.thumbnail}
                        </p>
                        <p style={{ margin: 0 }}>
                          <span className="muted">Why it over-performed{b.transcript_accessed ? "" : " (inferred)"}:</span>{" "}
                          {b.why_it_overperformed}
                        </p>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>

          <h2>Topic bank</h2>
          <div className="chips" style={{ marginBottom: 16 }}>
            {(analysis.topic_bank ?? []).map((t: string) => (
              <span className="chip" key={t}>{t}</span>
            ))}
          </div>
          <h2>Format bank</h2>
          <div className="chips" style={{ marginBottom: 20 }}>
            {(analysis.format_bank ?? []).map((f: string) => (
              <span className="chip" key={f}>{f}</span>
            ))}
          </div>

          {!profile.readOnly && (
            <button className="btn btn-primary" onClick={recombine} disabled={recombBusy}>
              {recombBusy ? (
                <>
                  <span className="spinner" /> Generating…
                </>
              ) : (
                "Generate ideas from these outliers"
              )}
            </button>
          )}

          {recombIdeas && (
            <>
              <h2>Recombined ideas</h2>
              <IdeaCards ideas={recombIdeas} />
            </>
          )}
        </>
      )}
    </div>
  );
}
