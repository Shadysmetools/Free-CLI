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
exports.loadProjectConfig = loadProjectConfig;
exports.findGitRoot = findGitRoot;
exports.initProjectMemory = initProjectMemory;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const PROJECT_MEMORY_FILES = ['KNOWCAP.md', 'CLAUDE.md', '.knowcap', '.ai-context'];
function loadProjectConfig(cwd = process.cwd()) {
    const projectRoot = cwd;
    const gitRoot = findGitRoot(cwd);
    // Look for memory file
    let memoryFile = null;
    let memoryContent = null;
    const searchDirs = [cwd];
    if (gitRoot && gitRoot !== cwd)
        searchDirs.push(gitRoot);
    for (const dir of searchDirs) {
        for (const filename of PROJECT_MEMORY_FILES) {
            const filePath = path.join(dir, filename);
            if (fs.existsSync(filePath)) {
                memoryFile = filePath;
                memoryContent = fs.readFileSync(filePath, 'utf-8');
                break;
            }
        }
        if (memoryFile)
            break;
    }
    return { memoryFile, memoryContent, projectRoot, gitRoot };
}
function findGitRoot(cwd) {
    let dir = cwd;
    while (true) {
        if (fs.existsSync(path.join(dir, '.git'))) {
            return dir;
        }
        const parent = path.dirname(dir);
        if (parent === dir)
            return null;
        dir = parent;
    }
}
function initProjectMemory(cwd) {
    const filePath = path.join(cwd, 'KNOWCAP.md');
    const content = `# KNOWCAP.md — Project Memory

This file is read by knowcap-code at startup to understand your project.
Customize it with project-specific context, conventions, and instructions.

## Project Overview
[Describe your project here]

## Tech Stack
[List your main technologies]

## Code Style
[Describe your coding conventions]

## Key Commands
\`\`\`bash
# Build
npm run build

# Test
npm test

# Lint
npm run lint
\`\`\`

## Important Notes
[Any special instructions for the AI assistant]
`;
    fs.writeFileSync(filePath, content, 'utf-8');
    return filePath;
}
//# sourceMappingURL=project.js.map