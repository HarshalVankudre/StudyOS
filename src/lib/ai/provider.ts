/**
 * Which upstream serves a model id, and whether its API key is configured.
 *
 * A bare Claude id (`claude-…`, no provider slash) goes straight to the
 * Anthropic Messages API on ANTHROPIC_API_KEY. Anything else — including
 * OpenRouter slugs such as `anthropic/claude-…` or `z-ai/glm-5.2` — goes to
 * OpenRouter on OPENROUTER_API_KEY.
 */
export type AiProvider = "anthropic" | "openrouter";

export function providerForModel(model: string): AiProvider {
  return model.startsWith("claude-") && !model.includes("/") ? "anthropic" : "openrouter";
}

export function apiKeyEnvVar(provider: AiProvider): "ANTHROPIC_API_KEY" | "OPENROUTER_API_KEY" {
  return provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENROUTER_API_KEY";
}

/** True when the key for the provider serving `model` is set. */
export function isAiConfigured(model: string): boolean {
  return Boolean(process.env[apiKeyEnvVar(providerForModel(model))]);
}

/** User-facing message for a feature that needs the key `model` requires. */
export function missingAiKeyMessage(model: string, feature: string): string {
  const provider = providerForModel(model);
  const name = provider === "anthropic" ? "an Anthropic" : "an OpenRouter";
  return `${feature} needs ${name} API key (add ${apiKeyEnvVar(provider)} to .env.local).`;
}
