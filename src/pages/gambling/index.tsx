import {useEffect, useState, useCallback, useRef} from 'react';
import type {ReactNode} from 'react';
import clsx from 'clsx';
import Layout from '@theme/Layout';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import useBaseUrl from '@docusaurus/useBaseUrl';
import {AUTH_CHANGED_EVENT} from '../../theme/AuthWidget';

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
const DICE_FACES = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

// --- Slot reel spin mechanics (ported from rugplay's Slots.svelte) ---
const SYMBOL_HEIGHT = 64;
const REEL_FILLER_COUNTS = [18, 24, 30]; // more filler = longer visual spin, staggered per column
const REEL_SPIN_DURATIONS = [1400, 1750, 2100]; // ms, staggered so reels stop left-to-right

function randomSymbol(pool: string[]): string {
  return pool[Math.floor(Math.random() * pool.length)];
}

// Builds one reel column's strip with the final [top, mid, bottom] triplet embedded
// after a run of random filler symbols, plus a little trailing buffer.
function buildColumnStrip(
  finalTriplet: string[],
  pool: string[],
  fillerCount: number,
): { strip: string[]; targetIndex: number } {
  const strip: string[] = [];
  for (let i = 0; i < fillerCount; i++) strip.push(randomSymbol(pool));
  const targetIndex = strip.length;
  strip.push(...finalTriplet);
  for (let i = 0; i < 3; i++) strip.push(randomSymbol(pool));
  return {strip, targetIndex};
}


const TOKEN_KEY = 'multichat_session_token';
type Tab = 'slots' | 'coinflip' | 'dice' | 'mines';

function formatMoney(taxRate: number, taxAmount: number, payoutAfterTax: number, net: number): string {
  const taxNote = taxAmount > 0 ? ` (after ${(taxRate * 100).toFixed(0)}% tax: -${taxAmount.toLocaleString()})` : '';
  return `Won ${payoutAfterTax.toLocaleString()} coins! Net: +${net.toLocaleString()}${taxNote}`;
}

