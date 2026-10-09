# Official AI API Findings

## OpenAI

Source: https://developers.openai.com/api/docs/guides/text

The official OpenAI text generation guide recommends the Responses API for direct model requests. The request uses `POST https://api.openai.com/v1/responses` with `Authorization: Bearer $OPENAI_API_KEY`, a `model`, and `input`; optional `instructions` and reasoning configuration can guide behavior. The response may contain multiple items in the `output` array, including tool calls and reasoning data, so text extraction must not assume `output[0].content[0].text`. The official SDK exposes a convenience `output_text` aggregate, but a raw fetch adapter should walk output items and select content parts with `type: output_text`. Structured JSON output is supported and production applications should pin model snapshots and maintain evaluation tests when changing model versions.

Source: https://developers.openai.com/api/reference/responses/overview

The Responses API supports text and image inputs, text outputs, stateful interactions, and extensions such as tools/function calling. The MVP gateway currently uses the direct REST boundary and keeps provider credentials outside the UI code path.

## Gemini

Source: https://ai.google.dev/gemini-api/docs/text-generation

The current Gemini documentation recommends the Interactions API for the latest features, with `POST https://generativelanguage.googleapis.com/v1beta/interactions` using the `x-goog-api-key` header and a model/input payload. The same guide documents system instructions, generation configuration and streaming. The MVP gateway uses the stable `models.generateContent` boundary for a simpler REST adapter while keeping the provider interface replaceable.

Source: https://ai.google.dev/api/generate-content

The Gemini `models.generateContent` endpoint is `POST https://generativelanguage.googleapis.com/v1beta/{model=models/*}:generateContent`. The request contains `contents[]`, optional `systemInstruction`, `generationConfig`, safety settings and other controls. Responses contain candidates with content parts, and the adapter should collect text from candidate content parts rather than assuming one fixed response field.

## Implementation decision

`src/lib/officialGateway.ts` defines `OfficialAIGateway` with OpenAI Responses and Gemini `models.generateContent` adapters, strict JSON parsing into the shared content variant contract, provider-specific authentication headers and explicit HTTP error messages. `src/lib/geminiWebGateway.ts` is the separate Gemini Pro subscription path: it opens a SignalFlow-managed persistent Chrome profile and uses a Revo-style visible-composer/CDP bridge, with no API key or Chrome-session extraction. Model IDs and API keys remain configuration inputs; no secret is committed to the repository.

## References

[1]: https://developers.openai.com/api/docs/guides/text "OpenAI Text generation"
[2]: https://developers.openai.com/api/reference/responses/overview "OpenAI Responses Overview"
[3]: https://ai.google.dev/gemini-api/docs/text-generation "Gemini Text generation"
[4]: https://ai.google.dev/api/generate-content "Gemini generateContent API"
