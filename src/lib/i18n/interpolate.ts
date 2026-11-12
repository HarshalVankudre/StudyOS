/**
 * Tiny string interpolation for dictionary values that contain placeholders.
 *
 * Dictionary strings use `{name}` placeholders, e.g. "{count} total" or
 * "{n} / {total} answered". This replaces them from a `vars` object. Pure and
 * dependency-free so both server and client code can use it.
 *
 *   fmt("{n} / {total} answered", { n: 2, total: 4 }) // "2 / 4 answered"
 *
 * A value that already ends in a full stop (an abbreviation such as German
 * "40 Min.") swallows a full stop that directly follows its placeholder, so a
 * sentence never ends in "Min..".
 */
export function fmt(
  template: string,
  vars?: Record<string, string | number>,
): string {
  if (!vars) return template;
  let out = "";
  let last = 0;
  for (const match of template.matchAll(/\{(\w+)\}/g)) {
    const [whole, key] = match;
    const at = match.index;
    out += template.slice(last, at);
    last = at + whole.length;
    if (!(key in vars)) {
      out += whole;
      continue;
    }
    const value = String(vars[key]);
    out += value;
    if (value.endsWith(".") && !value.endsWith("..") && template[last] === ".") last += 1;
  }
  return out + template.slice(last);
}
