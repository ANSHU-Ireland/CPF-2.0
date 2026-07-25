import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  api,
  hasSessionToken,
  setSessionToken,
  type LoginResponse,
  type Membership,
} from "./api.js";

interface AuthState {
  user: { id: string; displayName: string; email: string } | null;
  memberships: Membership[];
  authenticated: boolean;
  login: (email: string, password: string, totpCode?: string) => Promise<LoginResponse>;
  logout: () => Promise<void>;
  restore: () => Promise<boolean>;
}

const AuthContext = createContext<AuthState | null>(null);

const USER_KEY = "cpf.user";
const MEMBERSHIPS_KEY = "cpf.memberships";

export function AuthProvider({ children }: { children: ReactNode }): ReactNode {
  const [user, setUser] = useState<AuthState["user"]>(() => {
    const raw = sessionStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthState["user"]) : null;
  });
  const [memberships, setMemberships] = useState<Membership[]>(() => {
    const raw = sessionStorage.getItem(MEMBERSHIPS_KEY);
    return raw ? (JSON.parse(raw) as Membership[]) : [];
  });

  const login = useCallback(async (email: string, password: string, totpCode?: string) => {
    const response = await api.post<LoginResponse>("/v1/auth/login", {
      email,
      password,
      ...(totpCode ? { totpCode } : {}),
    });
    setSessionToken(response.token);
    sessionStorage.setItem(USER_KEY, JSON.stringify(response.user));
    sessionStorage.setItem(MEMBERSHIPS_KEY, JSON.stringify(response.memberships));
    setUser(response.user);
    setMemberships(response.memberships);
    return response;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post("/v1/auth/logout");
    } finally {
      setSessionToken(null);
      sessionStorage.removeItem(USER_KEY);
      sessionStorage.removeItem(MEMBERSHIPS_KEY);
      setUser(null);
      setMemberships([]);
    }
  }, []);

  /** Validate a restored token against the server (e.g. after a page reload). */
  const restore = useCallback(async () => {
    if (!hasSessionToken()) return false;
    try {
      const me = await api.get<{ user: AuthState["user"]; memberships: Membership[] }>(
        "/v1/auth/me",
      );
      setUser(me.user);
      setMemberships(me.memberships);
      return true;
    } catch {
      setSessionToken(null);
      setUser(null);
      setMemberships([]);
      return false;
    }
  }, []);

  const value = useMemo(
    () => ({ user, memberships, authenticated: user !== null, login, logout, restore }),
    [user, memberships, login, logout, restore],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
