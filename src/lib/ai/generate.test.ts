import { describe, expect, it } from "vitest";
import { extractJson } from "./generate";

describe("extractJson", () => {
  it("parses a plain JSON object", () => {
    expect(extractJson('{"a":1,"b":"x"}')).toEqual({ a: 1, b: "x" });
  });

  it("unwraps a ```json fenced reply", () => {
    const raw = '```json\n{"action":"reply","reply":"hi"}\n```';
    expect(extractJson(raw)).toEqual({ action: "reply", reply: "hi" });
  });

  it("extracts a single object from surrounding prose with a trailing stray brace", () => {
    // Naive lastIndexOf("}") would grab the stray brace after the object and
    // produce invalid JSON; balanced scanning must stop at the real close.
    const raw = 'Here you go: {"reply":"done","n":2} thanks }';
    expect(extractJson(raw)).toEqual({ reply: "done", n: 2 });
  });

  it("does not treat braces inside a string value as object delimiters", () => {
    const raw = '{"text":"a } b { c","n":1}';
    expect(extractJson(raw)).toEqual({ text: "a } b { c", n: 1 });
  });

  // Regression: the reported production crash. A well-behaved model returns a
  // valid JSON object whose STRING VALUE contains a ```mermaid``` ER diagram with
  // `{ }` attribute blocks. The old fence/brace heuristic stripped the inner
  // fence and sliced into a `{ string ... }` mermaid fragment, so JSON.parse
  // threw "Expected property name or '}'" and the whole agent turn failed.
  it("preserves a mermaid diagram (fences + braces) inside a string value", () => {
    const obj = {
      reply: "Added an ERM diagram.",
      ops: [
        {
          op: "set_page_blocks",
          pageId: "p1",
          blocks: [
            {
              id: "b1",
              type: "paragraph",
              text:
                "```mermaid\nerDiagram\n  CUSTOMER {\n    string name\n    string email\n  }\n  ORDER {\n    int id\n  }\n  CUSTOMER ||--o{ ORDER : places\n```",
            },
          ],
        },
      ],
    };
    const raw = JSON.stringify(obj); // exactly what a well-behaved model emits
    const parsed = extractJson(raw) as typeof obj;
    expect(parsed.ops[0].blocks[0].text).toContain("erDiagram");
    expect(parsed).toEqual(obj);
  });

  it("returns null for unparseable output instead of throwing", () => {
    // A raw throw here escapes the callers' safeParse() wrappers and crashes the
    // request; null lets them surface a clean 'invalid JSON' / retry path.
    expect(extractJson("not json at all, sorry")).toBeNull();
    expect(extractJson("")).toBeNull();
  });
});
