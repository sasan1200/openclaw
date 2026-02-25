---
summary: "Use OpenAI via API keys or Codex subscription in OpenClaw"
read_when:
  - You want to use OpenAI models in OpenClaw
  - You want Codex subscription auth instead of API keys
title: "OpenAI"
---

# OpenAI

OpenAI provides developer APIs for GPT models. Codex supports **ChatGPT sign-in** for subscription
access or **API key** sign-in for usage-based access. Codex cloud requires ChatGPT sign-in.

## Option A: OpenAI API key (OpenAI Platform)

**Best for:** direct API access and usage-based billing.
Get your API key from the OpenAI dashboard.

### CLI setup

```bash
openclaw onboard --auth-choice openai-api-key
# or non-interactive
openclaw onboard --openai-api-key "$OPENAI_API_KEY"
```

### Config snippet

```json5
{
  env: { OPENAI_API_KEY: "sk-..." },
  agents: { defaults: { model: { primary: "openai/gpt-5.1-codex" } } },
}
```

## Option B: OpenAI Code (Codex) subscription

**Best for:** using ChatGPT/Codex subscription access instead of an API key.
Codex cloud requires ChatGPT sign-in, while the Codex CLI supports ChatGPT or API key sign-in.

### CLI setup (Codex OAuth)

```bash
# Run the onboarding wizard and choose Codex OAuth (opens browser for ChatGPT sign-in)
openclaw onboard --auth-choice openai-codex
```

Note: `openclaw models auth login --provider openai-codex` only works when an openai-codex provider plugin is installed. Use `openclaw onboard --auth-choice openai-codex` to add Codex OAuth without a plugin.

### Config snippet (Codex subscription)

```json5
{
  agents: { defaults: { model: { primary: "openai-codex/gpt-5.3-codex" } } },
}
```

**If you see “No API key found for provider openai” but you use OAuth:** your default model is set to `openai/*` (API key). OAuth is only used for **`openai-codex/*`**. Set `agents.defaults.model.primary` to `openai-codex/gpt-5.3-codex` (or another `openai-codex/…` model) so the agent uses your Codex OAuth instead of asking for an API key.

## Rate limits (“rate limit reached” with unlimited plan)

OpenAI applies **requests per minute (RPM)** and **tokens per minute (TPM)** limits even on high-tier or “unlimited” plans. If you see “API rate limit reached” or “rate limit reached”:

1. **Add multiple API keys** — OpenClaw rotates across keys on rate limit. Add keys in the same provider (e.g. `openai`) so rotation can try the next key when one is throttled.
2. **Configure model fallbacks** — Use [model failover](/concepts/model-failover) so another model (or provider) is tried when the primary is rate limited.
3. **Wait and retry** — Limits reset every minute; retrying after a short wait often works.

The message comes from the **OpenAI API** (HTTP 429), not from the gateway’s auth rate limiter.

## Notes

- Model refs always use `provider/model` (see [/concepts/models](/concepts/models)).
- Auth details + reuse rules are in [/concepts/oauth](/concepts/oauth).
