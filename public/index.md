# Fabrexa AI Ollama

Fabrexa AI Ollama is a self-hosted Telegram bot that runs text generation through Ollama and optional image generation through ComfyUI on your own machine.

## What it does

- Uses Telegram as the chat interface
- Runs the configured text model locally through Ollama
- Generates optional images locally through a configured ComfyUI checkpoint
- Streams generated replies into the Telegram conversation
- Includes four demo personalities and loads custom ones from local text files
- Keeps recent conversation context
- Keeps ordered continuity memory inside every chat session
- Supports compact or larger, more capable local models according to the host hardware
- Provides private owner-only access by default

Telegram carries messages, replies, and delivered photos between the user and bot. Text inference, image generation, personality prompts, conversations, and session-memory files remain on the machine hosting Fabrexa.

## Requirements

- Node.js 22 or newer
- Ollama
- ComfyUI when local image generation is enabled
- A Telegram bot token
- A numeric Telegram user ID when private mode is enabled
- A public Telegram username for private-mode access requests

## Basic setup

```bash
git clone https://github.com/Ali-Sdg90/Fabrexa-AI-Ollama.git
cd Fabrexa-AI-Ollama
npm install
ollama pull gemma3:12b
```

Copy `.env.example` to `.env`, then add the Telegram token, numeric owner ID, and public owner username. In private mode, the username is shown to users who want to request access. To enable local images, also run ComfyUI and set `COMFYUI_CHECKPOINT_NAME`; for a text-only setup, set `IMAGE_GENERATION_AVAILABLE=false`. The included `Friendly` personality works without additional setup:

```bash
npm run check
npm start
```

## Documentation

- [Source and README](https://github.com/Ali-Sdg90/Fabrexa-AI-Ollama)
- [Project guide](https://github.com/Ali-Sdg90/Fabrexa-AI-Ollama/blob/main/docs/PROJECT_GUIDE.md)
- [Troubleshooting](https://github.com/Ali-Sdg90/Fabrexa-AI-Ollama/blob/main/docs/TROUBLESHOOTING.md)
- [LLM-readable map](./llms.txt)

Fabrexa AI Ollama was designed and developed by Ali Sadeghi and is licensed under the MIT License.
