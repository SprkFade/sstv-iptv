import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Heart, Home, Layers3, LogOut, MonitorPlay, Moon, Settings, Star, Sun, Tv } from "lucide-react";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { ChannelPage } from "./pages/ChannelPage";
import { FavoritesPage } from "./pages/FavoritesPage";
import { AdminPage } from "./pages/AdminPage";
import { StreamsPage } from "./pages/StreamsPage";
import { GroupsPage } from "./pages/GroupsPage";
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
  const location = useLocation();
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    return window.localStorage.getItem("sstv-theme") === "light" ? "light" : "dark";
  });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navUser = user && !setupRequired ? user : null;
  const itemClass = "flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-medium text-ink/80 hover:bg-ink/5";
  const mobileItemClass = "flex min-h-12 items-center gap-3 rounded-md px-3 text-sm font-semibold text-ink hover:bg-ink/5";

  useEffect(() => {
    document.documentElement.classList.remove("dark", "light");
    document.documentElement.classList.add(theme);
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem("sstv-theme", theme);
  }, [theme]);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const renderNavLinks = (className: string, onClick?: () => void) => navUser ? (
    <>
      <Link className={className} to="/" onClick={onClick}><Home size={18} /> <span>Guide</span></Link>
      <Link className={className} to="/favorites" onClick={onClick}><Heart size={18} /> <span>Favorites</span></Link>
      {navUser.role === "admin" ? (
        <>
          <Link className={className} to="/streams" onClick={onClick}><MonitorPlay size={18} /> <span>Streams</span></Link>
          <Link className={className} to="/groups" onClick={onClick}><Layers3 size={18} /> <span>Groups</span></Link>
          <Link className={className} to="/admin" onClick={onClick}><Settings size={18} /> <span>Admin</span></Link>
        </>
      ) : (
        <span className={className}><Star size={18} /> <span>{navUser.username}</span></span>
      )}
    </>
  ) : null;
  const navLinks = renderNavLinks(itemClass);
  const mobileNavLinks = renderNavLinks(mobileItemClass, () => setMobileMenuOpen(false));

  return (
    <div className="min-h-screen bg-mist text-ink">
      <header className="app-header sticky-chrome z-[90] border-b border-line bg-mist/95 backdrop-blur">
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
          <div className="relative flex items-center gap-2">
            {navUser && (
              <button
                className="grid size-10 place-items-center rounded-md border border-line bg-panel text-ink hover:bg-ink/5 md:hidden"
                onClick={() => setMobileMenuOpen((current) => !current)}
                aria-expanded={mobileMenuOpen}
                aria-haspopup="menu"
                title="Open navigation menu"
              >
                <Settings size={19} />
              </button>
            )}
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
      {navUser && mobileMenuOpen && (
        <div className="fixed right-4 top-[4.25rem] z-[120] w-56 overflow-hidden rounded-md border border-line bg-panel p-2 shadow-soft md:hidden" role="menu">
          {mobileNavLinks}
        </div>
      )}
      <div className="app-shell mx-auto grid w-full max-w-7xl grid-cols-1 gap-4 px-4 pb-6 pt-4">
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
            <Route path="/groups" element={<Protected admin><GroupsPage /></Protected>} />
            <Route path="/admin" element={<Protected admin><AdminPage /></Protected>} />
          </Routes>
        </Shell>
      </AuthProvider>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
