class Memory {
  constructor(limit = 12) {
    this.limit = limit;
    this.events = [];
  }

  record(observation, decision, result) {
    this.events.push({ tick: observation.tick, decision, result, hp: observation.hp, goal: observation.goal });
    if (this.events.length > this.limit) this.events.shift();
  }

  summary() {
    return this.events.slice(-5).map((event) =>
      `t${event.tick}: ${event.decision.action} (${event.result.status})`).join('; ');
  }
}

module.exports = { Memory };
