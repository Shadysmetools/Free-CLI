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
exports.parseWorkflow = parseWorkflow;
exports.workflowDirs = workflowDirs;
exports.loadWorkflows = loadWorkflows;
/**
 * Discover + parse YAML workflow files. Search order (later wins on name
 * collision): user dir (~/.coderaw/workflows or %APPDATA%\coderaw\workflows)
 * then the project dir (./.coderaw/workflows). Invalid files are skipped.
 */
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const yaml = __importStar(require("yaml"));
const schema_1 = require("./schema");
function parseWorkflow(text) {
    let raw;
    try {
        raw = yaml.parse(text);
    }
    catch (e) {
        return { ok: false, errors: [`YAML parse error: ${e.message}`] };
    }
    return (0, schema_1.validateWorkflow)(raw);
}
function workflowDirs(cwd) {
    const userBase = process.platform === 'win32'
        ? path.join(process.env.APPDATA ?? os.homedir(), 'coderaw')
        : path.join(os.homedir(), '.coderaw');
    return [path.join(userBase, 'workflows'), path.join(cwd, '.coderaw', 'workflows')];
}
function loadWorkflows(dirs) {
    const map = new Map();
    for (const dir of dirs) {
        if (!fs.existsSync(dir))
            continue;
        for (const file of fs.readdirSync(dir)) {
            if (!/\.ya?ml$/i.test(file))
                continue;
            try {
                const r = parseWorkflow(fs.readFileSync(path.join(dir, file), 'utf-8'));
                if (r.ok)
                    map.set(r.def.name, r.def);
            }
            catch { /* skip unreadable file */ }
        }
    }
    return map;
}
//# sourceMappingURL=loader.js.map