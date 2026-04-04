import * as fs from 'fs';
import * as path from 'path';

const PROJECT_MEMORY_FILES = ['KNOWCAP.md', 'CLAUDE.md', '.knowcap', '.ai-context'];

export interface ProjectConfig {
  memoryFile: string | null;
  memoryContent: string | null;
  projectRoot: string;
  gitRoot: string | null;
}

export function loadProjectConfig(cwd: string = process.cwd()): ProjectConfig {
  const projectRoot = cwd;
  const gitRoot = findGitRoot(cwd);

  // Look for memory file
  let memoryFile: string | null = null;
  let memoryContent: string | null = null;

  const searchDirs = [cwd];
  if (gitRoot && gitRoot !== cwd) searchDirs.push(gitRoot);

  for (const dir of searchDirs) {
    for (const filename of PROJECT_MEMORY_FILES) {
      const filePath = path.join(dir, filename);
      if (fs.existsSync(filePath)) {
        memoryFile = filePath;
        memoryContent = fs.readFileSync(filePath, 'utf-8');
        break;
      }
    }
    if (memoryFile) break;
  }

  return { memoryFile, memoryContent, projectRoot, gitRoot };
}

export function findGitRoot(cwd: string): string | null {
  let dir = cwd;
  while (true) {
    if (fs.existsSync(path.join(dir, '.git'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function initProjectMemory(cwd: string): string {
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
