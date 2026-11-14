# Project Guide

This guide covers Fabrexa's runtime structure, configuration, personalities, and memory behavior. Start with the main [README](../README.md) if you only want to install and run the bot.

## Runtime flow

Fabrexa uses Telegram as the chat interface, Ollama as the local text-model server, and ComfyUI as the optional local image runtime.

```text
Telegram update
    ↓
Telegraf handlers
    ↓
Access check
    ↓
Conversation and personality context
    ↓
Ollama /api/chat
    ↓
Streamed Telegram reply
    ↓
Character appearance from personality + scene from final assistant reply
    ↓
Unload text model → ComfyUI image → Telegram photo
    ↓
Unload image model → preload text model
```

For each normal text message, the bot:

1. Checks access when private mode is enabled.
2. Loads the active personality and conversation session.
3. Loads up to 24 recent messages from the active session, then trims the oldest messages when the history token budget or context window requires it.
4. Adds long-term memory when the selected personality is allowed to use it.
5. Sends the request to Ollama with streaming enabled.
6. Shows a compact model/personality/memory placeholder, then replaces it as soon as the first streamed text chunk arrives and continues throttled edits.
7. Stores and finishes sending the final conversation locally.
8. If the Telegram account has automatic images enabled, asks the same text model to direct one still image. The selected personality prompt supplies only stated character appearance; the final assistant reply supplies only the scene.
9. Stores the scene direction in the session log and the user's private image record without adding it to future conversation context.
10. Unloads the text model, sends a small image-building status, runs ComfyUI with the complete direction, and sends the result with the direction inside an expandable caption. Only the displayed caption is shortened when Telegram's fixed caption limit requires it.
11. Deletes the status, unloads the ComfyUI model, and preloads the text model for the next queued message.

After successful photo delivery and model recovery, the console reports wall-clock durations for request setup, queue wait, text-model preparation, context/memory, text generation and delivery, scene direction, prompt persistence, both model handoffs, image generation and delivery, time until the photo, and total time including cleanup.

The Ollama request includes `temperature`, `top_p`, `num_ctx`, `num_predict`, and `keep_alive` from the environment configuration.

## Main modules

| Path | Responsibility |
| --- | --- |
| `bot.js` | Application entry point |
| `src/bot/` | Telegram commands, quick actions, callbacks, and access control |
| `src/ai/client.js` | Ollama request construction and streaming |
| `src/config/index.js` | Environment parsing and defaults |
| `src/personalities/` | Personality file loading |
| `src/memory/index.js` | Conversation sessions and memory coordination |
| `src/memory/memoryService.js` | Short-term and long-term storage |
| `src/memory/analyzer.js` | Model-based memory classification |
| `src/memory/processor.js` | Scheduled memory promotion and cleanup |
| `src/image/` | Scene direction, per-user preference/history, serial queue, ComfyUI workflow, and model handoff |

## Personalities

Personalities are local `.txt` files inside `personalities/`. The filename without `.txt` is the personality key.

```text
Name: Friendly
Prompt:
You are Friendly, a warm, thoughtful, and easygoing assistant.
```

The `Name` line is shown in Telegram. Everything after `Prompt:` becomes the personality prompt.

The tracked `Friendly.txt` file provides the default personality. The repository also includes Elara Voss, Sherlock Holmes, and Vent Girl as demo personalities, so a fresh clone is ready to use. Additional personality prompt files remain ignored by Git to keep private prompts out of commits.

## Conversation and memory

Fabrexa stores runtime data under `chat_memory/<chat-id>/`.

| File | Purpose |
| --- | --- |
| `meta.json` | Active session number and selected personality |
| `session_<id>.txt` | Messages from one conversation session |
| `memory-short-term.json` | Temporary memory candidates |
| `memory-long-term.json` | Stable memory used in future prompts |
| `users/<telegram-id>/image-generation.json` | Per-account image preference and recent scene directions |

### Recent conversation

