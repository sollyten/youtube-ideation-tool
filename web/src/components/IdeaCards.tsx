import { useState } from "react";
import type { ScoredIdea } from "../api";

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

export function IdeaCards({ ideas }: { ideas: ScoredIdea[] }) {
  return (
    <div className="stack">
      {ideas.map((idea, i) => (
        <IdeaCard idea={idea} rank={i + 1} key={idea.title + i} />
      ))}
    </div>
  );
}
