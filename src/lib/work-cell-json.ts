/**
 * Locate one typed JSON object in operator paste.
 *
 * This extracts the executor artifact from surrounding chat. It does not repair
 * keys, values, or trailing commas. A missing or truncated object still fails.
 */
export function extractJsonObject(raw: string): { ok: true; json: string } | { ok: false; error: string } {
  const trimmed = raw.replace(/^\uFEFF/, "").trim();
  if (!trimmed) return { ok: false, error: "No executor output was provided." };

  const marked = trimmed.search(/\{\s*"schemaVersion"\s*:/);
  const start = marked === -1 ? trimmed.indexOf("{") : marked;
  const candidate = start === -1 ? "" : trimmed.slice(start);
  if (!candidate || candidate[0] !== "{") {
    return {
      ok: false,
      error: "Paste must include a JSON object. If this is Hermes chat, copy from the first { through the last }.",
    };
  }

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < candidate.length; i += 1) {
    const ch = candidate[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return { ok: true, json: candidate.slice(0, i + 1) };
    }
  }
  return { ok: false, error: "JSON object was truncated before the closing brace." };
}

export function parseExtractedJson(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const extracted = extractJsonObject(raw);
  if (!extracted.ok) return extracted;
  try {
    return { ok: true, value: JSON.parse(extracted.json) as unknown };
  } catch (error) {
    return { ok: false, error: `Executor output is not valid JSON: ${(error as Error).message}` };
  }
}
