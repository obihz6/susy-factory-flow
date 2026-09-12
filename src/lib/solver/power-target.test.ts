import { describe, expect, it } from 'vitest';
import type { FactoryNode, Recipe } from '@/lib/model/types';
import { getMachineStructuralParallels } from './machine-effects';
import { getNodePowerReport } from './power-report';
import { fullParallelPowerWin, listPowerWinsCached, nextPowerWin, powerNodeAtBudget } from './power-wins';

const recipe: Recipe = { id: 'parallel-target', name: 'Parallel target', machineType: 'Industrial Centrifuge', minimumTier: 'HV', durationTicks: 400, eut: 480, inputs: [], outputs: [] };
const node: FactoryNode = { id: 'n', recipeId: recipe.id, machineCount: 1, parallel: 1, overclockTier: 'HV', hatchVoltageTier: 'IV', hatchAmps: 0.1, enabled: true, position: { x: 0, y: 0 } };

describe('full parallel power target', () => {
  it('targets full capacity rather than one more parallel, then returns to next improvement', () => {
    const wins = listPowerWinsCached(recipe, node);
    const target = fullParallelPowerWin(recipe, node, wins)!;
    expect(target).toBeDefined();
    expect(target.euT).toBeGreaterThan(nextPowerWin(wins, getNodePowerReport(recipe, node).poolEuT)!.euT);
    const at = powerNodeAtBudget(node, target.euT);
    expect(getNodePowerReport(recipe, at).parallels).toBe(getMachineStructuralParallels(recipe, at));
    const below = powerNodeAtBudget(node, target.euT - 1);
    expect(getNodePowerReport(recipe, below).parallels).toBeLessThan(getMachineStructuralParallels(recipe, below));
    expect(fullParallelPowerWin(recipe, { ...node, ...at }, wins)).toBeUndefined();
    expect(nextPowerWin(wins, target.euT)).toBeDefined();
  });
  it('does not add a parallel milestone to a machine without parallels', () => {
    const single = { ...recipe, machineType: 'Large Chemical Reactor' };
    expect(fullParallelPowerWin(single, node, listPowerWinsCached(single, node))).toBeUndefined();
  });
});
