const { validateDecision } = require('./actions');

function inferUrlFromGoal(goal = '') {
  const explicit = goal.match(/https?:\/\/[^\s,]+/i);
  if (explicit) return explicit[0].replace(/[.)]+$/, '');
  const domain = goal.match(/\b(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+\b/i);
  return domain ? `https://${domain[0]}` : undefined;
}

function normalizeScreenshotPoint(point, window) {
  if (!point || point.x <= 1 && point.y <= 1) return point;
  if (!window || !Number.isFinite(window.width) || !Number.isFinite(window.height) || point.x < 0 || point.y < 0 || point.x > window.width || point.y > window.height) return point;
  return { x: point.x / window.width, y: point.y / window.height };
}

class RulePlanner {
  async decide(observation) {
    if (observation.terminal) return { action: 'STOP', reason: 'The scenario is complete.' };
    return { action: 'WAIT', reason: 'Wait for the simulated computer task to complete.' };
  }
}

class OllamaPlanner {
  constructor({ model, textModel, visionModel, baseUrl = 'http://127.0.0.1:11434', fallback = new RulePlanner(), fetchImpl = fetch }) {
    this.model = model;
    this.textModel = textModel || model;
    this.visionModel = visionModel || model;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.fallback = fallback;
    this.fetch = fetchImpl;
  }

  async decide(observation, memory) {
    const visualContext = { ...observation };
    delete visualContext.framePath;
    const usesVision = Boolean(observation.framePath);
    const selectedModel = usesVision ? this.visionModel : this.textModel;
    let enabledActions = Array.isArray(observation.availableActions) && observation.availableActions.length
      ? observation.availableActions : ['OPEN_APPLICATION', 'OPEN_TERMINAL', 'OPEN_BROWSER', 'CLOSE_WINDOW', 'PRESS_ENTER', 'PRESS_ESCAPE', 'PRESS_TAB', 'TYPE_TEXT', 'CLICK', 'DOUBLE_CLICK', 'DRAG', 'SCROLL', 'WAIT'];
    if (!observation.ui?.controls?.length) enabledActions = enabledActions.filter((action) => !action.startsWith('UIA_'));
    visualContext.availableActions = enabledActions;
    const terminalGuidance = enabledActions.includes('OPEN_TERMINAL') && /open (a |the )?terminal/i.test(observation.objective || '')
      ? 'The goal explicitly requires a new system terminal: choose OPEN_TERMINAL before attempting to type commands unless the screenshot already shows the newly opened terminal.' : '';
    const browserGuidance = enabledActions.includes('OPEN_BROWSER') && /open (a |the )?browser|navigate to|visit https?:\/\//i.test(observation.objective || '')
      ? 'If the goal requires opening a browser or navigating to a URL and the browser is not already showing the target page, choose OPEN_BROWSER with the requested URL before other actions.' : '';
    const tabGuidance = enabledActions.includes('CLOSE_TAB') && /(?:close.*tab|tab.*close)/i.test(observation.objective || '')
      ? 'The goal is to close a browser tab: choose CLOSE_TAB (not CLOSE_WINDOW and not a click) when the requested tab is active.' : '';
    const settingsGuidance = enabledActions.includes('OPEN_SYSTEM_SETTINGS') && /\b(background|wallpaper|personalization)\b/i.test(observation.objective || '')
      ? 'This is a Windows background/personalization task. If the screenshot is not already the Background settings page, choose OPEN_SYSTEM_SETTINGS with page "personalization-background"; do not select an unrelated app.' : '';
    const automationGuidance = observation.ui?.controls?.length
      ? 'A Windows UI Automation control tree is available. Prefer UIA_INVOKE for buttons/tabs and UIA_SET_VALUE for text fields, using an exact listed control key. Use visual click actions only when no suitable automation control exists.' : 'No usable UI Automation tree is available; use the screenshot and keyboard/mouse fallback.';
    const prompt = `You control a permitted local desktop application. Inspect the current screenshot when one is supplied. Return ONLY JSON. Use {"action":"one enabled action","reason":"brief"}; for OPEN_APPLICATION add an "application" (prefer a discovered name); for TYPE_TEXT add "text"; for OPEN_BROWSER add an http(s) "url"; for UIA_INVOKE or UIA_FOCUS add an exact UI Automation control "element" key; for UIA_SET_VALUE add "element" and "value"; for CLICK or DOUBLE_CLICK add "target":{"x":0-1,"y":0-1} normalized to the captured window; for DRAG add target and "to"; for SCROLL add integer "delta" (-10 to 10). When the user goal is visibly complete, return {"action":"STOP","complete":true,"reason":"brief"}. Enabled actions: ${enabledActions.join(', ')}, STOP. You must select only an enabled action or STOP. Never close an application merely because it is unrelated; only close windows or tabs when the user explicitly asks. ${automationGuidance} For desktop tasks, use TYPE_TEXT to enter text into the focused field and PRESS_ENTER to submit it. ${terminalGuidance} ${browserGuidance} ${tabGuidance} ${settingsGuidance} Choose STOP only when the goal is complete or you truly cannot continue safely.\nUser goal: ${observation.objective || 'Continue the configured task safely.'}\nDiscovered applications: ${(observation.applications || []).join(', ') || 'none'}\nObservation: ${JSON.stringify(visualContext)}\nRecent memory: ${memory.summary()}`;
    try {
      const response = await this.fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: selectedModel, prompt, stream: false, format: 'json', keep_alive: '30m', images: usesVision ? [require('node:fs').readFileSync(observation.framePath).toString('base64')] : undefined, options: { temperature: 0 } })
      });
      if (!response.ok) throw new Error(`Ollama returned ${response.status}`);
      const payload = await response.json();
      // Some reasoning models, including Qwen3-VL, place structured output in
      // `thinking` and leave `response` empty (or whitespace) even when
      // format=json is set. Try each non-empty field independently.
      const candidates = [payload.response, payload.thinking]
        .filter((value) => typeof value === 'string' && value.trim());
      let parseError;
      for (const candidate of candidates) {
        try {
          const rawDecision = JSON.parse(candidate.trim());
          if (rawDecision.action === 'OPEN_BROWSER' && !rawDecision.url) rawDecision.url = inferUrlFromGoal(observation.objective);
          if (rawDecision.target) rawDecision.target = normalizeScreenshotPoint(rawDecision.target, observation.window);
          if (rawDecision.to) rawDecision.to = normalizeScreenshotPoint(rawDecision.to, observation.window);
          const decision = validateDecision(rawDecision);
          if (decision.action !== 'STOP' && !enabledActions.includes(decision.action)) throw new Error(`${decision.action} is not enabled for the currently available control mode.`);
          return decision;
        }
        catch (error) { parseError = error; }
      }
      throw parseError || new Error('Ollama returned no decision text.');
    } catch (error) {
      const fallback = await this.fallback.decide(observation, memory);
      return { ...fallback, reason: `Fallback after Ollama error: ${error.message}` };
    }
  }
}

module.exports = { RulePlanner, OllamaPlanner, inferUrlFromGoal, normalizeScreenshotPoint };
