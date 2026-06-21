/** Semantic embeddings via Ollama `/api/embed`. Never throws — returns null on failure. */
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

export interface EmbedOpts {
  baseUrl: string;
  model: string;
  /** Injectable for tests; defaults to a real http/https POST. Returns raw body (string) or parsed object. */
  httpPost?: (url: string, body: unknown) => Promise<unknown>;
}

export async function embed(texts: string[], opts: EmbedOpts): Promise<number[][] | null> {
  if (!texts || texts.length === 0) return [];
  const post = opts.httpPost ?? defaultHttpPost;
  try {
    const url = `${opts.baseUrl.replace(/\/$/, '')}/api/embed`;
    const res = await post(url, { model: opts.model, input: texts });
    const data = (typeof res === 'string' ? JSON.parse(res) : res) as { embeddings?: number[][] };
    const embeddings = data?.embeddings;
    if (!Array.isArray(embeddings) || embeddings.length !== texts.length) return null;
    return embeddings;
  } catch {
    return null;
  }
}

export function cosine(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function defaultHttpPost(url: string, body: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) },
    }, (res) => {
      let data = '';
      res.on('data', (c: Buffer) => (data += c));
      res.on('end', () => {
        if ((res.statusCode || 200) >= 400) reject(new Error(`Embed error ${res.statusCode}: ${data}`));
        else resolve(data);
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(Number(process.env.OLLAMA_TIMEOUT_MS) || 600_000, () => {
      req.destroy(new Error('Ollama embed request timed out.'));
    });
    req.write(bodyStr);
    req.end();
  });
}
