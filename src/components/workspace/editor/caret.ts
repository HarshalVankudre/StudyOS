/**
 * Caret geometry for a <textarea>: is the caret on the first or last visual
 * line? Used so ArrowUp/ArrowDown move to the neighbouring block only at the
 * edges, including inside soft-wrapped lines.
 *
 * Hard line breaks are checked first (cheap and exact). For wrapping, the
 * textarea's text is laid out in an invisible mirror element with the same
 * box and font, and the caret's vertical offset is compared with the offset of
 * the first / last character. Without layout (tests, SSR) offsets are all 0,
 * so a single logical line counts as both first and last.
 */

const MIRRORED = [
  "boxSizing",
  "width",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "fontFamily",
  "fontSize",
  "fontStyle",
  "fontWeight",
  "fontVariant",
  "letterSpacing",
  "lineHeight",
  "textTransform",
  "textIndent",
  "wordSpacing",
  "tabSize",
  "direction",
] as const;

function caretTop(el: HTMLTextAreaElement, pos: number): number {
  const doc = el.ownerDocument;
  const mirror = doc.createElement("div");
  const style = doc.defaultView?.getComputedStyle(el);
  if (style) {
    for (const prop of MIRRORED) mirror.style[prop] = style[prop];
  }
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.top = "0";
  mirror.style.left = "-9999px";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.overflowWrap = "break-word";
  mirror.style.height = "auto";
  mirror.textContent = el.value.slice(0, pos);
  const marker = doc.createElement("span");
  marker.textContent = el.value.slice(pos, pos + 1) || "​";
  mirror.appendChild(marker);
  doc.body.appendChild(mirror);
  const top = marker.offsetTop;
  mirror.remove();
  return top;
}

function collapsedCaret(el: HTMLTextAreaElement): number | null {
  const { selectionStart, selectionEnd } = el;
  return selectionStart === selectionEnd ? selectionStart : null;
}

export function caretOnFirstLine(el: HTMLTextAreaElement): boolean {
  const pos = collapsedCaret(el);
  if (pos === null) return false;
  if (pos === 0) return true;
  if (el.value.slice(0, pos).includes("\n")) return false;
  return caretTop(el, pos) <= caretTop(el, 0) + 1;
}

export function caretOnLastLine(el: HTMLTextAreaElement): boolean {
  const pos = collapsedCaret(el);
  if (pos === null) return false;
  const len = el.value.length;
  if (pos === len) return true;
  if (el.value.slice(pos).includes("\n")) return false;
  return caretTop(el, pos) >= caretTop(el, len) - 1;
}
