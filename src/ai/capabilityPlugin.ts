/**
 * Optional AI-layer plugin. Suggests already-parsed capability announcements
 * for a task string. It does not call a model, a relay, or an endpoint.
 * The answer layer may attach the suggestions beside a cited answer.
 * Hosts must still ask before invocation or spend.
 */

export interface CapabilityHint {
  name: string;
  summary: string;
  role: string;
  protocols: string[];
  capabilities: string[];
  price: string;
}

export interface CapabilitySuggestion {
  name: string;
  role: string;
  score: number;
  why: string;
}

export function suggestCapabilities(task: string, items: CapabilityHint[], limit = 4): CapabilitySuggestion[] {
  const words = task
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2);
  if (words.length === 0) return [];
  return items
    .map((item) => {
      const fields = [item.name, item.summary, item.role, item.price, ...item.protocols, ...item.capabilities]
        .join(" ")
        .toLowerCase();
      let score = 0;
      const hits: string[] = [];
      for (const word of words) {
        if (!fields.includes(word)) continue;
        score += item.capabilities.some((cap) => cap.includes(word)) ? 3 : 1;
        if (!hits.includes(word)) hits.push(word);
      }
      if (item.price === "free") score += 0.25;
      return { name: item.name, role: item.role, score, why: hits.slice(0, 4).join(", ") || "related listing" };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