export default function GamblingPage(): ReactNode {
  const {siteConfig} = useDocusaurusContext();
  const apiBase = (siteConfig.customFields?.gamblingApiUrl as string) || '';
  const soundBaseUrl = useBaseUrl('/sound/');

  const [tab, setTab] = useState<Tab>('slots');

  const [config, setConfig] = useState<GamblingConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [coins, setCoins] = useState<number | null>(null);

  const [casinoId, setCasinoId] = useState<string | null>(null);
  const [bet, setBet] = useState<string>('');

  // Slots
  const [winningCells, setWinningCells] = useState<Set<string>>(new Set());
  const [reelStrips, setReelStrips] = useState<string[][]>([[], [], []]);
  const [reelPositions, setReelPositions] = useState<number[]>([0, 0, 0]);
  const [reelTransition, setReelTransition] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [spinFlash, setSpinFlash] = useState(false);
  const [resultText, setResultText] = useState<string | null>(null);
  const [resultKind, setResultKind] = useState<'win' | 'lose' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Coinflip
  const [side, setSide] = useState<'heads' | 'tails'>('heads');
  const [coinRotation, setCoinRotation] = useState(0);
  const [flipping, setFlipping] = useState(false);
  const [coinResultText, setCoinResultText] = useState<string | null>(null);
  const [coinResultKind, setCoinResultKind] = useState<'win' | 'lose' | null>(null);
  const [coinError, setCoinError] = useState<string | null>(null);

  // Dice
  const [pick, setPick] = useState(3);
  const [diceFace, setDiceFace] = useState(1);
  const [rolling, setRolling] = useState(false);
  const [diceResultText, setDiceResultText] = useState<string | null>(null);
  const [diceResultKind, setDiceResultKind] = useState<'win' | 'lose' | null>(null);
  const [diceError, setDiceError] = useState<string | null>(null);

  // Mines
  const [mineCount, setMineCount] = useState<string>('3');
  const [minesActive, setMinesActive] = useState(false);
  const [minesRevealed, setMinesRevealed] = useState<Set<number>>(new Set());
  const [poppingTile, setPoppingTile] = useState<number | null>(null);
  const [minesHit, setMinesHit] = useState<number | null>(null);
  const [minesShake, setMinesShake] = useState(false);
  const [minesMultiplier, setMinesMultiplier] = useState(1);
  const [minesBusy, setMinesBusy] = useState(false);
  const [minesResultText, setMinesResultText] = useState<string | null>(null);
  const [minesResultKind, setMinesResultKind] = useState<'win' | 'lose' | null>(null);
  const [minesError, setMinesError] = useState<string | null>(null);

  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setToken(window.localStorage.getItem(TOKEN_KEY));
    const syncToken = () => setToken(window.localStorage.getItem(TOKEN_KEY));
    window.addEventListener(AUTH_CHANGED_EVENT, syncToken);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, syncToken);
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

  useEffect(() => {
    if (config && reelStrips[0].length === 0) {
      const idleTriplet = [config.slot_symbols[0], config.slot_symbols[1], config.slot_symbols[2]];
      setReelStrips([idleTriplet, idleTriplet, idleTriplet]);
    }
  }, [config]);

  const loadWallet = useCallback(() => {
    if (!apiBase || !token) return;
    fetch(`${apiBase}/gambling/wallet`, {headers: {Authorization: `Bearer ${token}`}})
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => data.success && setCoins(data.coins))
      .catch(() => {});
  }, [apiBase, token]);

  useEffect(() => {
    loadWallet();
  }, [loadWallet]);

  const selectedCasino = config?.casinos.find((c) => c.id === casinoId) || null;
  const maxBet = selectedCasino
    ? Math.max(0, Math.min(config?.slot_max_bet ?? 0, selectedCasino.balance))
    : 0;

  const playSound = (sound: string) => {
    try {
      const audio = new Audio(`${soundBaseUrl}${sound}.mp3`);
      audio.play().catch(() => {});
    } catch {
    }
  };

  const flashWin = () => {
    setSpinFlash(true);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setSpinFlash(false), 700);
    playSound('cannon');
    playSound('win');
  };

  const resetGameState = () => {
    setResultText(null);
    setResultKind(null);
    setCoinResultText(null);
    setCoinResultKind(null);
    setDiceResultText(null);
    setDiceResultKind(null);
    resetMines();
  };

  // --- Slots ---
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
      setError(`${selectedCasino.name} can only cover a bet up to ${maxBet.toLocaleString()} coins.`);
      return;
    }

    setSpinning(true);
    setResultText(null);
    setResultKind(null);
    setWinningCells(new Set());
    playSound('background');

    // Kick the reels into motion immediately (small random nudge), matching
    // rugplay's "spinStartOffsets" so the reel is already moving before the
    // network response comes back.
    setReelTransition(false);
    setReelPositions((prev) => prev.map((p) => p - (Math.random() * 30 + 10)));

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

      const newGrid: string[][] = data.grid;
      const pool = config!.slot_symbols;

      // Build one strip per column (0,1,2) with that column's final
      // [top, mid, bottom] triplet embedded after a run of filler symbols.
      const built = [0, 1, 2].map((col) => {
        const triplet = [newGrid[0][col], newGrid[1][col], newGrid[2][col]];
        return buildColumnStrip(triplet, pool, REEL_FILLER_COUNTS[col]);
      });

      setReelStrips(built.map((b) => b.strip));

      REEL_SPIN_DURATIONS.forEach((duration) => {
        setTimeout(() => playSound('click'), duration);
      });

      // Let the DOM pick up the new (longer) strips at the current bumped
      // position first, then animate to the target on the next frame so the
      // transition actually plays.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setReelTransition(true);
          setReelPositions(built.map((b) => -(b.targetIndex * SYMBOL_HEIGHT)));
        });
      });

      const maxDuration = Math.max(...REEL_SPIN_DURATIONS);

      setTimeout(() => {
        setWinningCells(new Set((data.winning_cells || []).map((c: number[]) => `${c[0]}-${c[1]}`)));
        setCoins(data.coins);
        if (data.net > 0) {
          setResultKind('win');
          flashWin();
          setResultText(formatMoney(data.tax_rate, data.tax_amount, data.payout_after_tax, data.net));
        } else if (data.payout > 0) {
          setResultKind('lose');
          playSound('lose');
          setResultText(`You got ${data.payout_after_tax.toLocaleString()} coins back. Net: ${data.net.toLocaleString()}`);
        } else {
          setResultKind('lose');
          playSound('lose');
          setResultText(`No lines hit. Net: -${betNum.toLocaleString()}`);
        }
        setSpinning(false);

        // Snap (no transition) back to a small, equivalent position so the
        // strip never grows unbounded across repeated spins.
        setReelTransition(false);
        setReelStrips(built.map((b, i) => [newGrid[0][i], newGrid[1][i], newGrid[2][i]]));
        setReelPositions([0, 0, 0]);
      }, maxDuration + 150);
    } catch (err: any) {
      setError(err.message || 'Spin failed');
      setSpinning(false);
    }
  }, [apiBase, token, selectedCasino, bet, maxBet, config]);

  // --- Coinflip ---
  const handleFlip = useCallback(async () => {
    setCoinError(null);
    if (!token) {
      setCoinError('Sign in first (top right) to play.');
      return;
    }
    if (!selectedCasino) {
      setCoinError('Pick a casino to play against first.');
      return;
    }
    const betNum = Number(bet);
    if (!Number.isFinite(betNum) || betNum <= 0) {
      setCoinError('Enter a valid bet amount.');
      return;
    }
    if (betNum > maxBet) {
      setCoinError(`${selectedCasino.name} can only cover a bet up to ${maxBet.toLocaleString()} coins.`);
      return;
    }

    setFlipping(true);
    setCoinResultText(null);
    setCoinResultKind(null);
    playSound('flip');
    try {
      const res = await fetch(`${apiBase}/gambling/coinflip`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`},
        body: JSON.stringify({casino_id: selectedCasino.id, side, bet: betNum}),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Flip failed');

      const extraHalfSpins = data.result === side ? 6 : 7; // land on the correct face
      setCoinRotation((r) => r + extraHalfSpins * 180);

      setTimeout(() => {
        setCoins(data.coins);
        if (data.won) {
          setCoinResultKind('win');
          flashWin();
          setCoinResultText(formatMoney(data.tax_rate, data.tax_amount, data.payout_after_tax, data.net));
        } else {
          setCoinResultKind('lose');
          playSound('lose');
          setCoinResultText(`Landed on ${data.result}. Net: -${betNum.toLocaleString()}`);
        }
        setFlipping(false);
      }, 1000);
    } catch (err: any) {
      setCoinError(err.message || 'Flip failed');
      setFlipping(false);
    }
  }, [apiBase, token, selectedCasino, bet, maxBet, side]);

  // --- Dice ---
  const handleRoll = useCallback(async () => {
    setDiceError(null);
    if (!token) {
      setDiceError('Sign in first (top right) to play.');
      return;
    }
    if (!selectedCasino) {
      setDiceError('Pick a casino to play against first.');
      return;
    }
    const betNum = Number(bet);
    if (!Number.isFinite(betNum) || betNum <= 0) {
      setDiceError('Enter a valid bet amount.');
      return;
    }
    if (betNum > maxBet) {
      setDiceError(`${selectedCasino.name} can only cover a bet up to ${maxBet.toLocaleString()} coins.`);
      return;
    }

    setRolling(true);
    setDiceResultText(null);
    setDiceResultKind(null);
    playSound('click');
    try {
      const res = await fetch(`${apiBase}/gambling/dice`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`},
        body: JSON.stringify({casino_id: selectedCasino.id, pick, bet: betNum}),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Roll failed');

      // quick face cycle for a "rolling" feel, then land on the real result
      let ticks = 0;
      const tickInterval = setInterval(() => {
        setDiceFace(1 + Math.floor(Math.random() * 6));
        ticks += 1;
        if (ticks > 8) {
          clearInterval(tickInterval);
          setDiceFace(data.result);
          setCoins(data.coins);
          playSound('dice');
          if (data.won) {
            setDiceResultKind('win');
            flashWin();
            setDiceResultText(formatMoney(data.tax_rate, data.tax_amount, data.payout_after_tax, data.net));
          } else {
            setDiceResultKind('lose');
            playSound('lose');
            setDiceResultText(`Rolled ${data.result}. Net: -${betNum.toLocaleString()}`);
          }
          setRolling(false);
        }
      }, 80);
    } catch (err: any) {
      setDiceError(err.message || 'Roll failed');
      setRolling(false);
    }
  }, [apiBase, token, selectedCasino, bet, maxBet, pick]);

  // --- Mines ---
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
      setMinesError(`${selectedCasino.name} can only cover a bet up to ${maxBet.toLocaleString()} coins.`);
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
      setCoins(data.coins);
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
          setMinesShake(true);
          setTimeout(() => setMinesShake(false), 500);
          setMinesActive(false);
          setMinesResultKind('lose');
          playSound('lose');
          setMinesResultText(`Hit a mine. Net: ${data.net.toLocaleString()}`);
        } else {
          setPoppingTile(tile);
          setTimeout(() => setPoppingTile(null), 300);
          setMinesRevealed(new Set(data.revealed));
          setMinesMultiplier(data.multiplier);
          playSound('flip');
          if (data.all_safe_revealed) {
            setMinesActive(false);
            setMinesResultKind('win');
            flashWin();
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
      setCoins(data.coins);
      setMinesActive(false);
      setMinesResultKind('win');
      flashWin();
      setMinesResultText(formatMoney(data.tax_rate, data.tax_amount, data.payout_after_tax, data.net));
    } catch (err: any) {
      setMinesError(err.message || 'Cash out failed');
    } finally {
      setMinesBusy(false);
    }
  }, [apiBase, token, minesActive, minesRevealed]);

  const onPickCasino = (id: string) => {
    setCasinoId(id);
    setBet('');
    setError(null);
    setCoinError(null);
    setDiceError(null);
    setMinesError(null);
    resetGameState();
  };

  const onChangeTab = (next: Tab) => {
    setTab(next);
  };

  const busy = spinning || flipping || rolling || minesBusy;

  return (
    <Layout description="Multichat gambling arcade — slots, coinflip, dice, and mines">
      <div className={styles.page}>
        <div className={styles.header}>
          <span className={styles.title}>Gambling</span>
          {coins !== null && (
            <span className={styles.chips}>
              Coins: <span className={styles.chipsValue}>{coins.toLocaleString()}</span>
            </span>
          )}
        </div>

        {configError && <div className={styles.state}>{configError}</div>}
        {!configError && !config && <div className={styles.state}>Loading casinos…</div>}

        {config && (
          <>
            <div className={styles.tabs}>
              <button className={clsx(styles.tabButton, tab === 'slots' && styles.tabButtonActive)} onClick={() => onChangeTab('slots')}>
                Slots
              </button>
              <button className={clsx(styles.tabButton, tab === 'coinflip' && styles.tabButtonActive)} onClick={() => onChangeTab('coinflip')}>
                Coinflip
              </button>
              <button className={clsx(styles.tabButton, tab === 'dice' && styles.tabButtonActive)} onClick={() => onChangeTab('dice')}>
                Dice
              </button>
              <button className={clsx(styles.tabButton, tab === 'mines' && styles.tabButtonActive)} onClick={() => onChangeTab('mines')}>
                Mines
              </button>
            </div>

            <div className={styles.layout}>
              <div className={clsx(styles.panel, spinFlash && styles.panelFlash)}>
                <div className={styles.panelTitle}>Choose a casino</div>
                {config.casinos.length === 0 && <div className={styles.state}>No casino companies exist yet.</div>}
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
                      onClick={() => onPickCasino(c.id)}>
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
                    disabled={!selectedCasino || busy || minesActive}
                    min={config.slot_min_bet}
                    max={maxBet}
                    onChange={(e) => setBet(e.target.value)}
                  />
                </div>
                <div className={styles.betHint}>
                  {selectedCasino
                    ? `Bet is capped at what ${selectedCasino.name} can currently pay out (${maxBet.toLocaleString()} coins). Bigger bets lower your odds.`
                    : 'Select a casino above, you may be limited on what you earn based on what casino you pick.'}
                </div>

                {tab === 'slots' && (
                  <>
                    <button className={styles.spinButton} disabled={spinning || !selectedCasino} onClick={handleSpin}>
                      {spinning ? 'Spinning…' : 'Spin'}
                    </button>
                    <div className={styles.reel}>
                      {[0, 1, 2].map((col) => (
                        <div className={styles.reelColumn} key={col}>
                          <div
                            className={styles.reelStrip}
                            style={{
                              transform: `translateY(${reelPositions[col]}px)`,
                              transition: reelTransition
                                ? `transform ${REEL_SPIN_DURATIONS[col]}ms cubic-bezier(0.17, 0.67, 0.16, 0.99)`
                                : 'none',
                            }}>
                            {reelStrips[col].map((sym, row) => {
                              const cellKey = `${row}-${col}`;
                              return (
                                <div
                                  key={row}
                                  className={clsx(styles.cell, !spinning && winningCells.has(cellKey) && styles.cellWin)}>
                                  {sym}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                    {resultText && (
                      <div className={clsx(styles.resultText, resultKind === 'win' ? styles.win : styles.lose)}>{resultText}</div>
                    )}
                    {error && <div className={styles.errorText}>{error}</div>}
                  </>
                )}

                {tab === 'coinflip' && (
                  <>
                    <div className={styles.sideRow}>
                      <button
                        className={clsx(styles.sideButton, side === 'heads' && styles.sideButtonActive)}
                        disabled={flipping}
                        onClick={() => setSide('heads')}>
                        Heads
                      </button>
                      <button
                        className={clsx(styles.sideButton, side === 'tails' && styles.sideButtonActive)}
                        disabled={flipping}
                        onClick={() => setSide('tails')}>
                        Tails
                      </button>
                    </div>
                    <div className={styles.coinStage}>
                      <div className={styles.coin} style={{transform: `rotateY(${coinRotation}deg)`}}>
                        <div className={clsx(styles.coinFace, styles.coinHeads)}>H</div>
                        <div className={clsx(styles.coinFace, styles.coinTails)}>T</div>
                      </div>
                    </div>
                    <button className={styles.spinButton} disabled={flipping || !selectedCasino} onClick={handleFlip}>
                      {flipping ? 'Flipping…' : 'Flip'}
                    </button>
                    {coinResultText && (
                      <div className={clsx(styles.resultText, coinResultKind === 'win' ? styles.win : styles.lose)}>
                        {coinResultText}
                      </div>
                    )}
                    {coinError && <div className={styles.errorText}>{coinError}</div>}
                  </>
                )}

                {tab === 'dice' && (
                  <>
                    <div className={styles.diceRow}>
                      {[1, 2, 3, 4, 5, 6].map((n) => (
                        <button
                          key={n}
                          className={clsx(styles.diceNumberButton, pick === n && styles.diceNumberButtonActive)}
                          disabled={rolling}
                          onClick={() => setPick(n)}>
                          {n}
                        </button>
                      ))}
                    </div>
                    <div className={styles.diceStage}>
                      <div className={clsx(styles.die, rolling && styles.dieRolling)}>{DICE_FACES[diceFace]}</div>
                    </div>
                    <button className={styles.spinButton} disabled={rolling || !selectedCasino} onClick={handleRoll}>
                      {rolling ? 'Rolling…' : 'Roll'}
                    </button>
                    {diceResultText && (
                      <div className={clsx(styles.resultText, diceResultKind === 'win' ? styles.win : styles.lose)}>
                        {diceResultText}
                      </div>
                    )}
                    {diceError && <div className={styles.errorText}>{diceError}</div>}
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
                        <button className={styles.spinButton} disabled={minesBusy || !selectedCasino} onClick={handleMinesStart}>
                          {minesBusy ? 'Starting…' : 'Start game'}
                        </button>
                      </div>
                    )}
                    <div className={clsx(styles.minesGrid, minesShake && styles.minesGridShake)}>
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
                              poppingTile === i && styles.minesTilePop,
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

                {!token && <div className={styles.signInNote}>Sign in (top right) to get coins and play.</div>}
              </div>

              <div className={styles.panel}>
                {tab === 'slots' && (
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
                )}
                {tab === 'coinflip' && (
                  <>
                    <div className={styles.panelTitle}>How coinflip works</div>
                    <div className={styles.payoutTable}>
                      <div className={styles.payoutRow}>
                        <span>Pick heads or tails</span>
                      </div>
                      <div className={styles.payoutRow}>
                        <span>Correct answer pays around 2x</span>
                      </div>
                    </div>
                  </>
                )}
                {tab === 'dice' && (
                  <>
                    <div className={styles.panelTitle}>How dice works</div>
                    <div className={styles.payoutTable}>
                      <div className={styles.payoutRow}>
                        <span>Call a number 1-6</span>
                      </div>
                      <div className={styles.payoutRow}>
                        <span>Correct answer pays around 6x.</span>
                      </div>
                    </div>
                  </>
                )}
                {tab === 'mines' && (
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
