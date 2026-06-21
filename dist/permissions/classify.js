"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.isInside = isInside;
exports.subjectsFor = subjectsFor;
exports.classify = classify;
const path = __importStar(require("path"));
const rules_1 = require("./rules");
const KNOWN_SAFE = new Set([
    'read_file', 'search_files', 'list_files',
    'git_status', 'git_diff', 'git_log', 'memory_search', 'memory_save',
    'web_search', 'web_fetch', 'skill',
]);
const DESTRUCTIVE = [
    /\brm\s+-[rf]{1,2}\b/i, /\brm\s+-fr\b/i,
    /\bdel\s+\/s\b/i, /\bdel\s+\/q\b/i, /\brmdir\s+\/s\b/i, /\brd\s+\/s\b/i,
    /\bformat\b/i, /\bmkfs/i, /\bdd\s+if=/i, /\bshutdown\b/i, /\breg\s+delete\b/i,
    /:\(\)\s*\{/, />\s*\/dev\/sd/i,
];
function isInside(root, target) {
    const r = path.resolve(root);
    const t = path.resolve(target);
    const norm = (s) => (process.platform === 'win32' ? s.toLowerCase() : s);
    const rN = norm(r);
    const tN = norm(t);
    if (tN === rN)
        return true;
    return tN.startsWith(rN.endsWith(path.sep) ? rN : rN + path.sep);
}
function argPath(args) {
    const p = args.path ?? args.output_path;
    return typeof p === 'string' ? p : undefined;
}
function resolveArg(p, root) {
    return path.isAbsolute(p) ? p : path.resolve(root, p);
}
function subjectsFor(toolName, args, root) {
    if (toolName === 'run_command')
        return [String(args.command ?? '')];
    if (toolName === 'git_commit')
        return ['git_commit', 'git commit'];
    const p = argPath(args);
    if (p) {
        const resolved = resolveArg(p, root);
        return [`${toolName} ${resolved}`, resolved, `${toolName} ${p}`, p];
    }
    return [toolName, `${toolName} ${JSON.stringify(args)}`];
}
function classify(toolName, args, root, rules) {
    const subjects = subjectsFor(toolName, args, root);
    const primary = subjects[0];
    if (!rules.enabled) {
        return { decision: 'silent', severity: 'normal', reasons: ['permissions disabled'], subject: primary };
    }
    if ((0, rules_1.matchesAny)(rules.deny, subjects)) {
        return { decision: 'block', severity: 'warn', reasons: ['matched a user deny rule'], subject: primary };
    }
    if ((0, rules_1.matchesAny)(rules.allow, subjects)) {
        return { decision: 'silent', severity: 'normal', reasons: ['matched a user allow rule'], subject: primary };
    }
    if ((0, rules_1.matchesAny)(rules_1.DEFAULT_DENY, subjects)) {
        return { decision: 'block', severity: 'warn', reasons: ['catastrophic action blocked by default'], subject: primary };
    }
    const forcedAsk = (0, rules_1.matchesAny)(rules.ask, subjects);
    if (!forcedAsk && KNOWN_SAFE.has(toolName)) {
        return { decision: 'silent', severity: 'normal', reasons: ['read-only tool'], subject: primary };
    }
    if (toolName === 'run_command') {
        const cmd = String(args.command ?? '');
        const destructive = DESTRUCTIVE.some(re => re.test(cmd));
        const cwdArg = typeof args.cwd === 'string' ? args.cwd : undefined;
        const outside = cwdArg ? !isInside(root, resolveArg(cwdArg, root)) : false;
        const reasons = ['shell command'];
        if (destructive)
            reasons.push('destructive command pattern');
        if (outside)
            reasons.push('runs outside project root');
        return { decision: 'ask', severity: destructive || outside ? 'warn' : 'normal', reasons, subject: cmd };
    }
    if (toolName === 'write_file' || toolName === 'edit_file') {
        const p = argPath(args) ?? '';
        const resolved = resolveArg(p, root);
        const inside = isInside(root, resolved);
        if (inside && !forcedAsk) {
            return { decision: 'silent', severity: 'normal', reasons: ['in-project file change'], subject: resolved };
        }
        return {
            decision: 'ask',
            severity: inside ? 'normal' : 'warn',
            reasons: inside ? ['forced ask'] : ['writes outside project root'],
            subject: resolved,
        };
    }
    return { decision: 'ask', severity: 'normal', reasons: ['consequential / not a known-safe tool'], subject: primary };
}
//# sourceMappingURL=classify.js.map