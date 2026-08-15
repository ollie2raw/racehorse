import type { TableOffer, HandResult } from './stakesEconomy';
import {
  generateOffersForStage,
  evaluateContractWithOffer,
} from './stakesEconomy';

export type StakesPhase =
  | 'lobby'
  | 'offer'
  | 'table_active'
  | 'settlement'
  | 'cash_out_decision'
  | 'results';

export interface SettlementEntry {
  stage: number;
  tableTitle: string;
  rivalLabel: string;
  entry: number;
  won: boolean;
  victoryReturn: number;
  contractLabel: string;
  contractCompleted: boolean;
  contractBonus: number;
  netChange: number;
  purseBefore: number;
  purseAfter: number;
}

export interface StakesRunState {
  seed: string;
  currentPurse: number;
  currentStage: 1 | 2 | 3;
  phase: StakesPhase;
  offers: TableOffer[];
  selectedOffer: TableOffer | null;
  banked: boolean;
  busted: boolean;
  completed: boolean;
  settlementHistory: SettlementEntry[];
}

export type StakesAction =
  | { type: 'START_RUN'; seed: string }
  | { type: 'CHOOSE_OFFER'; offerId: string }
  | { type: 'SETTLE_HAND'; result: HandResult }
  | { type: 'DECIDE_CASH_OUT'; action: 'bank' | 'continue' }
  | { type: 'PROCEED_FROM_SETTLEMENT' }
  | { type: 'RESET_RUN' }
  // Dev control overrides
  | { type: 'DEV_FORCE_WIN' }
  | { type: 'DEV_FORCE_LOSS' }
  | { type: 'DEV_FORCE_CONTRACT', completed: boolean }
  | { type: 'DEV_JUMP_TO_SETTLEMENT' }
  | { type: 'DEV_JUMP_TO_CASH_OUT' };

export const INITIAL_STAKES_STATE: StakesRunState = {
  seed: '',
  currentPurse: 500,
  currentStage: 1,
  phase: 'lobby',
  offers: [],
  selectedOffer: null,
  banked: false,
  busted: false,
  completed: false,
  settlementHistory: [],
};

