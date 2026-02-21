/**
 * Optional AI enrichment: receives MCP JSON + template section, returns enriched text.
 * Uses OpenAI or Anthropic if API key is set. Optional for MVP – template alone can suffice.
 */

/**
 * @param {object} env - { OPENAI_API_KEY?, ANTHROPIC_API_KEY?, CLAUDE_API_KEY? }
 * @param {string} sectionName - e.g. "executive_summary", "control_gaps"
 * @param {object} mcpContext - subset of MCP JSON for context
 * @param {string} [existingText] - current placeholder text to enhance
 * @returns {Promise<string>} enriched text (or existingText if no API / error)
 */
export async function enrichSection(env, sectionName, mcpContext, existingText = '') {
  const apiKey = env.OPENAI_API_KEY || env.ANTHROPIC_API_KEY || env.CLAUDE_API_KEY;
  if (!apiKey) return existingText;

  const prompt = `You are a security risk analyst. Based on the following MCP context, write a short (2–4 sentences) plain-language ${sectionName} for an SMB risk report. Be specific and actionable. Do not use markdown or HTML.\n\nContext:\n${JSON.stringify(mcpContext, null, 2).slice(0, 2000)}`;

  if (env.OPENAI_API_KEY) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: env.OPENAI_MODEL || 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 300,
        }),
      });
      if (!res.ok) return existingText;
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content?.trim();
      return text || existingText;
    } catch (_) {
      return existingText;
    }
  }

  if (env.ANTHROPIC_API_KEY || env.CLAUDE_API_KEY) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: env.ANTHROPIC_MODEL || 'claude-3-haiku-20240307',
          max_tokens: 300,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!res.ok) return existingText;
      const data = await res.json();
      const text = data.content?.[0]?.text?.trim();
      return text || existingText;
    } catch (_) {
      return existingText;
    }
  }

  return existingText;
}
