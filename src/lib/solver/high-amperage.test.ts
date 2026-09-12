import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, expect, it } from 'vitest';
import { calculateThroughput } from './throughput';
import { initLpEngine } from './lp-engine';
import { normalizeLoadedProject } from '../model/project-normalize';

beforeAll(async () => { expect(await initLpEngine()).toBe(true); });

it.each(['UV', 'UXV'] as const)('keeps the supplied reactor running through the full %s amperage range', tier => {
  const base = normalizeLoadedProject(JSON.parse(readFileSync(path.join(__dirname, '__fixtures__/high-amperage-reactor.json'), 'utf8')));
  let previousOutput = 0;
  for (let amps = 1; amps <= 16_777_216; amps *= 4) {
    const project = { ...base, nodes: base.nodes.map(node => ({ ...node, hatchVoltageTier: tier, hatchAmps: amps, powerEuT: undefined })) };
    const result = calculateThroughput(project);
    const node = result.nodes[project.nodes[0]!.id]!;
    expect(node.utilization, `${tier} ${amps}A`).toBeCloseTo(1, 5);
    const output = node.outputs['fluid:ic2distilledwater']!.amountPerSecond;
    expect(output).toBeGreaterThan(previousOutput);
    expect(node.inputs['fluid:hydrogen']!.amountPerSecond / output).toBeCloseTo(2, 5);
    expect(node.inputs['fluid:oxygen']!.amountPerSecond / output).toBeCloseTo(1, 5);
    for (const edge of Object.values(result.edges)) expect(edge.transferredPerSecond).toBeGreaterThan(0);
    previousOutput = output;
  }
});
