# Changelog

All notable Tandem Lite changes will be documented here.

## 0.2.0 — Beta

- Redesigned the sidebar, settings experience, Marketplace icon, and Activity Bar icon.
- Added macOS support for application, window, file-opening, and Accessibility actions.
- Added first-class OpenAI, Anthropic, and Google Gemini provider profiles alongside Ollama and generic OpenAI-compatible endpoints.
- Added provider connection testing, hosted-provider API-key validation, request timeouts, and clearer API errors.
- Added provider-specific model defaults and capability-aware JSON response handling.
- Added provider contract and cross-platform tool tests.

### Beta limitations

- Desktop automation depends on the controls exposed by each application and operating system.
- Active tasks are not restored after VS Code or the extension host restarts.
- Screenshot-based visual fallback is not enabled.
- Users must review plans and permission prompts before allowing actions.
