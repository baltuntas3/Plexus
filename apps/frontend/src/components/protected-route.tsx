import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAtomValue } from "jotai";
import { isAuthenticatedAtom } from "../atoms/auth.atoms.js";

interface ProtectedRouteProps {
  children: ReactNode;
}

export const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
  const isAuthenticated = useAtomValue(isAuthenticatedAtom);
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
};
