import React from 'react';
import './StakesScreen.css';
import type { StakesAction, StakesRunState } from './stakesRunState';
import type { TableOffer } from './stakesEconomy';
import { runStakesSimulation } from './stakesEconomy';

interface StakesScreenProps {
  userId: string | null;
  onBack: () => void;
  onStartMatch: (offer: TableOffer, onHandComplete: (won: boolean, stats: {
    scoreMargin: number;
    youGoOut: boolean;
    botPassCount: number;
    youScoreFirst: boolean;
    youScore: number;
    botScore: number;
  }) => void) => void;
  runState: StakesRunState;
  dispatch: React.Dispatch<StakesAction>;
}

export default function StakesScreen({
  userId: _userId,
  onBack,
  onStartMatch,
  runState,
  dispatch,
}: StakesScreenProps) {
  const handleStartRun = () => {
    dispatch({ type: 'START_RUN', seed: `run-${Date.now()}` });
  };

  const handleChooseOffer = (offerId: string) => {
    const offer = runState.offers.find((o) => o.id === offerId);
    if (!offer) return;
    
    // First transition to table_active in runState
    dispatch({ type: 'CHOOSE_OFFER', offerId });

    // Then start the match
    onStartMatch(offer, (won, stats) => {
      dispatch({
        type: 'SETTLE_HAND',
        result: {
          won,
          scoreMargin: stats.scoreMargin,
          youGoOut: stats.youGoOut,
          botPassCount: stats.botPassCount,
          youScoreFirst: stats.youScoreFirst,
          youScore: stats.youScore,
          botScore: stats.botScore,
        },
      });
    });
  };

  const handleDecideCashOut = (action: 'bank' | 'continue') => {
    dispatch({ type: 'DECIDE_CASH_OUT', action });
  };

  const handleReset = () => {
    dispatch({ type: 'RESET_RUN' });
  };

  const runSim = () => {
    const results = runStakesSimulation(1000, 0.65, 0.45, 'safe', 'bank_under_500');
    alert(
      `Stakes Mode Simulation (1000 runs, 65% win rate, 45% contract rate):\n` +
      `- Average final purse: ${Math.round(results.averageFinalPurse)}\n` +
      `- Bust rate: ${Math.round(results.bustRate * 100)}%\n` +
      `- Reached finale rate: ${Math.round(results.reachedFinaleRate * 100)}%\n` +
      `- Expected banked at stage 2: ${Math.round(results.expectedBankedAtStage2)}\n` +
      `- Expected finale purse: ${Math.round(results.expectedFinalePurse)}`
    );
  };

  return (
    <div className="stakes-page">
      {/* Dev Controls Bar */}
      {import.meta.env.DEV && (
        <div className="stakes-dev-bar">
          <span className="stakes-dev-label">Stakes Dev Controls:</span>
          <button className="stakes-dev-btn" onClick={runSim}>Run 1K Sim</button>
          <button className="stakes-dev-btn" onClick={() => dispatch({ type: 'DEV_JUMP_TO_CASH_OUT' })}>Jump to Stage 2 Cash-out</button>
          <button className="stakes-dev-btn" onClick={() => {
            const pb = localStorage.getItem('stakes_pb');
            localStorage.removeItem('stakes_pb');
            alert(`Reset personal best (was: ${pb})`);
          }}>Reset records</button>
        </div>
      )}

      {/* Main Content */}
      <div className="stakes-content-wrapper">
        {/* Lobby Screen */}
        {runState.phase === 'lobby' && (
          <div className="stakes-lobby-layout">
            <header className="stakes-lobby-hero">
              <h1 className="stakes-header-title">The Stakes</h1>
              <p className="mt-3 text-[14px] tracking-[0.2em] text-[#727083] uppercase font-black">
                Founder Prototype
              </p>
            </header>
            <p className="stakes-lobby-desc">
              Choose a table, play one authentic hand, settle the contract, and decide: Bank your purse or risk it in the finale.
            </p>
            <div className="stakes-lobby-purse-box">
              <span className="stakes-results-purse-lbl">Starting Purse</span>
              <div className="stakes-lobby-purse-num">500</div>
            </div>
            <div style={{ display: 'flex', gap: '1rem', width: '320px' }}>
              <button className="stakes-action-btn" onClick={handleStartRun}>
                Start Run
              </button>
              <button className="stakes-action-btn stakes-btn-secondary" onClick={onBack}>
                Back
              </button>
            </div>
          </div>
        )}

        {/* Offer screen */}
        {runState.phase === 'offer' && (
          <div className="stakes-offers-container">
            <div className="stakes-header">
              <h2 className="stakes-header-title">Stage {runState.currentStage} offers</h2>
              <div className="stakes-hud-purse">
                <span className="stakes-hud-purse-label">Purse:</span>
                <span className="stakes-hud-purse-value">{runState.currentPurse}</span>
              </div>
            </div>
            <div className="stakes-offers-title-block">
              <p className="text-[18px] text-[#7a778a]">
                {runState.currentStage === 3 
                  ? "The final high-risk table. No banking from here on." 
                  : "Choose your table contract. Lower risk offers safer returns; higher risk pays out a premium."}
              </p>
            </div>
            <div className="stakes-offers-grid">
              {runState.offers.map((offer) => {
                const canAfford = runState.currentPurse >= offer.entry;
                const cardClass = offer.rival === 'rookie' ? 'is-rookie' : offer.rival === 'closer' ? 'is-closer' : 'is-grinder';
                return (
                  <div key={offer.id} className={`stakes-offer-card ${cardClass}`}>
                    <span className={`stakes-card-tag ${offer.riskLabel.toLowerCase()}`}>
                      {offer.riskLabel} Risk
                    </span>
                    <h3 className="stakes-offer-title">{offer.rivalLabel}</h3>
                    <span className="stakes-offer-subtitle">
                      {offer.difficulty.toUpperCase()} • {offer.policyProfile}
                    </span>
                    <p className="stakes-offer-desc">{offer.description}</p>
                    <div className="stakes-offer-details">
                      <div className="stakes-detail-row">
                        <span className="stakes-detail-label">Entry Fee</span>
                        <span className="stakes-detail-val entry">-{offer.entry}</span>
                      </div>
                      <div className="stakes-detail-row">
                        <span className="stakes-detail-label">Victory Payout</span>
                        <span className="stakes-detail-val">+{offer.baseReturn}</span>
                      </div>
                      <div className="stakes-detail-row">
                        <span className="stakes-detail-label">Contract: {offer.contractLabel}</span>
                        <span className="stakes-detail-val bonus">+{offer.contractBonus}</span>
                      </div>
                    </div>
                    <button
                      className="stakes-action-btn"
                      disabled={!canAfford}
                      onClick={() => handleChooseOffer(offer.id)}
                    >
                      {canAfford ? 'Sit at Table' : 'Insufficient Purse'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Settlement screen */}
        {runState.phase === 'settlement' && runState.settlementHistory.length > 0 && (
          <div className="stakes-settle-layout">
            <header className="mb-8 text-center">
              <h2 className="stakes-header-title">Table Settle</h2>
              <p className="text-[#7a778a]">Stage {runState.currentStage} complete</p>
            </header>
            
            {(() => {
              const entry = runState.settlementHistory[runState.settlementHistory.length - 1];
              return (
                <div className="stakes-settle-card">
                  <div className="stakes-settle-outcome">
                    <h3 className={`stakes-outcome-text ${entry.won ? 'win' : 'loss'}`}>
                      {entry.won ? 'Victory' : 'Defeat'}
                    </h3>
                    <p className="stakes-outcome-sub">
                      Rival: {entry.rivalLabel}
                    </p>
                  </div>

                  <div className="stakes-settle-ledger">
                    <div className="stakes-ledger-row">
                      <span className="stakes-detail-label">Table Buy-in</span>
                      <span className="stakes-ledger-val neg">-{entry.entry}</span>
                    </div>
                    <div className="stakes-ledger-row">
                      <span className="stakes-detail-label">Base Victory Return</span>
                      <span className="stakes-ledger-val pos">+{entry.victoryReturn}</span>
                    </div>
                    <div className="stakes-ledger-row">
                      <span className="stakes-detail-label">Contract: {entry.contractLabel}</span>
                      <span className={`stakes-ledger-val ${entry.contractCompleted ? 'pos' : 'neg'}`}>
                        {entry.contractCompleted ? `+${entry.contractBonus}` : '+0'}
                      </span>
                    </div>
                    <div className="stakes-ledger-row total">
                      <span className="stakes-detail-label">Net Table Change</span>
                      <span className={`stakes-ledger-val ${entry.netChange >= 0 ? 'pos' : 'neg'}`}>
                        {entry.netChange >= 0 ? '+' : ''}{entry.netChange}
                      </span>
                    </div>
                  </div>

                  <div className="stakes-hud-purse" style={{ justifyContent: 'space-between', marginBottom: '2rem' }}>
                    <span className="stakes-hud-purse-label">New Purse Balance:</span>
                    <span className="stakes-hud-purse-value">{runState.currentPurse}</span>
                  </div>

                  <button
                    className="stakes-action-btn"
                    onClick={() => dispatch({ type: 'PROCEED_FROM_SETTLEMENT' })}
                  >
                      {runState.currentStage === 2 ? 'Proceed to Cash-out Decision' : 'Proceed to Stage Offers'}
                    </button>
                  </div>
                );
              })()}
          </div>
        )}

        {/* Cash out decision screen */}
        {runState.phase === 'cash_out_decision' && (
          <div className="stakes-decision-layout">
            <h2 className="stakes-decision-title">Stage 2 Cash-out Decision</h2>
            <p className="text-[18px] text-[#7a778a] text-center mb-8">
              You have completed Stage 2. Choose whether to secure your winnings or risk it all in the high-stakes finale.
            </p>
            <div className="stakes-decision-grid">
              <div className="stakes-decision-panel">
                <div>
                  <h3 className="stakes-decision-label">Bank the Purse</h3>
                  <div className="stakes-decision-amount gold">{runState.currentPurse}</div>
                  <p className="stakes-decision-desc">
                    Secure your current winnings. This will complete your run and record your score.
                  </p>
                </div>
                <button
                  className="stakes-action-btn"
                  onClick={() => handleDecideCashOut('bank')}
                >
                  Bank & Exit
                </button>
              </div>

              <div className="stakes-decision-panel risk">
                <div>
                  <h3 className="stakes-decision-label">Risk the Finale</h3>
                  <div className="stakes-decision-amount">Stage 3</div>
                  <p className="stakes-decision-desc">
                    Enter the high-risk Finale against the Master. Table entry is ~260. Large potential return but no safety net.
                  </p>
                </div>
                <button
                  className="stakes-action-btn stakes-btn-secondary"
                  onClick={() => handleDecideCashOut('continue')}
                >
                  Enter Finale
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Results screen */}
        {runState.phase === 'results' && (
          <div className="stakes-results-layout">
            <div className="stakes-results-card">
              <h2 className="stakes-results-title">
                {runState.banked ? 'Run Banked' : runState.completed ? 'Run Completed' : 'Run Lost (Busted)'}
              </h2>
              <span className="stakes-results-purse-lbl">Final Purse Balance</span>
              <div className="stakes-results-purse-val">{runState.currentPurse}</div>

              {(() => {
                const totalWins = runState.settlementHistory.filter((e) => e.won).length;
                const totalContracts = runState.settlementHistory.filter((e) => e.contractCompleted).length;
                const maxReturn = runState.settlementHistory.reduce((max, e) => Math.max(max, e.victoryReturn), 0);
                
                // Track personal best
                let personalBest = 0;
                const storedPb = localStorage.getItem('stakes_pb');
                if (storedPb) personalBest = parseInt(storedPb, 10);
                if (runState.currentPurse > personalBest && !runState.busted) {
                  personalBest = runState.currentPurse;
                  localStorage.setItem('stakes_pb', String(personalBest));
                }

                return (
                  <>
                    <div className="stakes-results-stats">
                      <div className="stakes-detail-row">
                        <span className="stakes-detail-label">Tables Won</span>
                        <span className="stakes-detail-val">{totalWins} / {runState.settlementHistory.length}</span>
                      </div>
                      <div className="stakes-detail-row">
                        <span className="stakes-detail-label">Contracts Completed</span>
                        <span className="stakes-detail-val">{totalContracts}</span>
                      </div>
                      <div className="stakes-detail-row">
                        <span className="stakes-detail-label">Biggest Table Return</span>
                        <span className="stakes-detail-val">{maxReturn}</span>
                      </div>
                      <div className="stakes-detail-row">
                        <span className="stakes-detail-label">Personal Best (Banked)</span>
                        <span className="stakes-detail-val font-bold text-[#d7a64a]">{personalBest}</span>
                      </div>
                    </div>
                  </>
                );
              })()}

              <div style={{ display: 'flex', gap: '1rem' }}>
                <button className="stakes-action-btn" onClick={handleReset}>
                  Play Again
                </button>
                <button className="stakes-action-btn stakes-btn-secondary" onClick={onBack}>
                  Return to SP Hub
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
