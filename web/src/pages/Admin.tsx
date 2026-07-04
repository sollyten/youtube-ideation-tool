import { useEffect, useState } from "react";
import { api } from "../api";

/** Admin: company-credential status (booleans only) + per-user usage. */
export function Admin() {
  const [credentials, setCredentials] = useState<Record<string, boolean> | null>(null);
  const [usage, setUsage] = useState<Array<{ email: string; name: string; action: string; runs: number; last_run: string }>>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api.adminCredentials().then((r) => setCredentials(r.credentials)).catch((e) => setError(e.message));
    api.adminUsage().then((r) => setUsage(r.usage)).catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      <h1>Admin</h1>
      {error && <p className="error">{error}</p>}

      <h2>Company credentials</h2>
      <div className="card stack">
        {credentials ? (
          Object.entries(credentials).map(([service, ok]) => (
            <div className="row spread" key={service}>
              <span style={{ textTransform: "capitalize" }}>{service}</span>
              <span className={`pill ${ok ? "accent" : ""}`}>{ok ? "configured" : "missing"}</span>
            </div>
          ))
        ) : (
          <span className="muted">Loading…</span>
        )}
      </div>

      <h2>Usage (last 30 days)</h2>
      {usage.length === 0 ? (
        <p className="muted">No usage recorded yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Director</th>
              <th>Action</th>
              <th>Runs</th>
              <th>Last run</th>
            </tr>
          </thead>
          <tbody>
            {usage.map((u, i) => (
              <tr key={i}>
                <td>{u.name}<div className="muted" style={{ fontSize: 12 }}>{u.email}</div></td>
                <td>{u.action.replace(/_/g, " ")}</td>
                <td>{u.runs}</td>
                <td className="muted">{new Date(u.last_run).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
