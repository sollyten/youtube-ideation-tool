import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type IdeaFeedback, type ScoredIdea } from "../api";
import { IdeaCards } from "../components/IdeaCards";
import { FeedbackPanel } from "../components/FeedbackPanel";

/** Read-only view of any saved report (ideas | competitor | retention | performance). */
export function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const [report, setReport] = useState<{
    type: string;
    createdAt: string;
    profileId: string;
    payload: any;
  } | null>(null);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState<IdeaFeedback | null>(null);
  const [askFeedback, setAskFeedback] = useState(false);

  useEffect(() => {
    if (!id) return;
    setFeedback(null);
    setAskFeedback(false);
    api.getReport(id).then((r) => setReport(r.report)).catch((e) => setError(e.message));
  }, [id]);

  // For idea runs, offer the optional post-run query unless this director
  // already answered it (or explicitly skipped it) for this report.
  useEffect(() => {
    if (!id || !report || report.type !== "ideas") return;
    api
      .getIdeaFeedback(id)
      .then(({ feedback: fb, canRespond }) => {
        setFeedback(fb);
        const skipped = localStorage.getItem(`feedback-skipped-${id}`) === "1";
        setAskFeedback(canRespond && !fb && !skipped);
      })
      .catch(() => {});
  }, [id, report]);

  if (error) return <p className="error">{error}</p>;
  if (!report) return <p className="muted"><span className="spinner" /> Loading…</p>;

  const p = report.payload;

  return (
    <div>
      <p className="muted">
        <Link to={`/channels/${report.profileId}`} style={{ textDecoration: "underline" }}>
          ← Back to channel
        </Link>
      </p>
      <h1 style={{ textTransform: "capitalize" }}>{report.type} report</h1>
      <p className="muted">{new Date(report.createdAt).toLocaleString()}</p>

      {report.type === "ideas" && (
        <>
          {(p.meta?.fetch_errors ?? []).map((e: string) => (
            <p className="error" key={e}>{e}</p>
          ))}
          <p className="muted">
            {String(p.meta?.raw_candidate_count ?? "?")} researched → {(p.ideas ?? []).length} selected
            {p.meta?.source === "recombination" && " · from competitor recombination"}
          </p>
          {feedback && (
            <p className="muted">
              Your picks from this run:{" "}
              {feedback.selected.length
                ? feedback.selected.map((s) => `“${s.title}”`).join(", ")
                : "(none)"}
              {feedback.comments && ` — “${feedback.comments}”`}
            </p>
          )}
          <IdeaCards ideas={(p.ideas ?? []) as ScoredIdea[]} />
          {askFeedback && (
            <FeedbackPanel
              reportId={id!}
              ideas={(p.ideas ?? []) as ScoredIdea[]}
              onDone={() => {
                setAskFeedback(false);
                api.getIdeaFeedback(id!).then((r) => setFeedback(r.feedback)).catch(() => {});
              }}
            />
          )}
          {p.drop_note && (
            <>
              <h2>Scorer's notes</h2>
              <p className="muted" style={{ whiteSpace: "pre-wrap" }}>{p.drop_note}</p>
            </>
          )}
        </>
      )}

      {report.type === "competitor" && (
        <>
          <h2>Topic bank</h2>
          <div className="chips" style={{ marginBottom: 14 }}>
            {(p.analysis?.topic_bank ?? []).map((t: string) => <span className="chip" key={t}>{t}</span>)}
          </div>
          <h2>Format bank</h2>
          <div className="chips" style={{ marginBottom: 14 }}>
            {(p.analysis?.format_bank ?? []).map((f: string) => <span className="chip" key={f}>{f}</span>)}
          </div>
          <h2>Outlier breakdowns</h2>
          <div className="stack">
            {(p.analysis?.outlier_breakdowns ?? []).map((b: any, i: number) => (
              <div className="card" key={i}>
                <strong>{b.title}</strong> <span className="muted">· {b.channel} · {b.multiplier}x</span>
                <p style={{ margin: "6px 0" }}><span className="muted">{b.topic}</span> → <span className="muted">{b.format}</span></p>
                <p style={{ margin: 0 }}>{b.why_it_overperformed}</p>
              </div>
            ))}
          </div>
        </>
      )}

      {report.type === "retention" && p.analysis && (
        <>
          <div className="card" style={{ margin: "14px 0" }}>
            <div><span className="muted">Journey:</span> {p.analysis.overall?.journey_pattern}</div>
            <div><span className="muted">Top fix:</span> {p.analysis.overall?.top_level_fix}</div>
          </div>
          <h2>Next-video rules</h2>
          <div className="card stack">
            {(p.analysis.next_video_rules ?? []).map((r: string, i: number) => <div key={i}>• {r}</div>)}
          </div>
        </>
      )}

      {report.type === "performance" && (
        <>
          <h2>Videos</h2>
          <table className="table" style={{ marginBottom: 16 }}>
            <thead>
              <tr><th>Video</th><th>Views</th><th>Avg %</th><th>Rank</th></tr>
            </thead>
            <tbody>
              {(p.rows ?? []).map((r: any, i: number) => (
                <tr key={i}>
                  <td>{r.video}</td>
                  <td>{r.views?.toLocaleString() ?? "—"}</td>
                  <td>{r.averageViewPercentage ?? "—"}</td>
                  <td><span className="pill accent">{r.performance_rank ?? "—"}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          <h2>Learnings</h2>
          <div className="card stack">
            {(p.learnings ?? []).map((l: string, i: number) => <div key={i}>• {l}</div>)}
          </div>
        </>
      )}
    </div>
  );
}
