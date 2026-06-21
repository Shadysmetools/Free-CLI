import { describe, it, expect } from 'vitest';
import { getDefaultSettings } from './settings';

describe('settings.router defaults', () => {
  it('router is enabled with a 0.6 threshold and goal-confirm on', () => {
    const s = getDefaultSettings();
    expect(s.router).toBeDefined();
    expect(s.router!.enabled).toBe(true);
    expect(s.router!.confidenceThreshold).toBe(0.6);
    expect(s.router!.confirmGoal).toBe(true);
    expect(s.router!.autoRunSafe).toBe(true);
    expect(s.router!.llmAssist).toBe(false);
  });
  it('ollama provider defaults to the nomic-embed-text embeddings model', () => {
    const s = getDefaultSettings();
    expect(s.providers.ollama.embeddingsModel).toBe('nomic-embed-text');
  });
});
