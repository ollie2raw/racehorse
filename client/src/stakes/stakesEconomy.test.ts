import { describe, it, expect } from 'vitest';
import { generateOffersForStage, runStakesSimulation } from './stakesEconomy';

describe('Stakes Economy', () => {
  it('should generate valid offers for stage 1', () => {
    const offers = generateOffersForStage(1, 'test-seed');
    expect(offers.length).toBe(2);
    expect(offers[0].id).toBe('s1_safe');
    expect(offers[1].id).toBe('s1_risky');
    expect(offers[0].entry).toBeLessThan(offers[1].entry);
    expect(offers[0].baseReturn).toBeLessThan(offers[1].baseReturn);
    expect(offers[0].riskLabel).toBe('Low');
    expect(offers[1].riskLabel).toBe('Medium');
  });

  it('should generate valid offers for stage 2', () => {
    const offers = generateOffersForStage(2, 'test-seed');
    expect(offers.length).toBe(2);
    expect(offers[0].id).toBe('s2_safe');
    expect(offers[1].id).toBe('s2_risky');
    expect(offers[0].riskLabel).toBe('Medium');
    expect(offers[1].riskLabel).toBe('High');
  });

  it('should generate a single high-risk offer for stage 3', () => {
    const offers = generateOffersForStage(3, 'test-seed');
    expect(offers.length).toBe(1);
    expect(offers[0].id).toBe('s3_finale');
    expect(offers[0].riskLabel).toBe('High');
  });

  it('should run simulation and return deterministic statistics', () => {
    const results = runStakesSimulation(100, 0.65, 0.45, 'safe', 'bank_under_500');
    expect(results.runs.length).toBe(100);
    expect(results.averageFinalPurse).toBeGreaterThanOrEqual(0);
    expect(results.bustRate).toBeGreaterThanOrEqual(0);
    expect(results.reachedFinaleRate).toBeGreaterThanOrEqual(0);
  });
});
