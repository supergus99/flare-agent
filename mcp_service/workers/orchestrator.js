/**
 * MCP orchestration: run domain_scan, vuln_intel, industry_context, financial_model,
 * template_filler, optional ai_enricher. Returns filled HTML and MCP summary (MCP JSON not stored).
 */

import { domainScan } from './domain_scan.js';
import { getRelevantVulnerabilities, vulnerabilityKeywords } from './vuln_intel.js';
import { getIndustryContext } from './industry_context.js';
import { calculateFinancialExposure } from './financial_model.js';
import { buildTemplateVars, fillReportHtml } from './template_filler.js';
import { enrichSection } from './ai_enricher.js';

const SCHEMA_VERSION = '1.0';

/**
 * Build control gap analysis from payload.controls.
 * @param {{ mfa: boolean; backup: boolean; endpoint_protection: boolean }} controls
 * @returns {{ gaps: { code: string; severity: string; description: string }[] }}
 */
function buildControlGapAnalysis(controls) {
  const gaps = [];
  if (!controls.mfa) gaps.push({ code: 'no_mfa', severity: 'high', description: 'MFA not enabled on key accounts' });
  if (!controls.backup) gaps.push({ code: 'no_backup', severity: 'high', description: 'No regular backups or untested' });
  if (!controls.endpoint_protection) gaps.push({ code: 'no_endpoint_protection', severity: 'moderate', description: 'Endpoint protection not in place' });
  return { gaps };
}

/**
 * Compute summary risk score (0–100) and level from domain + industry + financial + controls.
 */
function computeSummary(domainIntelligence, industryContext, financialEstimate, controlGap) {
  let score = 50;
  const drivers = [];
  const riskFlags = (domainIntelligence.risk_flags || []).length;
  if (riskFlags > 0) {
    score += Math.min(riskFlags * 10, 25);
    drivers.push('domain/email security gaps');
  }
  if ((controlGap.gaps || []).length > 0) {
    score += Math.min(controlGap.gaps.length * 8, 20);
    drivers.push('control gaps (MFA, backup, endpoint)');
  }
  if ((industryContext.industry_risk_level || '').toLowerCase() === 'high') {
    score += 5;
    drivers.push('high-risk industry');
  }
  score = Math.min(100, Math.max(0, score));
  const level = score >= 70 ? 'high' : score >= 45 ? 'moderate' : 'low';
  return {
    overall_risk_score: score,
    risk_level: level,
    primary_risk_drivers: drivers.length ? drivers.join('; ') : 'Baseline assessment',
  };
}

/**
 * Run full MCP pipeline. MCP JSON is returned but must not be persisted.
 * @param {object} env - Worker env (REPORTS, NVD_CACHE, OPENAI_API_KEY?, etc.)
 * @param {import('./models.js').AssessmentPayload} payload
 * @param {{ runAiEnrichment?: boolean }} [opts]
 * @returns {Promise<{ mcp: object; html: string }>}
 */
export async function runOrchestrator(env, payload, opts = {}) {
  const generatedAt = new Date().toISOString();

  const [domainIntelligence, vulnItems, industryContext] = await Promise.all([
    domainScan(payload.domain),
    getRelevantVulnerabilities(env, vulnerabilityKeywords(payload)),
    Promise.resolve(getIndustryContext(payload.industry)),
  ]);

  const domainRiskMultiplier = (domainIntelligence.risk_flags || []).length > 0 ? 1.2 : 1.0;
  const financialEstimate = calculateFinancialExposure({
    industryIncidentRate: industryContext.incident_rate,
    avgBreachCost: industryContext.avg_breach_cost,
    employeeCount: payload.employee_count || 10,
    mfa: payload.controls.mfa,
    backup: payload.controls.backup,
    endpointProtection: payload.controls.endpoint_protection,
    domainRiskMultiplier,
  });

  const controlGapAnalysis = buildControlGapAnalysis(payload.controls);
  const summary = computeSummary(domainIntelligence, industryContext, financialEstimate, controlGapAnalysis);

  const mcp = {
    schema_version: SCHEMA_VERSION,
    summary,
    domain_intelligence: domainIntelligence,
    vulnerability_context: { items: vulnItems },
    industry_context: industryContext,
    financial_estimate: financialEstimate,
    control_gap_analysis: controlGapAnalysis,
    confidence: { generated_at: generatedAt },
    generated_at: generatedAt,
  };

  let templateVars = buildTemplateVars(mcp, payload, generatedAt);

  if (opts.runAiEnrichment) {
    const enrichedSummary = await enrichSection(env, 'executive_summary', {
      summary: mcp.summary,
      domain: domainIntelligence,
      industry: industryContext,
    }, templateVars.primary_risk_drivers);
    if (enrichedSummary) templateVars = { ...templateVars, primary_risk_drivers: enrichedSummary };
  }

  const html = fillReportHtml(templateVars);
  return { mcp, html };
}
