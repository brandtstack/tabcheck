/**
 * A colour list on the command line: "#fff,#dee1e6" or "rgb(255, 255, 255), hsl(0 0% 90%)".
 * Commas inside parentheses belong to the colour, so a plain split(',') would cut rgb() apart.
 */
export function splitColours(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of list) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}
