import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type ScoredIdea } from "../api";

const SUBSCORE_MAX: Record<string, number> = {
  focus: 35,
  format: 20,
  audience: 20,
  originality: 15,
  outlier: 10,
};

function IdeaCard({ idea, rank }: { idea: ScoredIdea; rank: number }) {
  const [open, setOpen] = useState(rank === 1);
  return (
    <div className="card clickable" onClick={() => setOpen((o) => !o)}>
      <div className="row spread">
        <div className="row" style={{ gap: 14 }}>
          <span className="score-ring">{Math.round(idea.alignment_score)}</span>
          <div>
            <strong>{idea.title}</strong>
            <p className="muted" style={{ margin: "2px 0 0" }}>{idea.premise}</p>
          </div>
        </div>
        <span className="muted">#{rank}</span>
      </div>
      {open && (
        <div style={{ marginTop: 16 }}>
          <div className="stack" style={{ gap: 6, marginBottom: 14 }}>
            {Object.entries(idea.subscores ?? {}).map(([key, value]) => (
              <div className="subscore" key={key}>
                <span>{key}</span>
                <span className="bar">
                  <i style={{ width: `${Math.min(100, (value / (SUBSCORE_MAX[key] ?? 100)) * 100)}%` }} />
                </span>
                <span>{value}</span>
              </div>
            ))}
          </div>
          <p style={{ margin: "0 0 8px" }}>
            <span className="muted">Why it fits:</span> {idea.why_it_fits}
          </p>
          <p style={{ margin: "0 0 8px" }}>
            <span className="muted">Why now:</span> {idea.why_now}
          </p>
          <p style={{ margin: 0 }}>
            <span className="muted">Format angle:</span> {idea.recommended_format_angle}
          </p>
        </div>
      )}
    </div>
  );
}

export function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const [report, setReport] = useState<{
    type: string;
    createdAt: string;
    profileId: string;
    payload: { ideas?: ScoredIdea[]; drop_note?: string; meta?: Record<string, unknown> };
  } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    api.getReport(id).then((r) => setReport(r.report)).catch((e) => setError(e.message));
  }, [id]);

  if (error) return <p className="error">{error}</p>;
  if (!report) {
    return (
      <p className="muted">
        <span className="spinner" /> Loading…
      </p>
    );
  }

  const ideas = report.payload.ideas ?? [];
  const meta = report.payload.meta ?? {};
  const fetchErrors = (meta.fetch_errors as string[]) ?? [];

  return (
    <div>
      <p className="muted">
        <Link to={`/channels/${report.profileId}`} style={{ textDecoration: "underline" }}>
          ← Back to channel
        </Link>
      </p>
      <h1>Idea run</h1>
      <p className="muted">
        {new Date(report.createdAt).toLocaleString()} · {String(meta.raw_candidate_count ?? "?")}{" "}
        researched → {ideas.length} selected
        {typeof meta.duplicates_dropped_pre_scoring === "number" &&
          Number(meta.duplicates_dropped_pre_scoring) > 0 && (
            <> · {String(meta.duplicates_dropped_pre_scoring)} repeats dropped</>
          )}
      </p>
      {fetchErrors.map((e) => (
        <p className="error" key={e}>{e}</p>
      ))}
      <div className="stack" style={{ marginTop: 20 }}>
        {ideas.map((idea, i) => (
          <IdeaCard idea={idea} rank={i + 1} key={idea.title} />
        ))}
      </div>
      {report.payload.drop_note && (
        <>
          <h2>Scorer's notes</h2>
          <p className="muted" style={{ whiteSpace: "pre-wrap" }}>{report.payload.drop_note}</p>
        </>
      )}
    </div>
  );
}
