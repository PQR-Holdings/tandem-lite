const ACTIONS = Object.freeze(['OPEN_APPLICATION', 'OPEN_SYSTEM_SETTINGS', 'OPEN_TERMINAL', 'OPEN_BROWSER', 'UIA_INVOKE', 'UIA_SET_VALUE', 'UIA_FOCUS', 'CLOSE_WINDOW', 'CLOSE_TAB', 'PRESS_ENTER', 'PRESS_ESCAPE', 'PRESS_TAB', 'TYPE_TEXT', 'CLICK', 'DOUBLE_CLICK', 'DRAG', 'SCROLL', 'WAIT', 'STOP', 'MOVE_LEFT', 'MOVE_RIGHT', 'ATTACK', 'HEAL', 'INTERACT']);

function isAction(value) {
  return ACTIONS.includes(value);
}

function validateDecision(decision) {
  if (!decision || typeof decision !== 'object' || !isAction(decision.action)) {
    throw new Error(`Invalid decision: expected one of ${ACTIONS.join(', ')}`);
  }
  const result = { action: decision.action, reason: String(decision.reason || '') };
  if (decision.action === 'TYPE_TEXT') {
    if (typeof decision.text !== 'string' || decision.text.length === 0 || decision.text.length > 500) {
      throw new Error('TYPE_TEXT requires non-empty text no longer than 500 characters.');
    }
    result.text = decision.text;
  }
  if (decision.action === 'OPEN_BROWSER') {
    if (typeof decision.url !== 'string' || !/^https?:\/\/.+/i.test(decision.url) || decision.url.length > 2048) throw new Error('OPEN_BROWSER requires an http(s) URL.');
    result.url = decision.url;
  }
  if (decision.action === 'OPEN_APPLICATION') {
    if (typeof decision.application !== 'string' || !decision.application.trim() || decision.application.length > 160) throw new Error('OPEN_APPLICATION requires an application name.');
    result.application = decision.application.trim();
  }
  if (decision.action === 'OPEN_SYSTEM_SETTINGS') {
    if (typeof decision.page !== 'string' || !/^[a-z0-9-]+$/i.test(decision.page) || decision.page.length > 100) throw new Error('OPEN_SYSTEM_SETTINGS requires a Windows Settings page identifier.');
    result.page = decision.page;
  }
  if (['UIA_INVOKE', 'UIA_SET_VALUE', 'UIA_FOCUS'].includes(decision.action)) {
    if (typeof decision.element !== 'string' || !decision.element.trim() || decision.element.length > 200) throw new Error(`${decision.action} requires a UI Automation element key.`);
    result.element = decision.element.trim();
    if (decision.action === 'UIA_SET_VALUE') {
      if (typeof decision.value !== 'string' || decision.value.length > 500) throw new Error('UIA_SET_VALUE requires text no longer than 500 characters.');
      result.value = decision.value;
    }
  }
  if (['CLICK', 'DOUBLE_CLICK', 'DRAG'].includes(decision.action)) {
    if (!decision.target || !Number.isFinite(decision.target.x) || !Number.isFinite(decision.target.y) || decision.target.x < 0 || decision.target.x > 1 || decision.target.y < 0 || decision.target.y > 1) {
      throw new Error(`${decision.action} requires target x/y normalized between 0 and 1.`);
    }
    result.target = { x: decision.target.x, y: decision.target.y };
    if (decision.action === 'DRAG') {
      if (!decision.to || !Number.isFinite(decision.to.x) || !Number.isFinite(decision.to.y) || decision.to.x < 0 || decision.to.x > 1 || decision.to.y < 0 || decision.to.y > 1) throw new Error('DRAG requires destination x/y normalized between 0 and 1.');
      result.to = { x: decision.to.x, y: decision.to.y };
    }
  }
  if (decision.action === 'SCROLL') {
    if (!Number.isInteger(decision.delta) || Math.abs(decision.delta) > 10 || decision.delta === 0) throw new Error('SCROLL requires a non-zero whole delta between -10 and 10.');
    result.delta = decision.delta;
  }
  if (decision.complete === true) result.complete = true;
  return result;
}

module.exports = { ACTIONS, isAction, validateDecision };
