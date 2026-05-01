import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Heart, Home, LogOut, Search, Settings, Star, Tv } from "lucide-react";
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
  if (loading) return <div className="grid min-h-screen place-items-center text-sm text-slate-500">Loading SSTV IPTV...</div>;
  if (setupRequired) return <Navigate to="/setup" replace />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (admin && user.role !== "admin") return <Navigate to="/" replace />;
  return children;
}

function Shell({ children }: { children: React.ReactNode }) {
  const { user, logout, setupRequired } = useAuth();
  const navigate = useNavigate();
  const itemClass = "flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-medium text-slate-700 hover:bg-white";

  return (
    <div className="min-h-screen bg-mist text-ink">
      <header className="sticky top-0 z-20 border-b border-line bg-mist/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <Link to="/" className="flex items-center gap-2 text-base font-bold">
            <span className="grid size-9 place-items-center rounded-md bg-accent text-white"><Tv size={19} /></span>
            SSTV IPTV
          </Link>
          {user && !setupRequired && (
            <button
              className="grid size-10 place-items-center rounded-md text-slate-600 hover:bg-white"
              onClick={async () => {
                await logout();
                navigate("/login");
              }}
              title="Log out"
            >
              <LogOut size={19} />
            </button>
          )}
        </div>
      </header>
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-4 px-4 pb-24 pt-4 md:grid-cols-[210px_1fr] md:pb-6">
        {user && !setupRequired && (
          <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line bg-white px-2 py-2 md:sticky md:top-[73px] md:block md:h-fit md:rounded-md md:border md:p-2 md:shadow-soft">
            <Link className={itemClass} to="/"><Home size={18} /> <span>Guide</span></Link>
            <Link className={itemClass} to="/favorites"><Heart size={18} /> <span>Favorites</span></Link>
            <Link className={itemClass} to="/?focus=search"><Search size={18} /> <span>Search</span></Link>
            {user.role === "admin" ? (
              <Link className={itemClass} to="/admin"><Settings size={18} /> <span>Admin</span></Link>
            ) : (
              <span className={itemClass}><Star size={18} /> <span>{user.username}</span></span>
            )}
          </nav>
        )}
        <main>{children}</main>
      </div>
    </div>
  );
}

function App() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);

  return (
    <BrowserRouter>
      <AuthProvider>
        <Shell>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/setup" element={<SetupPage />} />
            <Route path="/" element={<Protected><HomePage /></Protected>} />
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
