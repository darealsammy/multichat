import {useEffect, useState, useCallback} from 'react';
import type {ReactNode} from 'react';
import clsx from 'clsx';
import Layout from '@theme/Layout';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

import styles from './styles.module.css';

type Casino = {
  id: string;
  name: string;
  balance: number;
};

type GamblingConfig = {
  casinos: Casino[];
  gambling_tax_rate: number;
  slot_symbols: string[];
  slot_min_bet: number;
  slot_max_bet: number;
};

// Same payout curve as the bot's slot machine (rarest symbol = biggest
// multiplier), matched up positionally against whatever symbols the bot
// currently has pushed, so the payout table shown here always tracks reality.
const PAYOUT_CURVE = [2.8, 5.0, 8.5, 18.0, 45.0, 100.0];

const TOKEN_KEY = 'multichat_session_token';

export default function GamblingPage(): ReactNode {
  const {siteConfig} = useDocusaurusContext();
  const apiBase = (siteConfig.customFields?.gamblingApiUrl as string) || '';

  const [config, setConfig] = useState<GamblingConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [chips, setChips] = useState<number | null>(null);

  const [casinoId, setCasinoId] = useState<string | null>(null);
  const [bet, setBet] = useState<string>('');
  const [grid, setGrid] = useState<string[][] | null>(null);
  const [winningCells, setWinningCells] = useState<Set<string>>(new Set());
  const [spinning, setSpinning] = useState(false);
  const [resultText, setResultText] = useState<string | null>(null);
  const [resultKind, setResultKind] = useState<'win' | 'lose' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setToken(window.localStorage.getItem(TOKEN_KEY));
  }, []);

  const loadConfig = useCallback(() => {
    if (!apiBase) {
      setConfigError('No gambling relay URL configured.');
      return;
    }
    fetch(`${apiBase}/gambling/config`)
      .then((res) => res.json())
      .then((data) => {
        if (!data.success) throw new Error('Failed to load casinos');
        setConfig(data);
        setConfigError(null);
      })
      .catch(() => setConfigError('Could not reach the gambling relay. Try again shortly.'));
  }, [apiBase]);

  useEffect(() => {
    loadConfig();
    const interval = setInterval(loadConfig, 4000);
    return () => clearInterval(interval);
  }, [loadConfig]);

  const loadWallet = useCallback(() => {
    if (!apiBase || !token) return;
    fetch(`${apiBase}/gambling/wallet`, {headers: {Authorization: `Bearer ${token}`}})
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => data.success && setChips(data.chips))
      .catch(() => {});
  }, [apiBase, token]);

  useEffect(() => {
    loadWallet();
  }, [loadWallet]);

  const selectedCasino = config?.casinos.find((c) => c.id === casinoId) || null;
  const maxBet = selectedCasino
    ? Math.max(0, Math.min(config?.slot_max_bet ?? 0, selectedCasino.balance))
    : 0;

  const handleSpin = useCallback(async () => {
    setError(null);
    if (!token) {
      setError('Sign in first (top right) to play.');
      return;
    }
    if (!selectedCasino) {
      setError('Pick a casino to play against first.');
      return;
    }
    const betNum = Number(bet);
    if (!Number.isFinite(betNum) || betNum <= 0) {
      setError('Enter a valid bet amount.');
      return;
    }
    if (betNum > maxBet) {
      setError(`${selectedCasino.name} can only cover a bet up to ${maxBet.toLocaleString()} chips.`);
      return;
    }

    setSpinning(true);
    setResultText(null);
    setResultKind(null);
    try {
      const res = await fetch(`${apiBase}/gambling/spin`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`},
        body: JSON.stringify({casino_id: selectedCasino.id, bet: betNum}),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Spin failed');
      }
      setGrid(data.grid);
      setWinningCells(new Set((data.winning_cells || []).map((c: number[]) => `${c[0]}-${c[1]}`)));
      setChips(data.chips);
      if (data.net > 0) {
        setResultKind('win');
        const taxNote = data.tax_amount > 0 ? ` (after ${(data.tax_rate * 100).toFixed(0)}% gambling tax: -${data.tax_amount.toLocaleString()})` : '';
        setResultText(`🎉 You won ${data.payout_after_tax.toLocaleString()} chips! Net: +${data.net.toLocaleString()}${taxNote}`);
      } else if (data.payout > 0) {
        setResultKind('lose');
        setResultText(`You got ${data.payout_after_tax.toLocaleString()} chips back. Net: ${data.net.toLocaleString()}`);
      } else {
        setResultKind('lose');
        setResultText(`No lines hit. The house wins this one. Net: -${betNum.toLocaleString()}`);
      }
    } catch (err: any) {
      setError(err.message || 'Spin failed');
    } finally {
      setSpinning(false);
    }
  }, [apiBase, token, selectedCasino, bet, maxBet]);

  return (
    <Layout description="Multichat gambling — pick a casino, spin the slots">
      <div className={styles.page}>
        <div className={styles.header}>
          <span className={styles.title}>🎰 Gambling</span>
          {chips !== null && (
            <span className={styles.chips}>
              Chips: <span className={styles.chipsValue}>{chips.toLocaleString()}</span>
            </span>
          )}
        </div>

        {configError && <div className={styles.state}>{configError}</div>}

        {!configError && !config && <div className={styles.state}>Loading casinos…</div>}

        {config && (
          <div className={styles.layout}>
            <div className={styles.panel}>
              <div className={styles.panelTitle}>Choose a casino</div>
              {config.casinos.length === 0 && (
                <div className={styles.state}>No casino companies exist yet.</div>
              )}
              <div className={styles.casinoGrid}>
                {config.casinos.map((c) => (
                  <button
                    key={c.id}
                    disabled={c.balance <= 0}
                    className={clsx(
                      styles.casinoCard,
                      casinoId === c.id && styles.casinoCardActive,
                      c.balance <= 0 && styles.casinoCardDisabled,
                    )}
                    onClick={() => {
                      setCasinoId(c.id);
                      setBet('');
                      setError(null);
                    }}>
                    <div className={styles.casinoName}>{c.name}</div>
                    <div className={styles.casinoBalance}>
                      {c.balance <= 0 ? 'Out of money' : `Can pay up to ${c.balance.toLocaleString()}`}
                    </div>
                  </button>
                ))}
              </div>

              <div className={styles.betRow}>
                <input
                  className={styles.betInput}
                  type="number"
                  placeholder={selectedCasino ? `${config.slot_min_bet} - ${maxBet}` : 'Pick a casino first'}
                  value={bet}
                  disabled={!selectedCasino || spinning}
                  min={config.slot_min_bet}
                  max={maxBet}
                  onChange={(e) => setBet(e.target.value)}
                />
              </div>
              <div className={styles.betHint}>
                {selectedCasino
                  ? `Bet is capped at what ${selectedCasino.name} can currently pay out (${maxBet.toLocaleString()} chips). Bigger bets lower your odds — the house always keeps the edge.`
                  : 'Select a casino above — the amount you can bet is limited to what that casino can afford to pay you.'}
              </div>

              <button className={styles.spinButton} disabled={spinning || !selectedCasino} onClick={handleSpin}>
                {spinning ? 'Spinning…' : 'Spin'}
              </button>

              <div className={styles.reel}>
                {(grid || [
                  [config.slot_symbols[0], config.slot_symbols[1], config.slot_symbols[2]],
                  [config.slot_symbols[1], config.slot_symbols[2], config.slot_symbols[0]],
                  [config.slot_symbols[2], config.slot_symbols[0], config.slot_symbols[1]],
                ]).map((row, r) =>
                  row.map((sym, c) => (
                    <div
                      key={`${r}-${c}`}
                      className={clsx(
                        styles.cell,
                        winningCells.has(`${r}-${c}`) && styles.cellWin,
                        !grid && styles.cellPlaceholder,
                      )}>
                      {sym}
                    </div>
                  )),
                )}
              </div>

              {resultText && (
                <div className={clsx(styles.resultText, resultKind === 'win' ? styles.win : styles.lose)}>
                  {resultText}
                </div>
              )}
              {error && <div className={styles.errorText}>{error}</div>}
              {!token && <div className={styles.signInNote}>Sign in (top right) to get chips and play.</div>}
            </div>

            <div className={styles.panel}>
              <div className={styles.panelTitle}>Payouts (per line)</div>
              <div className={styles.payoutTable}>
                {config.slot_symbols.map((sym, i) => (
                  <div className={styles.payoutRow} key={sym}>
                    <span>
                      {sym} {sym} {sym}
                    </span>
                    <span>{(PAYOUT_CURVE[i] ?? 100).toFixed(1)}x</span>
                  </div>
                ))}
                <div className={styles.payoutRow}>
                  <span>Any 2 matching on a line</span>
                  <span>1.2x</span>
                </div>
              </div>
              <div className={styles.taxNote}>
                Winnings are taxed at <span className={styles.taxRate}>{(config.gambling_tax_rate * 100).toFixed(0)}%</span> (profit portion only).
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
