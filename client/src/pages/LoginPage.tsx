import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { KeyRound, Shield, Tv } from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

export function LoginPage() {
  const { user, setupRequired, refreshUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [plexPin, setPlexPin] = useState<{ id: number; code: string; authUrl: string } | null>(null);
  const [checkingPlex, setCheckingPlex] = useState(false);
  const from = (location.state as { from?: string } | null)?.from ?? "/";

  useEffect(() => {
    if (setupRequired) navigate("/setup", { replace: true });
    if (user) navigate(from, { replace: true });
  }, [setupRequired, user, navigate, from]);

  const checkPlexPin = async () => {
    if (!plexPin || checkingPlex) return;
    setCheckingPlex(true);
    try {
      const result = await api.pollPlexPin(plexPin.id);
      if (!result.authenticated) return;
      setError("");
      await refreshUser();
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Plex login failed");
    } finally {
      setCheckingPlex(false);
    }
  };

  useEffect(() => {
    if (!plexPin) return;
    const timer = window.setInterval(() => {
      checkPlexPin().catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [plexPin, checkingPlex]);

  return (
    <div className="mx-auto grid max-w-5xl gap-4 md:grid-cols-[1fr_1fr]">
      <section className="rounded-md border border-line bg-panel p-5 shadow-soft">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-md bg-accent text-white"><Shield /></span>
          <div>
            <h1 className="text-2xl font-bold">Sign in</h1>
            <p className="text-sm text-ink/60">Admin uses local credentials. Viewers use Plex.</p>
          </div>
        </div>
        {error && <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}
        <form
          className="grid gap-3"
          onSubmit={async (event) => {
            event.preventDefault();
            setError("");
            try {
              await api.adminLogin(username, password);
              await refreshUser();
              navigate(from, { replace: true });
            } catch (err) {
              setError(err instanceof Error ? err.message : "Login failed");
            }
          }}
        >
          <label className="grid gap-1 text-sm font-medium">
            Username
            <input className="min-h-11 rounded-md border border-line px-3" value={username} onChange={(event) => setUsername(event.target.value)} />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Password
            <input className="min-h-11 rounded-md border border-line px-3" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          <button className="mt-2 flex min-h-11 items-center justify-center gap-2 rounded-md bg-accent px-4 font-semibold text-white">
            <KeyRound size={18} /> Admin login
          </button>
        </form>
      </section>

      <section className="rounded-md border border-line bg-panel p-5 shadow-soft">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-md bg-berry text-white"><Tv /></span>
          <div>
            <h2 className="text-2xl font-bold">Plex login</h2>
            <p className="text-sm text-ink/60">Access is checked against the configured server.</p>
          </div>
        </div>
        {plexPin ? (
          <div className="grid gap-4">
            <div className="rounded-md border border-line bg-mist p-4 text-center">
              <div className="text-sm text-ink/60">Plex code</div>
              <div className="mt-1 text-4xl font-bold tracking-normal">{plexPin.code}</div>
            </div>
            <a className="flex min-h-11 items-center justify-center rounded-md bg-accent px-4 font-semibold text-white" href={plexPin.authUrl} target="_blank" rel="noreferrer">
              Continue with Plex
            </a>
            <button
              className="flex min-h-11 items-center justify-center rounded-md border border-line bg-panel px-4 font-semibold text-ink hover:bg-ink/5 disabled:opacity-60"
              disabled={checkingPlex}
              onClick={() => checkPlexPin().catch(() => undefined)}
            >
              {checkingPlex ? "Checking Plex..." : "Check Plex login"}
            </button>
          </div>
        ) : (
          <button
            className="flex min-h-11 w-full items-center justify-center rounded-md bg-accent px-4 font-semibold text-white"
            onClick={async () => {
              setError("");
              try {
                setPlexPin(await api.createPlexPin());
              } catch (err) {
                setError(err instanceof Error ? err.message : "Could not start Plex login");
              }
            }}
          >
            Start Plex login
          </button>
        )}
      </section>
    </div>
  );
}
