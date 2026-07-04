import { useState } from "react";
import { api, ApiError, type User } from "../api";

/** No marketing page: sign in (or create an account) and go straight to work. */
export function Login({ onSignedIn }: { onSignedIn: (user: User) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result =
        mode === "login"
          ? await api.login({ email, password })
          : await api.register({ email, password, name });
      onSignedIn(result.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 380, margin: "12vh auto 0" }}>
      <div className="brand" style={{ marginBottom: 28 }}>
        <span className="brand-dot" />
        Creator Studio
      </div>
      <h1>{mode === "login" ? "Sign in" : "Create your account"}</h1>
      <p className="muted" style={{ marginBottom: 24 }}>
        Internal tool for Telos Media directors.
      </p>
      <form onSubmit={submit}>
        {mode === "register" && (
          <label className="field">
            <span>Name</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
        )}
        <label className="field">
          <span>Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary" disabled={busy} style={{ width: "100%" }}>
          {busy ? <span className="spinner" /> : mode === "login" ? "Sign in" : "Create account"}
        </button>
      </form>
      <p className="muted" style={{ marginTop: 18 }}>
        {mode === "login" ? (
          <>
            New here?{" "}
            <a href="#" onClick={(e) => (e.preventDefault(), setMode("register"))} style={{ textDecoration: "underline" }}>
              Create an account
            </a>
          </>
        ) : (
          <>
            Already registered?{" "}
            <a href="#" onClick={(e) => (e.preventDefault(), setMode("login"))} style={{ textDecoration: "underline" }}>
              Sign in
            </a>
          </>
        )}
      </p>
    </div>
  );
}
