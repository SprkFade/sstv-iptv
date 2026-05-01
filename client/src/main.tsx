import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Heart, LogOut, Moon, Search, Settings, Star, Sun, Tv } from "lucide-react";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { ChannelPage } from "./pages/ChannelPage";
import { FavoritesPage } from "./pages/FavoritesPage";
import { AdminPage } from "./pages/AdminPage";
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
  const navUser = user && !setupRequired ? user : null;
  const navItems = [
    { to: "/", label: "Guide", icon: Tv, match: location.pathname === "/" },
    { to: "/favorites", label: "Favorites", icon: Heart, match: location.pathname === "/favorites" },
    { to: "/?focus=search", label: "Search", icon: Search, match: location.search.includes("focus=search") },
    ...(navUser?.role === "admin" ? [{ to: "/admin", label: "Admin", icon: Settings, match: location.pathname === "/admin" }] : [])
  ];
  const itemClass = (active: boolean) =>
    `flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition ${
      active ? "bg-accent text-white shadow-sm" : "text-ink/70 hover:bg-ink/5 hover:text-ink"
    }`;

  useEffect(() => {
    document.documentElement.classList.remove("dark", "light");
    document.documentElement.classList.add(theme);
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem("sstv-theme", theme);
  }, [theme]);

  if (!navUser) {
    return <div className="min-h-screen bg-mist text-ink">{children}</div>;
  }

  return (
    <div className="min-h-screen bg-mist text-ink">
      <div className="grid min-h-screen grid-cols-1 md:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-panel/95 px-2 py-2 backdrop-blur md:sticky md:inset-y-0 md:top-0 md:flex md:h-screen md:flex-col md:border-r md:border-t-0 md:px-3 md:py-4">
          <Link to="/" className="mb-6 hidden items-center gap-2 px-2 text-base font-bold md:flex">
            <span className="grid size-8 place-items-center rounded-md border border-accent/40 bg-accent/15 text-accent">
              <Tv size={18} strokeWidth={2.2} />
            </span>
            SSTV IPTV
          </Link>
          <nav className="grid grid-cols-4 gap-1 md:block md:space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <Link key={item.label} className={itemClass(item.match)} to={item.to}>
                  <Icon size={18} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
            {navUser.role !== "admin" && (
              <span className={itemClass(false)}><Star size={18} /> <span>{navUser.username}</span></span>
            )}
          </nav>
          <div className="mt-auto hidden space-y-2 md:block">
            <button
              className="flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-sm font-medium text-ink/70 hover:bg-ink/5 hover:text-ink"
              onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
              {theme === "dark" ? "Light mode" : "Dark mode"}
            </button>
            <button
              className="flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-sm font-medium text-ink/70 hover:bg-ink/5 hover:text-ink"
              onClick={async () => {
                await logout();
                navigate("/");
              }}
            >
              <LogOut size={18} />
              Logout
            </button>
          </div>
        </aside>
        <main className="min-w-0 px-3 py-3 pb-24 md:px-5 md:py-5 md:pb-5">{children}</main>
      </div>
    </div>
  );
}

function App() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
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
            <Route path="/admin" element={<Protected admin><AdminPage /></Protected>} />
          </Routes>
        </Shell>
      </AuthProvider>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
