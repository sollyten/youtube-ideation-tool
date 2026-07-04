import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Link, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { api, type User } from "./api";
import { Login } from "./pages/Login";
import { Channels } from "./pages/Channels";
import { AddChannel } from "./pages/AddChannel";
import { ProfilePage } from "./pages/ProfilePage";
import { ReportPage } from "./pages/ReportPage";

interface AuthContextValue {
  user: User;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside provider");
  return ctx;
}

function ThemeToggle() {
  const [dark, setDark] = useState(document.documentElement.dataset.theme === "dark");
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? "dark" : "";
    localStorage.setItem("theme", next ? "dark" : "light");
  };
  return (
    <button className="theme-toggle" onClick={toggle} title="Toggle theme" aria-label="Toggle theme">
      {dark ? "☾" : "☀"}
    </button>
  );
}

function Shell({ user, onSignOut, children }: { user: User; onSignOut: () => void; children: React.ReactNode }) {
  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="brand-dot" />
          Creator Studio
        </Link>
        <div className="topbar-actions">
          <span>{user.name}</span>
          {user.role === "admin" && <span className="pill">admin</span>}
          <button className="btn btn-ghost" onClick={onSignOut}>
            Sign out
          </button>
          <ThemeToggle />
        </div>
      </header>
      {children}
    </div>
  );
}

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    api
      .me()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setChecking(false));
  }, []);

  const signOut = useCallback(async () => {
    await api.logout();
    setUser(null);
    navigate("/");
  }, [navigate]);

  if (checking) return null;

  if (!user) {
    return (
      <div className="shell">
        <Login onSignedIn={setUser} />
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ user, signOut }}>
      <Shell user={user} onSignOut={signOut}>
        <Routes>
          <Route path="/" element={<Channels />} />
          <Route path="/channels/new" element={<AddChannel />} />
          <Route path="/channels/:id" element={<ProfilePage />} />
          <Route path="/reports/:id" element={<ReportPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Shell>
    </AuthContext.Provider>
  );
}