export function stakesReducer(state: StakesRunState, action: StakesAction): StakesRunState {
  switch (action.type) {
    case 'START_RUN': {
      const startSeed = action.seed || Math.random().toString(36).substring(2);
      const stage1Offers = generateOffersForStage(1, startSeed);
      return {
        ...INITIAL_STAKES_STATE,
        seed: startSeed,
        currentPurse: 500,
        currentStage: 1,
        phase: 'offer',
        offers: stage1Offers,
      };
    }

    case 'CHOOSE_OFFER': {
      if (state.phase !== 'offer') return state;
      const offer = state.offers.find((o) => o.id === action.offerId);
      if (!offer) return state;
      if (state.currentPurse < offer.entry) {
        // Can't afford
        return state;
      }
      return {
        ...state,
        selectedOffer: offer,
        phase: 'table_active',
        currentPurse: state.currentPurse - offer.entry,
      };
    }

    case 'SETTLE_HAND': {
      if (state.phase !== 'table_active' || !state.selectedOffer) return state;
      const offer = state.selectedOffer;
      const result = action.result;

      const won = result.won;
      const contractCompleted = won && evaluateContractWithOffer(offer, result);
      
      const entryFee = offer.entry;
      const victoryReturn = won ? offer.baseReturn : 0;
      const contractBonus = contractCompleted ? offer.contractBonus : 0;
      const grossReturn = victoryReturn + contractBonus;
      const netChange = grossReturn - entryFee;
      
      const purseBefore = state.currentPurse + entryFee; // purse before entry deduction
      const purseAfter = state.currentPurse + grossReturn;

      const entry: SettlementEntry = {
        stage: state.currentStage,
        tableTitle: offer.riskLabel === 'Low' ? 'THE ROOKIE' : offer.riskLabel === 'Medium' ? 'THE GRINDER' : 'THE CLOSER',
        rivalLabel: offer.rivalLabel,
        entry: entryFee,
        won,
        victoryReturn,
        contractLabel: offer.contractLabel,
        contractCompleted,
        contractBonus,
        netChange,
        purseBefore,
        purseAfter,
      };

      const nextPurse = purseAfter;
      const nextHistory = [...state.settlementHistory, entry];
      
      // Determine next state
      if (nextPurse <= 0) {
        // Busted
        return {
          ...state,
          currentPurse: 0,
          phase: 'results',
          busted: true,
          settlementHistory: nextHistory,
        };
      }

      // If at Stage 3, the run completes
      if (state.currentStage === 3) {
        return {
          ...state,
          currentPurse: nextPurse,
          phase: 'results',
          completed: true,
          settlementHistory: nextHistory,
        };
      }

      // check if the player can afford either of the two offers for the next stage
      const nextStage = (state.currentStage + 1) as 2 | 3;
      const nextOffers = generateOffersForStage(nextStage, state.seed);
      const minEntry = Math.min(...nextOffers.map((o) => o.entry));

      if (nextPurse < minEntry) {
        // Busted because can't afford next table
        return {
          ...state,
          currentPurse: nextPurse,
          phase: 'results',
          busted: true,
          settlementHistory: nextHistory,
        };
      }

      return {
        ...state,
        currentPurse: nextPurse,
        phase: 'settlement',
        settlementHistory: nextHistory,
      };
    }

    case 'DECIDE_CASH_OUT': {
      if (state.phase !== 'cash_out_decision') return state;

      if (action.action === 'bank') {
        return {
          ...state,
          phase: 'results',
          banked: true,
        };
      } else {
        // Continue to Stage 3 (Finale)
        const stage3Offers = generateOffersForStage(3, state.seed);
        return {
          ...state,
          currentStage: 3,
          phase: 'offer',
          offers: stage3Offers,
          selectedOffer: null,
        };
      }
    }

    case 'PROCEED_FROM_SETTLEMENT': {
      if (state.phase !== 'settlement') return state;
      if (state.currentStage === 1) {
        const stage2Offers = generateOffersForStage(2, state.seed);
        return {
          ...state,
          currentStage: 2,
          phase: 'offer',
          offers: stage2Offers,
          selectedOffer: null,
        };
      } else if (state.currentStage === 2) {
        return {
          ...state,
          phase: 'cash_out_decision',
        };
      }
      return state;
    }

    case 'RESET_RUN': {
      return INITIAL_STAKES_STATE;
    }

    // DEV CONTROLS
    case 'DEV_FORCE_WIN': {
      if (state.phase !== 'table_active' || !state.selectedOffer) return state;
      const mockResult: HandResult = {
        won: true,
        scoreMargin: 10,
        youGoOut: true,
        botPassCount: 1,
        youScoreFirst: true,
        youScore: 25,
        botScore: 15,
      };
      return stakesReducer(state, { type: 'SETTLE_HAND', result: mockResult });
    }

    case 'DEV_FORCE_LOSS': {
      if (state.phase !== 'table_active' || !state.selectedOffer) return state;
      const mockResult: HandResult = {
        won: false,
        scoreMargin: -10,
        youGoOut: false,
        botPassCount: 0,
        youScoreFirst: false,
        youScore: 10,
        botScore: 20,
      };
      return stakesReducer(state, { type: 'SETTLE_HAND', result: mockResult });
    }

    case 'DEV_FORCE_CONTRACT': {
      if (state.phase !== 'table_active' || !state.selectedOffer) return state;
      const mockResult: HandResult = {
        won: true,
        scoreMargin: action.completed ? 15 : 0, // 15 satisfies marginCall, others satisfy custom evaluation
        youGoOut: action.completed, // satisfies closeHand
        botPassCount: action.completed ? 2 : 0, // satisfies forcePass
        youScoreFirst: action.completed, // satisfies firstBlood
        youScore: action.completed ? 30 : 20,
        botScore: action.completed ? 15 : 20,
      };
      return stakesReducer(state, { type: 'SETTLE_HAND', result: mockResult });
    }

    case 'DEV_JUMP_TO_SETTLEMENT': {
      if (state.phase !== 'table_active' || !state.selectedOffer) return state;
      return stakesReducer(state, {
        type: 'SETTLE_HAND',
        result: {
          won: true,
          scoreMargin: 12,
          youGoOut: false,
          botPassCount: 1,
          youScoreFirst: true,
          youScore: 25,
          botScore: 13,
        },
      });
    }

    case 'DEV_JUMP_TO_CASH_OUT': {
      // Create a mock state at cash_out_decision phase
      const s1Offer = generateOffersForStage(1, state.seed || 'dev')[0];
      const s2Offer = generateOffersForStage(2, state.seed || 'dev')[0];
      const mockHistory: SettlementEntry[] = [
        {
          stage: 1,
          tableTitle: 'THE ROOKIE',
          rivalLabel: s1Offer.rivalLabel,
          entry: s1Offer.entry,
          won: true,
          victoryReturn: s1Offer.baseReturn,
          contractLabel: s1Offer.contractLabel,
          contractCompleted: true,
          contractBonus: s1Offer.contractBonus,
          netChange: s1Offer.baseReturn + s1Offer.contractBonus - s1Offer.entry,
          purseBefore: 500,
          purseAfter: 500 + s1Offer.baseReturn + s1Offer.contractBonus - s1Offer.entry,
        },
        {
          stage: 2,
          tableTitle: 'THE GRINDER',
          rivalLabel: s2Offer.rivalLabel,
          entry: s2Offer.entry,
          won: true,
          victoryReturn: s2Offer.baseReturn,
          contractLabel: s2Offer.contractLabel,
          contractCompleted: false,
          contractBonus: 0,
          netChange: s2Offer.baseReturn - s2Offer.entry,
          purseBefore: 500 + s1Offer.baseReturn + s1Offer.contractBonus - s1Offer.entry,
          purseAfter: 500 + s1Offer.baseReturn + s1Offer.contractBonus - s1Offer.entry + s2Offer.baseReturn - s2Offer.entry,
        }
      ];
      const finalPurse = mockHistory[1].purseAfter;

      return {
        ...state,
        currentPurse: finalPurse,
        currentStage: 2,
        phase: 'cash_out_decision',
        settlementHistory: mockHistory,
        selectedOffer: s2Offer,
      };
    }

    default:
      return state;
  }
}
