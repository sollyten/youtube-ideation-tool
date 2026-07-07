import { useEffect, useMemo, useState } from "react";
import { api, type ScoredIdea } from "../api";

/**
 * The optional post-ideation query (the "10-second ask"): a right-hand glass
 * sheet listing the run's ideas so the director can pick the best ones for the
 * channel and leave a comment. Saved feedback becomes per-profile training
 * signal — future generation (prompt 01) and scoring (prompt 02) receive the
 * picks, passes, and comments.
 *
 * Deliberately styled OPPOSITE to the page theme (glass-inverted): light glass
 * over the dark UI, dark glass over the light UI — visually separate from the
 * normal surface so it reads as a distinct, dismissible moment.
 */
export function FeedbackPanel({
  reportId,
  ideas,
  onDone,
}: {
  reportId: string;
  ideas: ScoredIdea[];
  onDone: () => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [comments, setComments] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [closing, setClosing] = useState(false);

  // Slide in on mount; slide out before unmounting.
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const t = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(t);
  }, []);

  const titles = useMemo(() => ideas.map((i) => i.title), [ideas]);

  const toggle = (title: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  };

  const dismiss = (after?: () => void) => {
    setClosing(true);
    setTimeout(() => {
      after?.();
      onDone();
    }, 260);
  };

  const skip = () => {
    localStorage.setItem(`feedback-skipped-${reportId}`, "1");
    dismiss();
  };

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await api.saveIdeaFeedback(reportId, [...picked], comments.trim());
      dismiss();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save feedback");
      setSaving(false);
    }
  };

  return (
    <aside
      className={`feedback-sheet glass-inverted ${entered && !closing ? "open" : ""}`}
      aria-label="Rate this idea run"
    >
      <div className="feedback-head">
        <span className="feedback-kicker">Quick question · optional</span>
        <h3>Which of these are the best fit for your channel?</h3>
        <p>
          Pick as many as you like. Your picks train future idea runs for this
          channel — the AI learns what you look for.
        </p>
      </div>

      <div className="feedback-list">
        {titles.map((title) => {
          const on = picked.has(title);
          return (
            <button
              key={title}
              type="button"
              className={`feedback-item ${on ? "picked" : ""}`}
              onClick={() => toggle(title)}
              aria-pressed={on}
            >
              <span className="feedback-check" aria-hidden>
                {on ? "✓" : ""}
              </span>
              <span className="feedback-title">{title}</span>
            </button>
          );
        })}
      </div>

      <div className="feedback-foot">
        <textarea
          className="feedback-comments"
          placeholder="Any comments? e.g. “more like #2 — love the mystery angle”"
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          rows={2}
        />
        {error && <p className="error">{error}</p>}
        <div className="row spread">
          <button className="feedback-skip" onClick={skip} disabled={saving}>
            Skip
          </button>
          <button
            className="feedback-save"
            onClick={save}
            disabled={saving || picked.size === 0}
          >
            {saving ? "Saving…" : `Save ${picked.size || ""} pick${picked.size === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </aside>
  );
}
