import React, { useEffect } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '../state/AuthContext';
import { Shell } from './Shell';

interface ProtectedRouteProps {
  component: React.ComponentType<any>;
}

export function ProtectedRoute({ component: Component }: ProtectedRouteProps) {
  const { user, openAuthModal, setRequestedRoute } = useAuth();
  const [location, setLocation] = useLocation();

  useEffect(() => {
    if (!user) {
      // Save requested route so user continues after auth
      setRequestedRoute(location);
      // Open auth modal on the landing page
      openAuthModal('signin', location);
      // Redirect to landing page /
      setLocation('/');
    }
  }, [user, location, setLocation, openAuthModal, setRequestedRoute]);

  if (!user) {
    return null;
  }

  return (
    <Shell>
      <Component />
    </Shell>
  );
}
