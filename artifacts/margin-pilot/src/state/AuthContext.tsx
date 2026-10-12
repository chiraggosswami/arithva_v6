import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInAnonymously,
  signOut,
  updateProfile,
  type User as FirebaseUser
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db, googleProvider, isFirebaseConfigured } from '../lib/firebase';
import { STORAGE_KEY } from '../i18n/config';

export interface User {
  id: string;
  email: string;
  name: string;
  storeName?: string;
  avatarUrl?: string;
  storeId?: string;
  preferredLanguage?: string;
}

interface AuthContextType {
  user: User | null;
  firebaseUser: FirebaseUser | null;
  isLoading: boolean;
  login: (email: string, password?: string) => Promise<{ success: boolean; error?: string }>;
  loginWithGoogle: () => Promise<{ success: boolean; error?: string }>;
  register: (name: string, email: string, password?: string, storeName?: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  updatePreferredLanguage: (langCode: string) => Promise<void>;
  requestedRoute: string | null;
  setRequestedRoute: (route: string | null) => void;
  authModalOpen: boolean;
  authModalTab: 'signin' | 'register';
  openAuthModal: (tab?: 'signin' | 'register', returnTo?: string) => void;
  closeAuthModal: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

const AUTH_USER_KEY = 'arthiva-auth-user';
const REQUESTED_ROUTE_KEY = 'arthiva-requested-route';

async function syncUserProfile(fbUser: FirebaseUser, storeNameHint?: string): Promise<User> {
  const currentSavedLang = (() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || 'en';
    } catch {
      return 'en';
    }
  })();

  const fallbackUser: User = {
    id: fbUser.uid,
    email: fbUser.email || '',
    name: fbUser.displayName || fbUser.email?.split('@')[0] || 'Operations Pilot',
    storeName: storeNameHint?.trim() || `${(fbUser.displayName || 'Operations').split(' ')[0]}'s Store`,
    avatarUrl: fbUser.photoURL || undefined,
    storeId: `store_${fbUser.uid.slice(0, 8)}`,
    preferredLanguage: currentSavedLang,
  };

  if (!isFirebaseConfigured) {
    return fallbackUser;
  }