Recent messages from the active session provide normal conversational context. By default, Fabrexa considers up to 24 previous messages with an approximate 4096-token history budget. It also reserves room for the system and personality prompt, long-term memory, the latest user message, the configured maximum response, and a small safety margin. If everything does not fit, the oldest history messages are removed first. Starting a new chat creates a new session, so earlier session messages are no longer included. `Artifact(Scene Director)` log entries remain auditable in the session file but are skipped by the conversation parser.

### Short-term memory

For memory-enabled personalities, the analyzer checks user messages for useful facts such as preferences, goals, routines, profile details, projects, and meaningful context. Messages that are not useful for memory are skipped.

### Long-term memory

The memory processor runs on a cron schedule. It promotes stable short-term entries when they meet the current importance and category rules, merges duplicates, and expires or archives temporary entries.

Long-term memories remain available after starting a new chat. The Telegram memory action lets the user view, edit, and archive them.

Memory is enabled per personality:

```env
MEMORY_ENABLED_PERSONALITIES=Friendly,Vent Girl
```

Friendly and Vent Girl use memory by default. The values can match personality keys or displayed names. Change the list for different personalities, or leave the variable empty to disable short-term and long-term memory for every personality.

## Environment reference

The repository's [`.env.example`](../.env.example) is the source of truth for a ready-to-copy configuration.

### Telegram

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | Yes | None | Token created with BotFather |
| `OWNER_ID` | In private mode | None | Numeric Telegram user allowed to use the bot |
| `OWNER_USERNAME` | In private mode | None | Public contact handle shown to users denied access |
| `BOT_PRIVATE` | No | `true` | Restricts access to `OWNER_ID` |

`OWNER_ID` is used for authorization and must be numeric. `OWNER_USERNAME` is displayed in the private-mode response so other users can request access; it may be entered with or without the leading `@`. When `BOT_PRIVATE=false`, any Telegram user who can reach the bot can use it, and neither owner value is required. Runtime data is still separated by Telegram chat ID.

### Ollama and generation

| Variable | Default | Purpose |
| --- | --- | --- |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama server base URL without `/api/chat` |
| `OLLAMA_MODEL` | `llama3.1` in code | Main chat model |
| `OLLAMA_KEEP_ALIVE` | `10m` | How long Ollama keeps a model loaded |
| `OLLAMA_NUM_CTX` | `8192` | Context window size |
| `OLLAMA_TEMPERATURE` | `0.8` | Sampling temperature |
| `OLLAMA_TOP_P` | `0.9` | Nucleus sampling value |
| `OLLAMA_MAX_TOKENS` | `2048` | Maximum generated tokens per response |
| `OLLAMA_MIN_RESPONSE_WORDS` | `250` | Minimum combined response length; `0` disables automatic continuation |
| `OLLAMA_MAX_CONTINUATIONS` | `2` | Maximum extra Ollama requests for a response below the minimum |
| `CHAT_HISTORY_MAX_MESSAGES` | `24` | Maximum previous conversation messages considered per response |
| `CHAT_HISTORY_MAX_TOKENS` | `4096` | Approximate token budget for previous conversation messages |
| `PERSONALITY_INSTRUCTION` | Built-in instruction | Final shared instruction added after the selected personality prompt |
| `REQUEST_TIMEOUT` | `120000` | Ollama request timeout in milliseconds |

`.env.example` selects `gemma3:12b`, so a normal installation uses that model unless you change it.

The same `OLLAMA_MODEL` is intentionally used for chat replies, memory analysis, and scene direction. This keeps the runtime to one text model plus one private ComfyUI checkpoint.

The director treats the selected personality prompt as read-only appearance reference data: face, eyes, hair, skin, body, proportions, clothing, accessories, and other stable visual identifiers. It ignores personality behavior and roleplay instructions. Scene, action, pose, expression, setting, and composition come only from the completed assistant reply. The assistant character is prioritized over the environment and over any user representation.

### Automatic image continuation

