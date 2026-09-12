import { getMachineBehaviour } from "@/lib/machines/machine-table";

// ProcessingLogic power overrides, checked against GT5-Unofficial source.
// Separate from coefficient coverage: these rules also apply to scraped machines.
export function maxInputTierSkips(machine: string | undefined): number {
  if (getMachineBehaviour(machine)?.unlimitedTierSkip) return Infinity;
  const name = (machine ?? "").toLowerCase();
  if (
    /precise (?:auto-)?assembler|industrial arc furnace|steam (grinder|squasher|separator|purifier|presser|blender|fuser|hearth)/.test(
      name,
    )
  )
    return 0;
  return 1;
}

export function hasAmperageOverclock(machine: string | undefined): boolean {
  const name = (machine ?? "").toLowerCase();
  return !/fusion|nano forge|transcendent plasma mixer|godforge|(?:smelting|molten|plasma|exotic) module|nanochip|(?:assembly matrix|biological coordination|board processor|cutting chamber|encasement wrapper|etching array|optical organizer|smd processor|superconductor splitter|splitter|wire tracer) module|industrial arc furnace|steam (grinder|squasher|separator|purifier|presser|blender|fuser|hearth)/.test(
    name,
  );
}
