# Phase 1 Developer Computer Agent — Audit and Migration Plan

## Current state

The existing project is a CommonJS Node.js prototype for Windows desktop automation. Its runtime entry point is `src/index.js`; it loads a `.env`, captures/selects a window, asks an Ollama model for a JSON action, and sends PowerShell-based UI Automation, keyboard, mouse, or system-launch actions. Tests use Node's built-in test runner.

```text
CLI (.env + src/index.js)
  -> ComputerAgent (src/agent.js)
  -> OllamaPlanner (src/planner.js)
  -> WindowsInputAdapter / WindowComputerAdapter (src/window-computer.js)
  -> PowerShell scripts (capture, UIA, keyboard/mouse, app launch)
```

### Coupling and gaps

- `src/index.js` composes configuration, model choice, runtime, and Windows control directly.
- `src/planner.js` knows concrete desktop actions and controls model request details.
- The current state is a small in-memory action history, not an explicit developer-agent state machine.
- Verification is task-specific (for example wallpaper registry checks), not reusable for files, processes, tests, HTTP, or Git.
- Permission checks are tied to desktop input rather than a tool/operation policy.
- There is no extension boundary, workspace tool boundary, provider-neutral model gateway, output channel, persistence, or IPC protocol.

## Reuse classification

| Classification | Existing assets | Phase 1 decision |
| --- | --- | --- |
| KEEP | `.env` loader patterns, Node test setup, Ollama HTTP request knowledge | Reuse concepts in the runtime configuration/model provider layer. |
| REFACTOR | `ComputerAgent`, `Memory`, controller safety checks | Replace with explicit `AgentState`, controller, permission, verification, and recovery boundaries. |
| REPLACE | Desktop JSON action planner as the primary execution model | Phase 1 planner emits developer tool steps and expectations, not mouse actions. |
| DEFER | `src/window-computer.js`, Windows UIA scripts, screenshot capture, mouse/keyboard control, wallpaper/app launch behavior | Preserve unchanged as experimental desktop adapters behind future interfaces; do not expose them in the extension's Phase 1 UI. |

## Target gap analysis

| Component | Status | Notes |
| --- | --- | --- |
| VS Code integration | Missing | Added under `extension/`. |
| Runtime separation | Missing | Added under `runtime/` with stdio IPC. |
| Agent loop/planner | Partial | Existing desktop loop replaced by tool-step controller. |
| State, permissions, verification, recovery | Missing | Added as runtime services. |
| Files, terminal, processes, Git, HTTP | Missing | Added as workspace-scoped tools. |
| Ollama | Partial | Refactored into a provider adapter. |
| OpenAI, Anthropic, OpenAI-compatible | Missing | Provider adapters and settings added. |
| Logging/UI | Missing | Extension output channel, sidebar tree, status item, command palette added. |
| Browser/desktop/vision interfaces | Partial/deferred | Interfaces are defined but no Phase 1 execution surface. |

## Sequential migration

1. Add provider-neutral runtime configuration and tool contracts.
2. Add explicit state, permissions, verification, recovery, and tool registry.
3. Add filesystem, terminal, process, Git, and HTTP tools scoped to the workspace.
4. Add a stdio runtime server and native VS Code client shell.
5. Add sidebar, command palette commands, status item, timeline, and approval workflow.
6. Add integration fixtures/tests for workspace -> command -> HTTP/process verification.
7. Later: register the preserved desktop/vision prototype as experimental adapters without changing the Phase 1 controller.

## File disposition

- **Keep in place/defer:** `src/`, `scripts/`, `computer-profile*.json`, desktop tests.
- **Add:** `runtime/`, `extension/`, `docs/`, Phase 1 test fixtures.
- **Deprecate for Phase 1 only:** `npm start` desktop workflow. It is not removed because it remains the future desktop experimentation path.
