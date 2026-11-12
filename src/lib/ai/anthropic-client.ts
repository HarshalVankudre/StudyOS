/**
 * Lazily constructed Anthropic SDK client. Kept in its own module so unit tests
 * can swap in a fake client with `vi.mock("./anthropic-client")`.
 */
import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

/** The shared client; it reads ANTHROPIC_API_KEY from the environment. */
export function getAnthropicClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}
