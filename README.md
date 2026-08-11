# Tandem Lite

> **Beta:** Tandem Lite is under active development. Review every plan before approval and avoid using it for unattended or production-critical automation.

Tandem Lite is an open-source VS Code execution companion for planning and carrying out approved developer and desktop tasks on Windows and macOS. It can use a local Ollama model or an explicitly configured hosted provider. Tandem creates a short tool-based plan, shows that plan for review, and verifies each completed step where a reliable postcondition is available.

Tandem Lite is a PQR LLC product.

## What it can do

Tandem Lite can create and run multi-step plans using these current capabilities:

- Read, list, create, and update files inside the open VS Code workspace.
- Inspect Git state and run approved terminal commands in the workspace.
- Check HTTP endpoints and inspect local process state.
- Search local folders for files, including extension-filtered image searches, then open a selected result.
- Open known folders and absolute file or folder paths in Explorer or Finder.
- Search installed applications and launch a discovered application.
- List visible windows, then focus or request closure of a selected window.
- Inspect accessible Windows UI Automation or macOS Accessibility controls, then focus a control, invoke it, or set an accessible text value.

The model selects only from this explicit tool set. It cannot gain arbitrary shell, filesystem, UI, or network access just by describing an action.

## How a task runs

1. Enter an objective in the Tandem Lite sidebar and select **Create plan**.
2. Tandem Lite asks the configured model for an executable plan.
3. Review the plan, then **Approve**, **Deny**, or **Modify** it.
4. The runtime executes one step at a time, asks for permissions when required, verifies results, and retries a failed step with a distinct recovery action up to five times.
5. Use the stop control beside Status to cancel active planning or execution.

The sidebar keeps the plan, step state, activity, output, and errors visible while work is running.

## Installation

Install a packaged `.vsix` from VS Code:

```sh
code --install-extension tandem-lite-<version>.vsix
```

Then open the **Tandem Lite** view in the Activity Bar.

For local development, open this folder in VS Code and run the extension with the Extension Development Host (`F5`).

## Model configuration

Select **Settings** in the sidebar to configure Tandem Lite. Provider settings are saved globally in VS Code; non-Ollama API keys are stored in VS Code SecretStorage, not in this repository.

Supported planner providers:

- Ollama (default): local endpoint `http://127.0.0.1:11434`
- OpenAI
- Anthropic
- Google Gemini
- OpenAI-compatible endpoints

For local testing, `qwen3:4b` is the default planner. `qwen3:1.7b` is faster but less reliable for multi-step planning. The status model is optional and only produces short sidebar status text.

## Permissions and safety

The extension uses tool-specific policy settings. By default, actions such as terminal execution, opening locations/apps, searching outside the workspace, and controlling a window/UI require approval. Permissions can be changed in the Settings panel.

Approval is intentionally not a substitute for reviewing a plan. Before approving, verify that the listed paths, commands, applications, and UI actions are what you intended.

Tandem Lite is beta software. Do not use it for unattended automation, destructive production operations, or tasks where a mistaken command could cause unrecoverable loss. Recovery steps may differ from the original plan and should be reviewed through the permission prompts presented by the extension.

Tandem Lite does not bypass operating-system permissions, application security controls, anti-cheat systems, Windows UAC boundaries, or macOS privacy controls.

### macOS permissions

Opening applications and Finder locations does not require special setup. Window listing and accessible UI control require permission for the process hosting the extension:

1. Open **System Settings → Privacy & Security → Accessibility**.
2. Enable the VS Code application you use to run Tandem Lite.
3. Restart that VS Code application after granting access.

macOS may display the permission prompt the first time Tandem attempts an Accessibility action. Grant access only if you intend to use desktop control. Screen Recording is not required by the current extension runtime because it does not capture the screen.

## Privacy

Tandem Lite does not include product telemetry and does not upload workspace data to a Tandem-operated service. With Ollama, model requests stay on the configured endpoint. If you select OpenAI, Anthropic, Gemini, or another compatible remote provider, the objective, workspace path, available tool descriptions, failed-step details, and relevant plan/recovery context may be sent to that provider so it can create or repair a plan. Terminal output and tool results may be included in recovery context. Tandem Lite stores hosted-provider API keys in VS Code SecretStorage.

Do not use hosted providers with confidential tasks or workspaces unless your organization permits it and you have reviewed that provider's data-handling terms. See [PRIVACY.md](PRIVACY.md) for the beta data-handling statement.

## Current limitations

- Desktop actions depend on the target application exposing Windows UI Automation or macOS Accessibility controls.
- Custom-rendered, elevated, protected, game, and some Electron/browser interfaces may not expose controllable UI elements.
- The configured vision fallback model is reserved for future screenshot-based control; the current extension does **not** yet perform screenshot/vision fallback.
- Some desktop actions can only be verified as “requested” or “inconclusive” because operating systems do not always expose the resulting state to accessibility or shell APIs.
- Desktop controls are newly implemented and should be treated as experimental until they have broader end-to-end compatibility coverage.
- Active plans and activity history are not currently restored after an extension-host or VS Code restart.
- Provider availability, quotas, and model identifiers are controlled by their respective providers and may change.

## Development

Requirements: Node.js and VS Code. Windows or macOS is required to exercise native desktop tools end to end.

```sh
npm test
npx @vscode/vsce package
```

The test suite uses Node's built-in test runner. It does not replace end-to-end testing against real Windows or macOS applications.

## Repository hygiene

Local secrets, profiles, generated runtime artifacts, dependencies, editor state, and packaged VSIX files are excluded through `.gitignore`. Do not commit API keys or local machine-specific profiles.

## Support, security, and contributing

For help with Tandem Lite, email [partners@pqr.llc](mailto:partners@pqr.llc) or open a GitHub issue that does not contain credentials, private source code, or other sensitive data. This repository also includes [SUPPORT.md](SUPPORT.md), [SECURITY.md](SECURITY.md), [PRIVACY.md](PRIVACY.md), [CHANGELOG.md](CHANGELOG.md), and [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see the included LICENSE file.
