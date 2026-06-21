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
exports.DEFAULT_DENY = void 0;
exports.defaultRules = defaultRules;
exports.loadPermissionRules = loadPermissionRules;
exports.matchPattern = matchPattern;
exports.matchesAny = matchesAny;
exports.persistAllowPattern = persistAllowPattern;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const yaml = __importStar(require("yaml"));
const settings_1 = require("../config/settings");
/** Catastrophic patterns blocked by default. User `allow` rules can override these. */
exports.DEFAULT_DENY = [
    'rm -rf /', 'rm -rf /*', 'rm -rf ~', 'rm -rf ~/*', 'rm -fr /',
    'mkfs*', 'format *', 'del /s /q c:\\*', 'rd /s /q c:\\*',
];
function defaultRules(projectRoot) {
    return {
        enabled: true,
        projectRoot: path.resolve(projectRoot),
        allow: [],
        ask: [],
        deny: [],
        unattended: 'deny',
        confirmDefault: 'approve',
    };
}
function applyLayer(base, layer) {
    if (!layer)
        return base;
    return {
        enabled: layer.enabled ?? base.enabled,
        projectRoot: base.projectRoot,
        allow: [...base.allow, ...(layer.allow ?? [])],
        ask: [...base.ask, ...(layer.ask ?? [])],
        deny: [...base.deny, ...(layer.deny ?? [])],
        unattended: layer.unattended ?? base.unattended,
        confirmDefault: layer.confirmDefault ?? base.confirmDefault,
    };
}
function loadPermissionRules(cwd, globalPerms) {
    let merged = applyLayer(defaultRules(cwd), globalPerms);
    const projFile = path.join(cwd, '.coderaw', 'permissions.yaml');
    if (fs.existsSync(projFile)) {
        try {
            const raw = yaml.parse(fs.readFileSync(projFile, 'utf-8'));
            merged = applyLayer(merged, raw);
        }
        catch { /* ignore invalid project rules file */ }
    }
    if (globalPerms?.projectRoot && globalPerms.projectRoot !== 'auto') {
        merged.projectRoot = path.resolve(globalPerms.projectRoot);
    }
    else {
        merged.projectRoot = path.resolve(cwd);
    }
    return merged;
}
/** Glob-ish: '*' wildcard, case-insensitive, full match, trimmed. */
function matchPattern(pattern, subject) {
    const esc = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${esc}$`, 'i').test(subject.trim());
}
function matchesAny(patterns, subjects) {
    return patterns.some(p => subjects.some(s => matchPattern(p, s)));
}
/** Append a pattern to the global config's permissions.allow and save. */
function persistAllowPattern(pattern) {
    const settings = (0, settings_1.loadSettings)();
    settings.permissions = settings.permissions ?? {};
    settings.permissions.allow = settings.permissions.allow ?? [];
    if (!settings.permissions.allow.includes(pattern)) {
        settings.permissions.allow.push(pattern);
        (0, settings_1.saveSettings)(settings);
    }
}
//# sourceMappingURL=rules.js.map