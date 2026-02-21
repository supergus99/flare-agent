/**
 * Industry context: free public SMB statistics (Verizon, Hiscox, ENISA style).
 * Static data keyed by industry; used for risk level and financial model inputs.
 */

/** @type {Record<string, { incident_rate: number; avg_breach_cost: number; phishing_rate: number; ransomware_rate: number; industry_risk_level: string }>} */
const INDUSTRY_STATS = {
  default: { incident_rate: 0.22, avg_breach_cost: 75000, phishing_rate: 0.58, ransomware_rate: 0.19, industry_risk_level: 'elevated' },
  retail: { incident_rate: 0.24, avg_breach_cost: 82000, phishing_rate: 0.61, ransomware_rate: 0.22, industry_risk_level: 'elevated' },
  'professional services': { incident_rate: 0.18, avg_breach_cost: 68000, phishing_rate: 0.55, ransomware_rate: 0.17, industry_risk_level: 'moderate' },
  healthcare: { incident_rate: 0.31, avg_breach_cost: 120000, phishing_rate: 0.68, ransomware_rate: 0.28, industry_risk_level: 'high' },
  technology: { incident_rate: 0.20, avg_breach_cost: 95000, phishing_rate: 0.52, ransomware_rate: 0.18, industry_risk_level: 'elevated' },
  manufacturing: { incident_rate: 0.25, avg_breach_cost: 88000, phishing_rate: 0.59, ransomware_rate: 0.24, industry_risk_level: 'elevated' },
  hospitality: { incident_rate: 0.26, avg_breach_cost: 72000, phishing_rate: 0.62, ransomware_rate: 0.21, industry_risk_level: 'elevated' },
  'real estate': { incident_rate: 0.17, avg_breach_cost: 55000, phishing_rate: 0.50, ransomware_rate: 0.15, industry_risk_level: 'moderate' },
  education: { incident_rate: 0.28, avg_breach_cost: 78000, phishing_rate: 0.65, ransomware_rate: 0.26, industry_risk_level: 'high' },
  finance: { incident_rate: 0.27, avg_breach_cost: 145000, phishing_rate: 0.64, ransomware_rate: 0.20, industry_risk_level: 'high' },
  legal: { incident_rate: 0.18, avg_breach_cost: 85000, phishing_rate: 0.62, ransomware_rate: 0.21, industry_risk_level: 'elevated' },
  other: { incident_rate: 0.22, avg_breach_cost: 75000, phishing_rate: 0.58, ransomware_rate: 0.19, industry_risk_level: 'elevated' },
};

/**
 * Get industry context for MCP.
 * @param {string} industry - e.g. "Healthcare", "Legal"
 * @returns {{ industry: string; incident_rate: number; avg_breach_cost: number; phishing_rate: number; ransomware_rate: number; industry_risk_level: string }}
 */
export function getIndustryContext(industry) {
  const key = (industry || 'other').toLowerCase().trim().replace(/\s+/g, ' ');
  const stats = INDUSTRY_STATS[key] || INDUSTRY_STATS.default;
  return {
    industry: industry || 'Other',
    incident_rate: stats.incident_rate,
    avg_breach_cost: stats.avg_breach_cost,
    phishing_rate: stats.phishing_rate,
    ransomware_rate: stats.ransomware_rate,
    industry_risk_level: stats.industry_risk_level,
  };
}
