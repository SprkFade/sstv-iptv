import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Heart, Home, LogOut, MonitorPlay, Moon, Settings, Star, Sun, Tv } from "lucide-react";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { ChannelPage } from "./pages/ChannelPage";
import { FavoritesPage } from "./pages/FavoritesPage";
import { AdminPage } from "./pages/AdminPage";
import { StreamsPage } from "./pages/StreamsPage";
import { SetupPage } from "./pages/SetupPage";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import "./styles/index.css";

function Protected({ children, admin = false }: { children: React.ReactNode; admin?: boolean }) {
  const { user, setupRequired, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="grid min-h-screen place-items-center bg-mist text-sm text-ink/60">Loading SSTV IPTV...</div>;
  if (setupRequired) return <Navigate to="/setup" replace />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (admin && user.role !== "admin") return <Navigate to="/" replace />;
  return children;
}

function RootPage() {
  const { user, setupRequired, loading } = useAuth();
  if (loading) return <LoginPage />;
  if (setupRequired) return <Navigate to="/setup" replace />;
  if (!user) return <LoginPage />;
  return <HomePage />;
}

function Shell({ children }: { children: React.ReactNode }) {
  const { user, logout, setupRequired } = useAuth();
  const navigate = useNavigate();
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    return window.localStorage.getItem("sstv-theme") === "light" ? "light" : "dark";
  });
  const navUser = user && !setupRequired ? user : null;
  const itemClass = "flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-medium text-ink/80 hover:bg-ink/5";

  useEffect(() => {
    document.documentElement.classList.remove("dark", "light");
    document.documentElement.classList.add(theme);
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem("sstv-theme", theme);
  }, [theme]);

  const navLinks = navUser ? (
    <>
      <Link className={itemClass} to="/"><Home size={18} /> <span>Guide</span></Link>
      <Link className={itemClass} to="/favorites"><Heart size={18} /> <span>Favorites</span></Link>
      {navUser.role === "admin" ? (
        <>
          <Link className={itemClass} to="/streams"><MonitorPlay size={18} /> <span>Streams</span></Link>
          <Link className={itemClass} to="/admin"><Settings size={18} /> <span>Admin</span></Link>
        </>
      ) : (
        <span className={itemClass}><Star size={18} /> <span>{navUser.username}</span></span>
      )}
    </>
  ) : null;

  return (
    <div className="min-h-screen bg-mist text-ink">
      <header className="app-header sticky-chrome z-40 border-b border-line bg-mist/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex min-w-0 items-center gap-4">
            <Link to="/" className="flex shrink-0 items-center gap-2 text-base font-bold">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent text-white">
                <Tv size={19} strokeWidth={2.2} className="block" />
              </span>
              SSTV IPTV
            </Link>
            {navUser && (
              <nav className="hidden items-center gap-1 md:flex">
                {navLinks}
              </nav>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              className="grid size-10 place-items-center rounded-md border border-line bg-panel text-ink hover:bg-ink/5"
              onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
            </button>
            {navUser && (
            <button
              className="grid size-10 place-items-center rounded-md border border-line bg-panel text-ink hover:bg-ink/5"
              onClick={async () => {
                await logout();
                navigate("/");
              }}
              title="Log out"
            >
              <LogOut size={19} />
            </button>
            )}
          </div>
        </div>
      </header>
      <div className={`app-shell mx-auto grid w-full max-w-7xl grid-cols-1 gap-4 px-4 pt-4 ${navUser ? "pb-24 md:pb-6" : "pb-6"}`}>
        {navUser && (
          <nav className={`sticky-chrome fixed inset-x-0 bottom-0 z-30 grid border-t border-line bg-panel px-2 py-2 md:hidden ${navUser.role === "admin" ? "grid-cols-4" : "grid-cols-3"}`}>
            {navLinks}
          </nav>
        )}
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}

function App() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });
      navigator.serviceWorker.register("/sw.js")
        .then((registration) => registration.update())
        .catch(() => undefined);
    }
  }, []);

  return (
    <BrowserRouter>
      <AuthProvider>
        <Shell>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/setup" element={<SetupPage />} />
            <Route path="/" element={<RootPage />} />
            <Route path="/channel/:id" element={<Protected><ChannelPage /></Protected>} />
            <Route path="/favorites" element={<Protected><FavoritesPage /></Protected>} />
            <Route path="/streams" element={<Protected admin><StreamsPage /></Protected>} />
            <Route path="/admin" element={<Protected admin><AdminPage /></Protected>} />
          </Routes>
        </Shell>
      </AuthProvider>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
