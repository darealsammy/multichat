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

// Payout curve matched positionally to whatever symbols the bot pushes.
const PAYOUT_CURVE = [2.8, 5.0, 8.5, 18.0, 45.0, 100.0];
const MINES_GRID_SIZE = 25;

const TOKEN_KEY = 'multichat_session_token';

export default function GamblingPage(): ReactNode {
  const {siteConfig} = useDocusaurusContext();
  const apiBase = (siteConfig.customFields?.gamblingApiUrl as string) || '';

  const [tab, setTab] = useState<'slots' | 'mines'>('slots');

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

  const [mineCount, setMineCount] = useState<string>('3');
  const [minesActive, setMinesActive] = useState(false);
  const [minesRevealed, setMinesRevealed] = useState<Set<number>>(new Set());
  const [minesHit, setMinesHit] = useState<number | null>(null);
  const [minesMultiplier, setMinesMultiplier] = useState(1);
  const [minesBusy, setMinesBusy] = useState(false);
  const [minesResultText, setMinesResultText] = useState<string | null>(null);
  const [minesResultKind, setMinesResultKind] = useState<'win' | 'lose' | null>(null);
  const [minesError, setMinesError] = useState<string | null>(null);

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
        setResultText(`You won ${data.payout_after_tax.toLocaleString()} chips! Net: +${data.net.toLocaleString()}${taxNote}`);
      } else if (data.payout > 0) {
        setResultKind('lose');
        setResultText(`You got ${data.payout_after_tax.toLocaleString()} chips back. Net: ${data.net.toLocaleString()}`);
      } else {
        setResultKind('lose');
        setResultText(`No lines hit. Net: -${betNum.toLocaleString()}`);
      }
    } catch (err: any) {
      setError(err.message || 'Spin failed');
    } finally {
      setSpinning(false);
    }
  }, [apiBase, token, selectedCasino, bet, maxBet]);

  const resetMines = () => {
    setMinesActive(false);
    setMinesRevealed(new Set());
    setMinesHit(null);
    setMinesMultiplier(1);
    setMinesResultText(null);
    setMinesResultKind(null);
  };

  const handleMinesStart = useCallback(async () => {
    setMinesError(null);
    if (!token) {
      setMinesError('Sign in first (top right) to play.');
      return;
    }
    if (!selectedCasino) {
      setMinesError('Pick a casino to play against first.');
      return;
    }
    const betNum = Number(bet);
    const minesNum = Number(mineCount);
    if (!Number.isFinite(betNum) || betNum <= 0) {
      setMinesError('Enter a valid bet amount.');
      return;
    }
    if (betNum > maxBet) {
      setMinesError(`${selectedCasino.name} can only cover a bet up to ${maxBet.toLocaleString()} chips.`);
      return;
    }
    setMinesBusy(true);
    try {
      const res = await fetch(`${apiBase}/gambling/mines/start`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`},
        body: JSON.stringify({casino_id: selectedCasino.id, bet: betNum, mines: minesNum}),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Could not start game');
      setChips(data.chips);
      setMinesActive(true);
      setMinesRevealed(new Set());
      setMinesHit(null);
      setMinesMultiplier(1);
      setMinesResultText(null);
      setMinesResultKind(null);
    } catch (err: any) {
      setMinesError(err.message || 'Could not start game');
    } finally {
      setMinesBusy(false);
    }
  }, [apiBase, token, selectedCasino, bet, mineCount, maxBet]);

  const handleMinesReveal = useCallback(
    async (tile: number) => {
      if (!minesActive || minesBusy || minesRevealed.has(tile)) return;
      setMinesBusy(true);
      setMinesError(null);
      try {
        const res = await fetch(`${apiBase}/gambling/mines/reveal`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`},
          body: JSON.stringify({tile}),
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Reveal failed');
        if (data.hit) {
          setMinesHit(tile);
          setMinesActive(false);
          setMinesResultKind('lose');
          setMinesResultText(`Hit a mine. Net: ${data.net.toLocaleString()}`);
        } else {
          setMinesRevealed(new Set(data.revealed));
          setMinesMultiplier(data.multiplier);
          if (data.all_safe_revealed) {
            setMinesActive(false);
            setMinesResultKind('win');
            setMinesResultText(`All safe tiles cleared at ${data.multiplier.toFixed(2)}x! Cash out to collect.`);
          }
        }
      } catch (err: any) {
        setMinesError(err.message || 'Reveal failed');
      } finally {
        setMinesBusy(false);
      }
    },
    [apiBase, token, minesActive, minesBusy, minesRevealed],
  );

  const handleMinesCashout = useCallback(async () => {
    if (!minesActive || minesRevealed.size === 0) return;
    setMinesBusy(true);
    setMinesError(null);
    try {
      const res = await fetch(`${apiBase}/gambling/mines/cashout`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`},
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Cash out failed');
      setChips(data.chips);
      setMinesActive(false);
      setMinesResultKind('win');
      const taxNote = data.tax_amount > 0 ? ` (after ${(data.tax_rate * 100).toFixed(0)}% tax: -${data.tax_amount.toLocaleString()})` : '';
      setMinesResultText(`Cashed out ${data.payout_after_tax.toLocaleString()} chips! Net: +${data.net.toLocaleString()}${taxNote}`);
    } catch (err: any) {
      setMinesError(err.message || 'Cash out failed');
    } finally {
      setMinesBusy(false);
    }
  }, [apiBase, token, minesActive, minesRevealed]);

  return (
    <Layout description="Multichat gambling — pick a casino, play the slots or mines">
      <div className={styles.page}>
        <div className={styles.header}>
          <span className={styles.title}>Gambling</span>
          {chips !== null && (
            <span className={styles.chips}>
              Chips: <span className={styles.chipsValue}>{chips.toLocaleString()}</span>
            </span>
          )}
        </div>

        {configError && <div className={styles.state}>{configError}</div>}
        {!configError && !config && <div className={styles.state}>Loading casinos…</div>}

        {config && (
          <>
            <div className={styles.tabs}>
              <button
                className={clsx(styles.tabButton, tab === 'slots' && styles.tabButtonActive)}
                onClick={() => setTab('slots')}>
                Slots
              </button>
              <button
                className={clsx(styles.tabButton, tab === 'mines' && styles.tabButtonActive)}
                onClick={() => setTab('mines')}>
                Mines
              </button>
            </div>

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
                        resetMines();
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
                    disabled={!selectedCasino || spinning || minesActive}
                    min={config.slot_min_bet}
                    max={maxBet}
                    onChange={(e) => setBet(e.target.value)}
                  />
                </div>
                <div className={styles.betHint}>
                  {selectedCasino
                    ? `Bet is capped at what ${selectedCasino.name} can currently pay out (${maxBet.toLocaleString()} chips). Bigger bets lower your odds.`
                    : 'Select a casino above, you may be limited on what you earn based on what casino you pick.'}
                </div>

                {tab === 'slots' && (
                  <>
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
                  </>
                )}

                {tab === 'mines' && (
                  <>
                    {!minesActive && (
                      <div className={styles.minesSetupRow}>
                        <label className={styles.minesLabel}>
                          Mines
                          <select
                            className={styles.minesSelect}
                            value={mineCount}
                            onChange={(e) => setMineCount(e.target.value)}
                            disabled={minesBusy}>
                            {Array.from({length: 24}, (_, i) => i + 1).map((n) => (
                              <option key={n} value={n}>
                                {n}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          className={styles.spinButton}
                          disabled={minesBusy || !selectedCasino}
                          onClick={handleMinesStart}>
                          {minesBusy ? 'Starting…' : 'Start game'}
                        </button>
                      </div>
                    )}

                    <div className={styles.minesGrid}>
                      {Array.from({length: MINES_GRID_SIZE}, (_, i) => i).map((i) => {
                        const revealed = minesRevealed.has(i);
                        const isHit = minesHit === i;
                        return (
                          <button
                            key={i}
                            className={clsx(
                              styles.minesTile,
                              revealed && styles.minesTileSafe,
                              isHit && styles.minesTileHit,
                            )}
                            disabled={!minesActive || minesBusy || revealed}
                            onClick={() => handleMinesReveal(i)}>
                            {isHit ? '💣' : revealed ? '💎' : ''}
                          </button>
                        );
                      })}
                    </div>

                    {minesActive && minesRevealed.size > 0 && (
                      <div className={styles.minesMultiplierRow}>
                        <span>Current multiplier: {minesMultiplier.toFixed(2)}x</span>
                        <button className={styles.cashoutButton} disabled={minesBusy} onClick={handleMinesCashout}>
                          Cash out
                        </button>
                      </div>
                    )}

                    {minesResultText && (
                      <div className={clsx(styles.resultText, minesResultKind === 'win' ? styles.win : styles.lose)}>
                        {minesResultText}
                      </div>
                    )}
                    {minesError && <div className={styles.errorText}>{minesError}</div>}
                  </>
                )}

                {!token && <div className={styles.signInNote}>Sign in (top right) to get chips and play.</div>}
              </div>

              <div className={styles.panel}>
                {tab === 'slots' ? (
                  <>
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
                  </>
                ) : (
                  <>
                    <div className={styles.panelTitle}>How mines works</div>
                    <div className={styles.payoutTable}>
                      <div className={styles.payoutRow}>
                        <span>25 tiles, pick how many are mines</span>
                      </div>
                      <div className={styles.payoutRow}>
                        <span>Each safe tile raises your multiplier</span>
                      </div>
                      <div className={styles.payoutRow}>
                        <span>Cash out any time, or hit a mine and lose the bet</span>
                      </div>
                    </div>
                  </>
                )}
                <div className={styles.taxNote}>
                  Winnings are taxed at <span className={styles.taxRate}>{(config.gambling_tax_rate * 100).toFixed(0)}%</span> (profit portion only).
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
