import {useEffect, useState, useCallback} from 'react';
import type {ReactNode} from 'react';
import clsx from 'clsx';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

import styles from './styles.module.css';

type Entry = {
  user_id: string;
  name: string;
  value: number;
};

type BoardKind = 'coins' | 'bank' | 'gold' | 'xp';

const BOARDS: {key: BoardKind; label: string; unit: string}[] = [
  {key: 'coins', label: 'Coins', unit: '🪙'},
  {key: 'bank', label: 'Bank', unit: '🏦'},
  {key: 'gold', label: 'Gold', unit: '✨'},
  {key: 'xp', label: 'XP', unit: '⭐'},
];

const MEDALS = ['🥇', '🥈', '🥉'];

function formatValue(value: number): string {
  return value.toLocaleString(undefined, {maximumFractionDigits: 2});
}

export default function LeaderboardPage(): ReactNode {
  const {siteConfig} = useDocusaurusContext();
  const apiBase = (siteConfig.customFields?.leaderboardApiUrl as string) || '';

  const [board, setBoard] = useState<BoardKind>('coins');
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

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
      fetch(`${apiBase}/leaderboard/${kind}?limit=25`)
        .then((res) => {
          if (!res.ok) throw new Error(`Request failed (${res.status})`);
          return res.json();
        })
        .then((data) => {
          if (!data.success) throw new Error(data.error || 'Unknown error');
          setEntries(data.entries || []);
          setUpdatedAt(new Date());
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
    const interval = setInterval(() => load(board), 30000);
    return () => clearInterval(interval);
  }, [board, load]);

  const activeBoard = BOARDS.find((b) => b.key === board)!;

  return (
    <Layout
      title="Leaderboard"
      description="Multichat coins, bank, gold, and XP leaderboards">
      <header className={clsx('hero hero--primary', styles.heroBanner)}>
        <div className="container">
          <Heading as="h1" className="hero__title">
            Leaderboard
          </Heading>
          <p className="hero__subtitle">
            Top members by coins, bank, gold, and XP — live from the bot.
          </p>
        </div>
      </header>

      <main className={styles.wrapper}>
        <div className={styles.tabs}>
          {BOARDS.map((b) => (
            <button
              key={b.key}
              className={clsx(styles.tab, board === b.key && styles.tabActive)}
              onClick={() => setBoard(b.key)}>
              {b.unit} {b.label}
            </button>
          ))}
        </div>

        {loading && !entries && (
          <div className={styles.state}>Loading {activeBoard.label.toLowerCase()} leaderboard…</div>
        )}

        {error && (
          <div className={styles.state}>
            ⚠️ {error}
            <br />
            <small>
              Make sure the relay service is deployed and the bot has pushed at least once.
            </small>
          </div>
        )}

        {!error && entries && entries.length === 0 && (
          <div className={styles.state}>No entries yet.</div>
        )}

        {!error && entries && entries.length > 0 && (
          <div className={styles.panel}>
            {entries.map((entry, i) => (
              <div className={styles.row} key={entry.user_id}>
                <div className={styles.rank}>
                  {i < 3 ? (
                    <span className={styles.rankMedal}>{MEDALS[i]}</span>
                  ) : (
                    i + 1
                  )}
                </div>
                <div className={styles.name}>{entry.name}</div>
                <div className={styles.value}>
                  {formatValue(entry.value)} {activeBoard.unit}
                </div>
              </div>
            ))}
          </div>
        )}

        {updatedAt && !error && (
          <div className={styles.meta}>
            Updated {updatedAt.toLocaleTimeString()} · refreshes automatically every 30s
          </div>
        )}

        <button className={styles.refreshBtn} onClick={() => load(board)} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh now'}
        </button>
      </main>
    </Layout>
  );
}
