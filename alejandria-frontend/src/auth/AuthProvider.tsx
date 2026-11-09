import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { endpoints } from "@/api/endpoints";
import type { LoginInput, RegisterInput, User } from "@/api/types";
import {
  clearToken,
  getToken,
  SESSION_EXPIRED_EVENT,
  setToken,
  takeFlash,
} from "./session";

interface AuthContextValue {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (input: LoginInput) => Promise<User>;
  register: (input: RegisterInput) => Promise<User>;
  logout: () => void;
  flash: string | null;
  clearFlash: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [token, setTokenState] = useState<string | null>(() => getToken());
  const [flash, setFlashState] = useState<string | null>(() => takeFlash());

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => endpoints.auth.me(),
    enabled: Boolean(token),
    retry: false,
    staleTime: 60_000,
  });

  useEffect(() => {
    const onExpired = () => {
      setTokenState(null);
      queryClient.removeQueries({ queryKey: ["me"] });
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [queryClient]);

  const login = useCallback(
    async (input: LoginInput) => {
      const response = await endpoints.auth.login(input);
      setToken(response.access_token);
      setTokenState(response.access_token);
      const user = await endpoints.auth.me();
      queryClient.setQueryData(["me"], user);
      return user;
    },
    [queryClient],
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      await endpoints.auth.register(input);
      return login({ email: input.email, password: input.password });
    },
    [login],
  );

  const logout = useCallback(() => {
    clearToken();
    setTokenState(null);
    queryClient.clear();
  }, [queryClient]);

  const clearFlash = useCallback(() => setFlashState(null), []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: meQuery.data ?? null,
      token,
      isLoading: Boolean(token) && meQuery.isPending,
      isAuthenticated: Boolean(token && meQuery.data),
      login,
      register,
      logout,
      flash,
      clearFlash,
    }),
    [
      meQuery.data,
      meQuery.isPending,
      token,
      login,
      register,
      logout,
      flash,
      clearFlash,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// The hook shares the provider module by design.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
