import {useEffect, useState, useCallback} from 'react';
import type {ReactNode} from 'react';
import clsx from 'clsx';
import Layout from '@theme/Layout';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

import styles from './styles.module.css';

type Entry = {
  user_id: string | null;
  name: string;
  value: number;
  avatar_url?: string | null;
  is_company?: boolean;
  tag?: string | null;
};

type BoardKind =
  | 'wallet'
  | 'bank'
  | 'gold'
  | 'networth'
  | 'levels'
  | 'messages'
  | 'members'
  | 'vc_afk'
  | 'connect4'
  | 'connect5';

const BOARDS: {key: BoardKind; label: string; unit: string}[] = [
  {key: 'wallet', label: 'Wallet', unit: 'coins'},
  {key: 'bank', label: 'Bank', unit: 'coins'},
  {key: 'gold', label: 'Gold', unit: 'gold'},
  {key: 'networth', label: 'Net Worth', unit: 'coins'},
  {key: 'levels', label: 'Levels', unit: 'XP'},
  {key: 'messages', label: 'Messages', unit: 'messages'},
  {key: 'members', label: 'Members', unit: 'members'},
  {key: 'vc_afk', label: 'VC AFK', unit: 'minutes'},
  {key: 'connect4', label: 'Connect4', unit: 'Elo'},
  {key: 'connect5', label: 'Connect5', unit: 'Elo'},
];

function formatValue(value: number): string {
  return value.toLocaleString(undefined, {maximumFractionDigits: 2});
}

export default function LeaderboardPage(): ReactNode {
  const {siteConfig} = useDocusaurusContext();
  const apiBase = (siteConfig.customFields?.leaderboardApiUrl as string) || '';

  const [board, setBoard] = useState<BoardKind>('wallet');
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('multichat_session_user');
      if (raw) setCurrentUserId(JSON.parse(raw).user_id ?? null);
    } catch {
      setCurrentUserId(null);
    }
  }, []);

  const load = useCallback(
    (kind: BoardKind) => {
      if (!apiBase) {
        setError(
          'No leaderboard relay URL configured. Set customFields.leaderboardApiUrl in docusaurus.config.ts to your deployed relay\'s address.',
        );
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      fetch(`${apiBase}/leaderboard/${kind}?limit=50`)
        .then((res) => {
          if (!res.ok) throw new Error(`Request failed (${res.status})`);
          return res.json();
        })
        .then((data) => {
          if (!data.success) throw new Error(data.error || 'Unknown error');
          setEntries(data.entries || []);
        })
        .catch((err) => {
          setError(err.message || 'Failed to load leaderboard');
          setEntries(null);
        })
        .finally(() => setLoading(false));
    },
    [apiBase],
  );

  useEffect(() => {
    load(board);
    const interval = setInterval(() => load(board), 500);
    return () => clearInterval(interval);
  }, [board, load]);

  const activeBoard = BOARDS.find((b) => b.key === board)!;

  return (
    <Layout title="Leaderboard" description="Multichat leaderboards">
      <div className={styles.page}>
        <div className={styles.tabs}>
          {BOARDS.map((b) => (
            <button
              key={b.key}
              className={clsx(styles.tab, board === b.key && styles.tabActive)}
              onClick={() => setBoard(b.key)}>
              {b.label}
            </button>
          ))}
        </div>

        {loading && !entries && (
          <div className={styles.state}>Loading {activeBoard.label.toLowerCase()}…</div>
        )}

        {error && (
          <div className={styles.state}>
            {error}
            <br />
            <small>Make sure the relay service is deployed and the bot has pushed at least once.</small>
          </div>
        )}

        {!error && entries && entries.length === 0 && (
          <div className={styles.state}>No entries yet.</div>
        )}

        {!error && entries && entries.length > 0 && (
          <div className={styles.board}>
            <div className={styles.boardHeader}>
              <span className={styles.boardHeaderLabel}>Global · All-Time</span>
            </div>
            {entries.map((entry, i) => {
              const rank = i + 1;
              const isYou = !!currentUserId && entry.user_id === currentUserId;
              return (
                <div
                  key={entry.user_id ?? entry.name}
                  className={clsx(
                    styles.row,
                    rank === 1 && styles.rankGold,
                    rank === 2 && styles.rankSilver,
                    rank === 3 && styles.rankBronze,
                    isYou && styles.rankYou,
                  )}>
                  <span className={styles.rank}>{rank}</span>
                  {entry.is_company ? (
                    <span className={styles.avatarFallback} />
                  ) : entry.avatar_url ? (
                    <img className={styles.avatarImg} src={entry.avatar_url} alt="" />
                  ) : (
                    <span className={styles.avatarFallback} />
                  )}
                  <span className={styles.name}>
                    {entry.name}
                    {entry.tag && <span className={styles.userTag}> [{entry.tag}]</span>}
                    {entry.is_company && <span className={styles.companyTag}> (company)</span>}
                  </span>
                  <span className={styles.value}>
                    {formatValue(entry.value)}
                    <span className={styles.unit}>{activeBoard.unit}</span>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Layout>
  );
}
