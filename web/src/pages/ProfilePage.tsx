import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { api, ApiError, type Profile } from "../api";
import { IdeasTab } from "../tabs/IdeasTab";
import { CompetitorTab } from "../tabs/CompetitorTab";
import { PerformanceTab } from "../tabs/PerformanceTab";
import { RetentionTab } from "../tabs/RetentionTab";
import { ThumbnailTab } from "../tabs/ThumbnailTab";
import { DetailsTab } from "../tabs/DetailsTab";

type TabId = "ideas" | "competitor" | "performance" | "retention" | "thumbnails" | "details";
const TABS: Array<{ id: TabId; label: string }> = [
  { id: "ideas", label: "Ideas" },
  { id: "competitor", label: "Competitor" },
  { id: "performance", label: "Performance" },
  { id: "retention", label: "Retention Lab" },
  { id: "thumbnails", label: "Thumbnail Lab" },
  { id: "details", label: "Details" },
];

/** Channel page: profile facts + inline focus edit + a tab per feature. */
export function ProfilePage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<TabId>("ideas");
  const [connected, setConnected] = useState(false);
  const [editingFocus, setEditingFocus] = useState(false);
  const [focusDraft, setFocusDraft] = useState("");

  useEffect(() => {
    if (!id) return;
    api.getProfile(id).then((r) => setProfile(r.profile)).catch((e) => setError(e.message));
    api.connection(id).then((c) => setConnected(c.connected)).catch(() => {});
  }, [id]);

  // Land on the Performance tab after an OAuth round-trip.
  useEffect(() => {
    if (searchParams.get("youtube") === "connected") setTab("performance");
  }, [searchParams]);

  if (error) return <p className="error">{error}</p>;
  if (!profile) return <p className="muted"><span className="spinner" /> Loading…</p>;

  const d = profile.data;

  const saveFocus = async () => {
    try {
      const updated = await api.patchProfile(profile.id, { focus_statement: focusDraft });
      setProfile(updated.profile);
      setEditingFocus(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save focus");
    }
  };

  return (
    <div>
      <h1>{d.channel_name}</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        {d.stats?.subscriber_count?.toLocaleString()} subscribers · median{" "}
        {d.stats?.median_views?.toLocaleString()} views · {d.niche}
        {profile.readOnly && <> · <span className="pill">shared read-only</span></>}
      </p>

      <div className="card" style={{ marginBottom: 4 }}>
        <div className="row spread" style={{ marginBottom: 6 }}>
          <strong style={{ fontSize: 13 }}>Near-term focus</strong>
          {!profile.readOnly && !editingFocus && (
            <button
              className="btn btn-ghost"
              onClick={() => {
                setFocusDraft(d.focus?.statement ?? "");
                setEditingFocus(true);
              }}
            >
              Edit
            </button>
          )}
        </div>
        {editingFocus ? (
          <div className="stack">
            <textarea value={focusDraft} onChange={(e) => setFocusDraft(e.target.value)} autoFocus />
            <div className="row">
              <button className="btn btn-primary" onClick={saveFocus} disabled={!focusDraft.trim()}>Save</button>
              <button className="btn btn-ghost" onClick={() => setEditingFocus(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <p style={{ margin: 0 }}>{d.focus?.statement}</p>
        )}
      </div>

      <div className="tabs-bar">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab ${tab === t.id ? "active" : ""} ${t.id === "performance" && !connected ? "locked" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "ideas" && <IdeasTab profile={profile} />}
      {tab === "competitor" && <CompetitorTab profile={profile} />}
      {tab === "performance" && <PerformanceTab profile={profile} />}
      {tab === "retention" && <RetentionTab profile={profile} />}
      {tab === "thumbnails" && <ThumbnailTab slug={d.slug} readOnly={profile.readOnly} />}
      {tab === "details" && <DetailsTab profile={profile} onSaved={setProfile} />}
    </div>
  );
}
