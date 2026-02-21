/**
 * Financial model: pure calculation from industry + controls + size.
 * Output: annualized risk exposure, downtime cost, breach impact range.
 */

/**
 * @param {object} params
 * @param {number} params.industryIncidentRate
 * @param {number} params.avgBreachCost
 * @param {number} params.employeeCount
 * @param {boolean} params.mfa
 * @param {boolean} params.backup
 * @param {boolean} params.endpointProtection
 * @param {number} [params.domainRiskMultiplier] - from domain/email/SSL gaps (e.g. 1.0–1.5)
 */
export function calculateFinancialExposure(params) {
  const {
    industryIncidentRate = 0.2,
    avgBreachCost = 75000,
    employeeCount = 10,
    mfa = false,
    backup = false,
    endpointProtection = false,
    domainRiskMultiplier = 1.0,
  } = params;

  let controlWeaknessMultiplier = 1.0;
  if (!mfa) controlWeaknessMultiplier += 0.2;
  if (!backup) controlWeaknessMultiplier += 0.15;
  if (!endpointProtection) controlWeaknessMultiplier += 0.1;

  const sizeModifier = employeeCount <= 10 ? 0.8 : employeeCount <= 50 ? 1.0 : 1.2;
  const baseRate = industryIncidentRate;
  const effectiveRate = baseRate * controlWeaknessMultiplier * domainRiskMultiplier * sizeModifier;

  const annualizedRiskExposure = Math.round(effectiveRate * avgBreachCost);
  const estimatedDowntimeCost = Math.round(avgBreachCost * 0.15);
  const breachLow = Math.round(avgBreachCost * 0.35);
  const breachHigh = Math.round(avgBreachCost * 1.2);

  return {
    annualized_risk_exposure: annualizedRiskExposure,
    estimated_downtime_cost: estimatedDowntimeCost,
    estimated_breach_impact_range: { low: breachLow, high: breachHigh },
    risk_multiplier_breakdown: {
      base_industry_rate: baseRate,
      control_weakness_multiplier: controlWeaknessMultiplier,
      size_modifier: sizeModifier,
    },
  };
}
