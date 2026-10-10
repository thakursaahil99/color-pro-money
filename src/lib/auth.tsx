"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";

export interface User {
  id: number;
  username: string;
  mobile: string | null;
  role: "user" | "admin";
}

interface AuthState {
  user: User | null;
  balance: number;
  loading: boolean;
  refresh: () => Promise<void>;
  setBalance: (n: number) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await api<{ user: User; balance: number }>("/api/auth/me");
      setUser(me.user);
      setBalance(me.balance);
    } catch {
      setUser(null);
      setBalance(0);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    setUser(null);
    setBalance(0);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <AuthContext.Provider value={{ user, balance, loading, refresh, setBalance, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