| Variable | Default | Purpose |
| --- | --- | --- |
| `IMAGE_GENERATION_AVAILABLE` | `true` | Exposes automatic image settings and initializes the image runtime |
| `IMAGE_GENERATION_DEFAULT_ENABLED` | `true` | Default for a Telegram account with no saved preference |
| `IMAGE_SCENE_DIRECTOR_PROMPT_PATH` | `src/image/scene-director.txt` | Scene-director system prompt |
| `IMAGE_GENERATION_QUEUE_MAX_SIZE` | `5` | Maximum active and waiting model-sensitive jobs |
| `COMFYUI_BASE_URL` | `http://127.0.0.1:8188` | Local ComfyUI HTTP server |
| `COMFYUI_WORKFLOW_PATH` | `src/image/workflow_api.json` | API-format image workflow |
| `COMFYUI_CHECKPOINT_NAME` | None | Required private checkpoint filename; never commit it |
| `OLLAMA_HANDOFF_TIMEOUT_MS` | `30000` | Maximum verified text-model load or unload wait |

The committed workflow deliberately leaves `ckpt_name` empty. At runtime the value comes only from ignored `.env`. Node mappings, ComfyUI polling/cleanup controls, and scene-director sampling controls are documented in [`.env.example`](../.env.example).

All incoming conversations and scheduled memory processing share a serial queue. This prevents a new Ollama request from starting while the ComfyUI model owns GPU memory. Long work continues outside Telegraf's update-handler lifetime.

### Streaming, memory, and logs

| Variable | Default | Purpose |
| --- | --- | --- |
| `TELEGRAM_STREAM_EDIT_INTERVAL_MS` | `6000` | Initial delay between Telegram response edits |
| `MEMORY_ENABLED_PERSONALITIES` | `Friendly,Vent Girl` | Comma-separated personality keys or names with memory access |
| `MEMORY_PROCESSOR_CRON` | `0 0 * * *` | Memory processing schedule |
| `MEMORY_PROCESSOR_TIMEZONE` | `Asia/Tehran` | IANA timezone used by the schedule |
| `LOG_MODE` | `normal` | Use `dev-mode`, `debug`, or `verbose` for payload diagnostics |
| `LOG_LEVEL` | `INFO` | Configured log-level value |

Detailed logging can include prompts, recent conversation content, and memory context. Use it only while diagnosing local behavior.

## Models from Hugging Face

Ollama can run compatible GGUF repositories from Hugging Face:

```bash
ollama run hf.co/<publisher>/<model>-GGUF:Q4_K_M
```

After the first run, place the exact reference in `.env`:

```env
OLLAMA_MODEL=hf.co/<publisher>/<model>-GGUF:Q4_K_M
```

Model names and available quantizations differ by repository. Follow the command shown on the model page or the [official Hugging Face Ollama guide](https://huggingface.co/docs/hub/ollama).

## Local validation

```bash
npm run check
```

`npm run check` performs static JavaScript checks, runs the focused automated tests, and then verifies:

- `.env` exists
- Node.js, npm, and the Ollama CLI are available
- Required environment values are present
- The memory cron expression is valid
- The Ollama server responds
- The configured model is installed
- The private checkpoint setting and image files are present
- The local ComfyUI queue endpoint responds

It prints `✅ All checks passed.` only after every step succeeds. Use `npm run check:setup` to run only environment and local-service checks. Neither command validates the Telegram token with Telegram or generates a real image.

Changes to Telegram interactions, streaming, personalities, and memory should also be checked manually with a test bot and local model.

## Static project website

The portfolio page is independent of the bot runtime and lives in `public/`.

```bash
python -m http.server 8000 --directory public
```

The site uses plain HTML, CSS, and JavaScript. It does not require a frontend build step.

## Security and privacy

- Keep `.env`, bot tokens, private personality prompts, and `chat_memory/` out of Git.
- Keep private mode enabled unless public access is intentional.
- Use a public contact username for `OWNER_USERNAME`; private-mode users will see it.
- Treat detailed development logs as sensitive because they can contain conversation context.
- Telegram transports the messages, even though model inference runs through the configured Ollama server.
- Back up `chat_memory/` before moving or replacing an installation if its saved conversations matter.

For common runtime failures, see [Troubleshooting](./TROUBLESHOOTING.md).