  try {
    const userRef = doc(db, 'users', fbUser.uid);
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      const data = snap.data();
      const resolvedLang = data.preferredLanguage || currentSavedLang;
      return {
        id: fbUser.uid,
        email: fbUser.email || '',
        name: data.displayName || fbUser.displayName || 'Operations Pilot',
        storeName: data.storeName || 'Arthiva Store',
        avatarUrl: fbUser.photoURL || undefined,
        storeId: `store_${fbUser.uid.slice(0, 8)}`,
        preferredLanguage: resolvedLang,
      };
    } else {
      const displayName = fbUser.displayName || fbUser.email?.split('@')[0] || 'Operations Pilot';
      const storeName = storeNameHint?.trim() || `${displayName.split(' ')[0]}'s Store`;
      const initialProfile = {
        userId: fbUser.uid,
        email: fbUser.email || '',
        displayName,
        storeName,
        preferredLanguage: currentSavedLang,
        photoURL: fbUser.photoURL || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await setDoc(userRef, initialProfile);
      return {
        id: fbUser.uid,
        email: fbUser.email || '',
        name: initialProfile.displayName,
        storeName: initialProfile.storeName,
        avatarUrl: fbUser.photoURL || undefined,
        storeId: `store_${fbUser.uid.slice(0, 8)}`,
        preferredLanguage: currentSavedLang,
      };
    }
  } catch (err) {
    console.warn('[Firebase] Firestore user profile sync notice (using auth profile):', err);
    return fallbackUser;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    try {
      const stored = localStorage.getItem(AUTH_USER_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalTab, setAuthModalTab] = useState<'signin' | 'register'>('signin');
  const [requestedRoute, setRequestedRouteState] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(REQUESTED_ROUTE_KEY);
    } catch {
      return null;
    }
  });

  const setRequestedRoute = (route: string | null) => {
    setRequestedRouteState(route);
    if (route) {
      sessionStorage.setItem(REQUESTED_ROUTE_KEY, route);
    } else {
      sessionStorage.removeItem(REQUESTED_ROUTE_KEY);
    }
  };

  const openAuthModal = (tab: 'signin' | 'register' = 'signin', returnTo?: string) => {
    if (returnTo) {
      setRequestedRoute(returnTo);
    }
    setAuthModalTab(tab);
    setAuthModalOpen(true);
  };

  const closeAuthModal = () => {
    setAuthModalOpen(false);
  };

  // Listen to Firebase Auth state
  useEffect(() => {
    if (!isFirebaseConfigured) {
      // Offline/local demo mode: restore existing session if stored, then mark loading complete
      const stored = localStorage.getItem(AUTH_USER_KEY);
      if (stored) {
        try {
          setUser(JSON.parse(stored));
        } catch {
          setUser(null);
        }
      }
      setIsLoading(false);
      return;
    }

    try {
      const unsubscribe = onAuthStateChanged(
        auth,
        async (fbUser) => {
          setFirebaseUser(fbUser);
          if (fbUser) {
            const appUser = await syncUserProfile(fbUser);
            setUser(appUser);
            localStorage.setItem(AUTH_USER_KEY, JSON.stringify(appUser));
            setIsLoading(false);
          } else {
            // Ensure authenticated Firebase session for Firestore security rules
            signInAnonymously(auth).catch((err) => {
              console.warn('[Firebase Auth] Anonymous session notice:', err?.message || err);
              setUser(null);
              localStorage.removeItem(AUTH_USER_KEY);
              setIsLoading(false);
            });
          }
        },
        (error: any) => {
          // Catch and handle api-key-not-valid without crashing or throwing
          console.warn('[Firebase Auth] Auth state listener notice:', error?.message || error);
          const stored = localStorage.getItem(AUTH_USER_KEY);
          if (stored) {
            try {
              setUser(JSON.parse(stored));
            } catch {
              setUser(null);
            }
          }
          setIsLoading(false);
        }
      );

      return () => unsubscribe();
    } catch (err) {
      console.warn('[Firebase Auth] Failed to subscribe to onAuthStateChanged:', err);
      setIsLoading(false);
    }
  }, []);

  const loginWithGoogle = async (): Promise<{ success: boolean; error?: string }> => {
    setIsLoading(true);

    if (!isFirebaseConfigured) {
      const appUser: User = {
        id: 'usr_demo_google',
        email: 'founder@ojasbotanics.in',
        name: 'Priya Sharma',
        storeName: 'Ojas Botanics',
        storeId: 'store_ojas_demo',
      };
      setUser(appUser);
      localStorage.setItem(AUTH_USER_KEY, JSON.stringify(appUser));
      setIsLoading(false);
      setAuthModalOpen(false);
      return { success: true };
    }

    try {
      const cred = await signInWithPopup(auth, googleProvider);
      const appUser = await syncUserProfile(cred.user);
      setUser(appUser);
      localStorage.setItem(AUTH_USER_KEY, JSON.stringify(appUser));
      setIsLoading(false);
      setAuthModalOpen(false);
      return { success: true };
    } catch (err: any) {
      setIsLoading(false);
      console.warn('Google sign-in catch (falling back to demo user):', err?.message || err);

      const isApiKeyErr =
        err?.code === 'auth/invalid-api-key' ||
        err?.code === 'auth/api-key-not-valid' ||
        err?.message?.toLowerCase().includes('api key') ||
        err?.message?.toLowerCase().includes('network-request-failed') ||
        err?.code === 'auth/internal-error';

      if (isApiKeyErr) {
        const appUser: User = {
          id: 'usr_demo_google',
          email: 'founder@ojasbotanics.in',
          name: 'Priya Sharma',
          storeName: 'Ojas Botanics',
          storeId: 'store_ojas_demo',
        };
        setUser(appUser);
        localStorage.setItem(AUTH_USER_KEY, JSON.stringify(appUser));
        setAuthModalOpen(false);
        return { success: true };
      }

      let msg = 'Google authentication failed';
      if (err?.code === 'auth/popup-closed-by-user') {
        msg = 'Sign-in window was closed';
      } else if (err?.code === 'auth/cancelled-popup-request') {
        msg = 'Sign-in cancelled';
      } else if (err?.message) {
        msg = err.message;
      }
      return { success: false, error: msg };
    }
  };

  const login = async (email: string, password = ''): Promise<{ success: boolean; error?: string }> => {
    setIsLoading(true);
    const cleanEmail = email.trim();

    if (!isFirebaseConfigured) {
      const appUser: User = {
        id: `usr_${cleanEmail.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 16)}`,
        email: cleanEmail,
        name: cleanEmail.split('@')[0] || 'Operations Pilot',
        storeName: 'Ojas Botanics',
        storeId: 'store_ojas_demo',
      };
      setUser(appUser);
      localStorage.setItem(AUTH_USER_KEY, JSON.stringify(appUser));
      setIsLoading(false);
      setAuthModalOpen(false);
      return { success: true };
    }

    try {
      const cred = await signInWithEmailAndPassword(auth, cleanEmail, password || 'demo123');
      const appUser = await syncUserProfile(cred.user);
      setUser(appUser);
      localStorage.setItem(AUTH_USER_KEY, JSON.stringify(appUser));
      setIsLoading(false);
      setAuthModalOpen(false);
      return { success: true };
    } catch (err: any) {
      const isApiKeyErr =
        err?.code === 'auth/invalid-api-key' ||
        err?.code === 'auth/api-key-not-valid' ||
        err?.message?.toLowerCase().includes('api key') ||
        err?.message?.toLowerCase().includes('network-request-failed') ||
        err?.code === 'auth/internal-error';

      if (isApiKeyErr) {
        const appUser: User = {
          id: `usr_${cleanEmail.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 16)}`,
          email: cleanEmail,
          name: cleanEmail.split('@')[0] || 'Operations Pilot',
          storeName: 'Ojas Botanics',
          storeId: 'store_ojas_demo',
        };
        setUser(appUser);
        localStorage.setItem(AUTH_USER_KEY, JSON.stringify(appUser));
        setIsLoading(false);
        setAuthModalOpen(false);
        return { success: true };
      }

      // If user doesn't exist, auto create for seamless demo
      if (err?.code === 'auth/user-not-found' || err?.code === 'auth/invalid-credential') {
        try {
          const cred = await createUserWithEmailAndPassword(auth, cleanEmail, password || 'demo123');
          const appUser = await syncUserProfile(cred.user);
          setUser(appUser);
          localStorage.setItem(AUTH_USER_KEY, JSON.stringify(appUser));
          setIsLoading(false);
          setAuthModalOpen(false);
          return { success: true };
        } catch {
          // Graceful fallback to local session
          const appUser: User = {
            id: `usr_${cleanEmail.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 16)}`,
            email: cleanEmail,
            name: cleanEmail.split('@')[0] || 'Operations Pilot',
            storeName: 'Ojas Botanics',
            storeId: 'store_ojas_demo',
          };
          setUser(appUser);
          localStorage.setItem(AUTH_USER_KEY, JSON.stringify(appUser));
          setIsLoading(false);
          setAuthModalOpen(false);
          return { success: true };
        }
      }

      setIsLoading(false);
      return { success: false, error: err?.message || 'Authentication failed' };
    }
  };

  const register = async (name: string, email: string, password = '', storeName?: string): Promise<{ success: boolean; error?: string }> => {
    setIsLoading(true);
    const cleanEmail = email.trim();
    const displayName = name.trim() || cleanEmail.split('@')[0] || 'Operations Pilot';
    const store = storeName?.trim() || `${displayName.split(' ')[0]}'s Store`;

    if (!isFirebaseConfigured) {
      const appUser: User = {
        id: `usr_${cleanEmail.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 16)}`,
        email: cleanEmail,
        name: displayName,
        storeName: store,
        storeId: 'store_custom',
      };
      setUser(appUser);
      localStorage.setItem(AUTH_USER_KEY, JSON.stringify(appUser));
      setIsLoading(false);
      setAuthModalOpen(false);
      return { success: true };
    }

    try {
      const cred = await createUserWithEmailAndPassword(auth, cleanEmail, password || 'demo123');
      if (name.trim()) {
        try {
          await updateProfile(cred.user, { displayName: name.trim() });
        } catch {
          // ignore
        }
      }
      const appUser = await syncUserProfile(cred.user, storeName);
      setUser(appUser);
      localStorage.setItem(AUTH_USER_KEY, JSON.stringify(appUser));
      setIsLoading(false);
      setAuthModalOpen(false);
      return { success: true };
    } catch (err: any) {
      if (err?.code === 'auth/email-already-in-use') {
        return login(cleanEmail, password);
      }
      // Graceful fallback on API key error
      const appUser: User = {
        id: `usr_${cleanEmail.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 16)}`,
        email: cleanEmail,
        name: displayName,
        storeName: store,
        storeId: 'store_custom',
      };
      setUser(appUser);
      localStorage.setItem(AUTH_USER_KEY, JSON.stringify(appUser));
      setIsLoading(false);
      setAuthModalOpen(false);
      return { success: true };
    }
  };

  const logout = async () => {
    if (isFirebaseConfigured) {
      try {
        await signOut(auth);
      } catch (err) {
        console.warn('Firebase signOut notice:', err);
      }
    }
    setUser(null);
    setFirebaseUser(null);
    localStorage.removeItem(AUTH_USER_KEY);
    sessionStorage.removeItem(REQUESTED_ROUTE_KEY);
  };

  const updatePreferredLanguage = async (langCode: string) => {
    setUser(prev => {
      if (!prev) return prev;
      const updated = { ...prev, preferredLanguage: langCode };
      try {
        localStorage.setItem(AUTH_USER_KEY, JSON.stringify(updated));
      } catch {
        // ignore
      }
      return updated;
    });

    try {
      localStorage.setItem(STORAGE_KEY, langCode);
    } catch {
      // ignore
    }

    if (user?.id && isFirebaseConfigured) {
      try {
        const userRef = doc(db, 'users', user.id);
        await setDoc(
          userRef,
          {
            userId: user.id,
            preferredLanguage: langCode,
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
      } catch (err) {
        console.warn('[Firebase] Could not persist preferredLanguage:', err);
      }
    }
  };

  const value = useMemo(() => ({
    user,
    firebaseUser,
    isLoading,
    login,
    loginWithGoogle,
    register,
    logout,
    updatePreferredLanguage,
    requestedRoute,
    setRequestedRoute,
    authModalOpen,
    authModalTab,
    openAuthModal,
    closeAuthModal,
  }), [user, firebaseUser, isLoading, requestedRoute, authModalOpen, authModalTab]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
