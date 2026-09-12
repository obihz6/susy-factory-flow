/** MTENeutronActivator.createProcessingLogic, GT5U 8e23867.
 * GTUtility.powInt promotes the Java 0.9f to double, then squares it.
 */
export function neutronActivatorSpeed(height: number): number {
  let exponent = Math.max(0, Math.trunc(height) - 4);
  let base = Math.fround(0.9);
  let duration = 1;
  while (exponent > 0) {
    if (exponent % 2 === 1) duration *= base;
    base *= base;
    exponent = Math.floor(exponent / 2);
  }
  return 1 / duration;
}

/** This machine CEILS whole ticks. Its custom under-one-tick supplier takes
 * ParallelHelper's old path: floor(1 / duration), capped by safeInt(..., 0).
 * The equivalent per-operation duration keeps that parallel batch in the
 * existing rate model. Underflow at extreme heights must saturate, not reset.
 */
export function quantiseNeutronActivatorDuration(duration: number): number {
  if (duration >= 1) return Math.ceil(duration);
  const parallels = Math.min(2_147_483_647, Math.max(1, Math.floor(1 / duration)));
  return 1 / parallels;
}
