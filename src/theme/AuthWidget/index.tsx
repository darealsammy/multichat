import {useEffect, useState, useCallback} from 'react';
import type {ReactNode} from 'react';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import styles from './styles.module.css';

type SessionUser = {
  user_id: string | null;
  name: string;
  avatar_url: string | null;
};

const STORAGE_KEY = 'multichat_session_token';
const USER_STORAGE_KEY = 'multichat_session_user';
export const AUTH_CHANGED_EVENT = 'multichat-auth-changed';

export default function AuthWidget(): ReactNode {
  const {siteConfig} = useDocusaurusContext();
  const apiBase = (siteConfig.customFields?.leaderboardApiUrl as string) || '';

  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Restore session on load.
  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved || !apiBase) return;
    setToken(saved);
    fetch(`${apiBase}/auth/me`, {headers: {Authorization: `Bearer ${saved}`}})
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => {
        if (data.success) {
          setUser(data.user);
          window.localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(data.user));
        } else throw new Error();
      })
      .catch(() => {
        window.localStorage.removeItem(STORAGE_KEY);
        window.localStorage.removeItem(USER_STORAGE_KEY);
        setToken(null);
      });
  }, [apiBase]);

  const handleSignIn = useCallback(async () => {
    if (!apiKeyInput.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/auth/login`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({api_key: apiKeyInput.trim()}),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Sign in failed');
      }
      window.localStorage.setItem(STORAGE_KEY, data.token);
      window.localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(data.user));
      window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
      setToken(data.token);
      setUser(data.user);
      setShowModal(false);
      setApiKeyInput('');
    } catch (err: any) {
      setError(err.message || 'Sign in failed');
    } finally {
      setSubmitting(false);
    }
  }, [apiBase, apiKeyInput]);

  const handleSignOut = useCallback(() => {
    if (token && apiBase) {
      fetch(`${apiBase}/auth/logout`, {
        method: 'POST',
        headers: {Authorization: `Bearer ${token}`},
      }).catch(() => {});
    }
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(USER_STORAGE_KEY);
    window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
    setToken(null);
    setUser(null);
    setShowMenu(false);
  }, [apiBase, token]);

  return (
    <div className={styles.wrap}>
      {!user && (
        <button className={styles.signInButton} onClick={() => setShowModal(true)}>
          Sign In
        </button>
      )}

      {user && (
        <div style={{position: 'relative'}}>
          <button className={styles.userPill} onClick={() => setShowMenu((v) => !v)}>
            {user.avatar_url ? (
              <img className={styles.avatar} src={user.avatar_url} alt={user.name} />
            ) : (
              <span className={styles.avatarFallback} />
            )}
            {user.name}
          </button>
          {showMenu && (
            <div className={styles.menu}>
              <button className={styles.menuItem} onClick={handleSignOut}>
                Sign out
              </button>
            </div>
          )}
        </div>
      )}

      {showModal && (
        <div className={styles.overlay} onClick={() => setShowModal(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <p className={styles.modalTitle}>Sign in</p>
            <p className={styles.modalHint}>
              Open Discord and run the <code>/api key</code> command to get your key.
            </p>
            <input
              className={styles.input}
              type="password"
              placeholder="Paste your API key"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSignIn()}
              autoFocus
            />
            {error && <div className={styles.error}>{error}</div>}
            <div className={styles.modalActions}>
              <button className={styles.cancelButton} onClick={() => setShowModal(false)}>
                Cancel
              </button>
              <button
                className={styles.submitButton}
                disabled={submitting || !apiKeyInput.trim()}
                onClick={handleSignIn}>
                {submitting ? 'Signing in…' : 'Sign in'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
