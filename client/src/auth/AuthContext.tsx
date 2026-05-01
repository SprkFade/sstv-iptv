import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api, type User } from "../api/client";

interface AuthContextValue {
  user: User | null;
  setupRequired: boolean;
  loading: boolean;
  refreshUser: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("Auth context is missing");
  return context;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const [loading, setLoading] = useState(true);

  const refreshUser = async () => {
    const response = await api.me();
    setUser(response.user);
    setSetupRequired(response.setupRequired);
    setLoading(false);
  };

  useEffect(() => {
    refreshUser().catch(() => setLoading(false));
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    setupRequired,
    loading,
    refreshUser,
    logout: async () => {
      await api.logout();
      setUser(null);
    }
  }), [user, setupRequired, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
