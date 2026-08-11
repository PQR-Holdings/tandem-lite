# Tandem Lite Beta Privacy Statement

Tandem Lite does not include product analytics or telemetry and does not send task data to a Tandem-operated service.

## Model providers

- **Ollama:** Requests are sent to the Ollama endpoint configured by the user. The default endpoint is local, but users can configure a remote endpoint.
- **OpenAI, Anthropic, and Gemini:** Requests are sent directly from the extension runtime to the selected provider using the user's API key.
- **OpenAI-compatible:** Requests are sent to the endpoint supplied by the user.

Model requests may contain the user's objective, workspace path, available tool descriptions, generated plan content, failed-step details, and relevant tool results or terminal output used to create a recovery step. Tandem Lite does not intentionally send entire workspace files, but task text and recovery context can contain sensitive information. Users are responsible for choosing an appropriate provider and complying with their organization's data-handling requirements.

Hosted-provider API keys are stored using VS Code SecretStorage. Tandem Lite does not write API keys to its settings, output channel, repository, or generated VSIX.

## Desktop and file access

The extension performs approved file, terminal, network, application, and accessibility actions on the user's machine. It relies on VS Code settings, Tandem Lite permission prompts, workspace boundaries, and operating-system controls. Users should inspect every plan and permission request before approval.

## Beta notice

This statement describes the `0.2.x` beta. Data flows may change before version 1.0. Material changes will be documented in the changelog and this file.

Privacy questions can be sent to [partners@pqr.llc](mailto:partners@pqr.llc). Do not send credentials or confidential workspace content.
