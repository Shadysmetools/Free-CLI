import { describe, it, expect } from 'vitest';
import { TOOLS } from './tools';
import { createDefaultRegistry } from '../registry/index';

describe('web tools wiring', () => {
  it('web_search and web_fetch are in TOOLS', () => {
    const names = TOOLS.map(t => t.name);
    expect(names).toContain('web_search');
    expect(names).toContain('web_fetch');
    expect(names).not.toContain('api_call'); // explicitly excluded
  });
  it('default registry exposes them under the web category', () => {
    const reg = createDefaultRegistry();
    const names = reg.getEnabled().map(t => t.name);
    expect(names).toContain('web_search');
    expect(names).toContain('web_fetch');
    expect(reg.get('web_search')!.category).toBe('web');
  });
});
