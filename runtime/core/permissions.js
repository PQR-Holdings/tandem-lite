const Permission = Object.freeze({ ALLOW: 'allow', ASK: 'ask', DENY: 'deny' });

class PermissionEngine {
  constructor(policy = {}) {
    this.policy = {
      'files.read': Permission.ALLOW,
      'files.write': Permission.ALLOW,
      'files.delete': Permission.ASK,
      'files.scan': Permission.ASK,
      'terminal.execute': Permission.ASK,
      'process.inspect': Permission.ALLOW,
      'process.stop': Permission.ASK,
      'git.inspect': Permission.ALLOW,
      'git.mutate': Permission.ASK,
      'http.local': Permission.ALLOW,
      'http.external': Permission.ASK,
      'windows.open': Permission.ASK,
      'desktop.inspect': Permission.ALLOW,
      'desktop.control': Permission.ASK,
      ...policy
    };
    this.once = new Set();
  }
  check(permission) { return this.once.has(permission) ? Permission.ALLOW : (this.policy[permission] || Permission.ASK); }
  allowOnce(permission) { this.once.add(permission); }
}

module.exports = { Permission, PermissionEngine };
