/**
 * Tiny string interpolation for dictionary values that contain placeholders.
 *
 * Dictionary strings use `{name}` placeholders, e.g. "{count} total" or
 * "{n} / {total} answered". This replaces them from a `vars` object. Pure and
 * dependency-free so both server and client code can use it.
 *
 *   fmt("{n} / {total} answered", { n: 2, total: 4 }) // "2 / 4 answered"
 */
export function fmt(
  template: string,
  vars?: Record<string, string | number>,
): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in vars ? String(vars[key]) : whole,
  );
}
