"use strict";
/**
 * Diagram & Image Generation
 *
 * Mermaid diagrams — rendered via @mermaid-js/mermaid-cli (mmdc)
 *   Flowcharts, sequence, class, ER, Gantt, architecture, mindmap
 *
 * Image generation — AI-powered, provider-dependent
 *   OpenAI DALL-E 3 (requires OPENAI_API_KEY)
 *   Stability AI (requires STABILITY_API_KEY)
 *   Graceful skip if no image API available
 */
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
exports.normaliseMermaid = normaliseMermaid;
exports.generateDiagram = generateDiagram;
exports.mermaidPreview = mermaidPreview;
exports.generateImage = generateImage;
exports.detectDiagramType = detectDiagramType;
exports.buildDiagramPrompt = buildDiagramPrompt;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const child_process = __importStar(require("child_process"));
const https = __importStar(require("https"));
// ─── Mermaid helpers ──────────────────────────────────────────────────────────
/** Map short type names to Mermaid directive keywords */
const TYPE_DIRECTIVE = {
    flowchart: 'flowchart TD',
    sequence: 'sequenceDiagram',
    class: 'classDiagram',
    er: 'erDiagram',
    gantt: 'gantt',
    architecture: 'architecture-beta',
    mindmap: 'mindmap',
    timeline: 'timeline',
    mermaid: '', // raw — user supplies full code
};
/**
 * Ensure the Mermaid code block starts with the right directive.
 * If the code already has a directive, leave it alone.
 */
function normaliseMermaid(code, type) {
    const clean = code.trim();
    const directive = TYPE_DIRECTIVE[type];
    // Already has a known directive
    if (!directive || /^(flowchart|sequenceDiagram|classDiagram|erDiagram|gantt|architecture|mindmap|timeline|graph)\b/i.test(clean)) {
        return clean;
    }
    return `${directive}\n${clean}`;
}
/** Locate the mmdc binary: local node_modules → npx fallback */
function findMmdc() {
    // Walk up from the module file to find node_modules/.bin/mmdc
    const candidates = [
        path.join(__dirname, '..', '..', 'node_modules', '.bin', 'mmdc'),
        path.join(process.cwd(), 'node_modules', '.bin', 'mmdc'),
        path.join(os.homedir(), '.npm-global', 'bin', 'mmdc'),
    ];
    for (const c of candidates) {
        if (fs.existsSync(c))
            return c;
    }
    // Last resort: rely on PATH
    try {
        const whichCmd = process.platform === 'win32' ? 'where mmdc' : 'which mmdc';
        child_process.execSync(whichCmd, { stdio: 'ignore' });
        return 'mmdc';
    }
    catch {
        throw new Error('mmdc (Mermaid CLI) not found. Install it:\n' +
            '  npm install @mermaid-js/mermaid-cli\n' +
            'or globally:\n' +
            '  npm install -g @mermaid-js/mermaid-cli');
    }
}
async function generateDiagram(opts) {
    const { type = 'mermaid', code, outputPath, format = 'png', width = 1200, backgroundColor = 'white', onProgress, } = opts;
    const mermaidCode = normaliseMermaid(code, type);
    // Write temp .mmd file
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kcc-diagram-'));
    const mmdFile = path.join(tmpDir, 'diagram.mmd');
    const configFile = path.join(tmpDir, 'config.json');
    fs.writeFileSync(mmdFile, mermaidCode, 'utf-8');
    // Mermaid config — clean white theme, good for docs
    fs.writeFileSync(configFile, JSON.stringify({
        theme: 'default',
        themeVariables: {
            primaryColor: '#4A90D9',
            primaryTextColor: '#1a1a2e',
            primaryBorderColor: '#2c5282',
            lineColor: '#4A90D9',
            fontFamily: '"Segoe UI", system-ui, sans-serif',
            fontSize: '14px',
        },
    }), 'utf-8');
    // Ensure output dir exists
    const outDir = path.dirname(path.resolve(outputPath));
    if (!fs.existsSync(outDir))
        fs.mkdirSync(outDir, { recursive: true });
    const outAbsolute = path.resolve(outputPath);
    const mmdc = findMmdc();
    onProgress?.(`Rendering ${type} diagram with Mermaid CLI…`);
    const args = [
        '-i', mmdFile,
        '-o', outAbsolute,
        '-t', 'default',
        '-b', backgroundColor,
        '-w', String(width),
        '--configFile', configFile,
        '--quiet',
    ];
    await new Promise((resolve, reject) => {
        const proc = child_process.spawn(mmdc, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 60000,
        });
        const errLines = [];
        proc.stderr?.on('data', (d) => {
            const line = d.toString().trim();
            if (line && !line.includes('Browserless') && !line.includes('puppeteer')) {
                errLines.push(line);
            }
        });
        proc.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`mmdc failed (code ${code}): ${errLines.slice(-3).join(' | ')}`));
            }
            else {
                resolve();
            }
        });
        proc.on('error', (err) => {
            reject(new Error(`mmdc spawn error: ${err.message}`));
        });
    });
    // mmdc might append the extension even if it's already there
    let finalPath = outAbsolute;
    if (!fs.existsSync(finalPath)) {
        const withExt = `${outAbsolute}.${format}`;
        if (fs.existsSync(withExt)) {
            finalPath = withExt;
        }
        else {
            throw new Error(`Diagram output not found at ${outAbsolute}`);
        }
    }
    const stat = fs.statSync(finalPath);
    // Clean up temp dir
    setTimeout(() => {
        try {
            fs.rmSync(tmpDir, { recursive: true });
        }
        catch { /* ignore */ }
    }, 5000);
    return {
        outputPath: finalPath,
        format,
        type,
        mermaidCode,
        sizeBytes: stat.size,
    };
}
// ─── Mermaid Code Box (terminal display) ─────────────────────────────────────
/** Return a display-friendly excerpt of Mermaid code (max 8 lines) */
function mermaidPreview(code) {
    const lines = code.trim().split('\n');
    const preview = lines.slice(0, 8);
    const truncated = lines.length > 8;
    return preview.join('\n') + (truncated ? `\n  … (${lines.length - 8} more lines)` : '');
}
async function generateImage(opts) {
    const { prompt, outputPath, size = '1024x1024', quality = 'standard', style = 'vivid', openaiKey, stabilityKey, onProgress, } = opts;
    const outDir = path.dirname(path.resolve(outputPath));
    if (!fs.existsSync(outDir))
        fs.mkdirSync(outDir, { recursive: true });
    const outAbsolute = path.resolve(outputPath);
    // ── DALL-E 3 (OpenAI) ──────────────────────────────────────────────────────
    const openaiApiKey = openaiKey || process.env.OPENAI_API_KEY;
    if (openaiApiKey) {
        onProgress?.('Calling DALL-E 3 via OpenAI API…');
        const imageUrl = await dalleGenerate(prompt, size, quality, style, openaiApiKey);
        onProgress?.('Downloading image…');
        await downloadFile(imageUrl, outAbsolute);
        const stat = fs.statSync(outAbsolute);
        return { outputPath: outAbsolute, provider: 'dalle', prompt, sizeBytes: stat.size };
    }
    // ── Stability AI ───────────────────────────────────────────────────────────
    const stabilityApiKey = stabilityKey || process.env.STABILITY_API_KEY;
    if (stabilityApiKey) {
        onProgress?.('Calling Stability AI API…');
        const [w, h] = (size || '1024x1024').split('x').map(Number);
        await stabilityGenerate(prompt, outAbsolute, w || 1024, h || 1024, stabilityApiKey, onProgress);
        const stat = fs.statSync(outAbsolute);
        return { outputPath: outAbsolute, provider: 'stability', prompt, sizeBytes: stat.size };
    }
    // ── No image provider — generate placeholder SVG ──────────────────────────
    onProgress?.('No image API key found — generating placeholder SVG…');
    const placeholderPath = outAbsolute.replace(/\.[^/.]+$/, '') + '.svg';
    const svgContent = makePlaceholderSvg(prompt, size);
    fs.writeFileSync(placeholderPath, svgContent, 'utf-8');
    const stat = fs.statSync(placeholderPath);
    return { outputPath: placeholderPath, provider: 'placeholder', prompt, sizeBytes: stat.size };
}
// ─── DALL-E 3 ─────────────────────────────────────────────────────────────────
async function dalleGenerate(prompt, size, quality, style, apiKey) {
    const body = JSON.stringify({
        model: 'dall-e-3',
        prompt,
        n: 1,
        size,
        quality,
        style,
        response_format: 'url',
    });
    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: 'api.openai.com',
            path: '/v1/images/generations',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
            },
        }, (res) => {
            let raw = '';
            res.on('data', (d) => { raw += d; });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(raw);
                    if (parsed.error) {
                        reject(new Error(`DALL-E: ${parsed.error.message}`));
                        return;
                    }
                    const url = parsed.data?.[0]?.url;
                    if (!url) {
                        reject(new Error('DALL-E returned no image URL'));
                        return;
                    }
                    resolve(url);
                }
                catch (err) {
                    reject(err);
                }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}
// ─── Stability AI ─────────────────────────────────────────────────────────────
async function stabilityGenerate(prompt, outputPath, width, height, apiKey, onProgress) {
    // Stability v2beta generate endpoint
    const body = JSON.stringify({
        text_prompts: [{ text: prompt, weight: 1 }],
        cfg_scale: 7,
        height: Math.min(height, 1024),
        width: Math.min(width, 1024),
        steps: 30,
        samples: 1,
    });
    onProgress?.('Waiting for Stability AI to render…');
    const imageBase64 = await new Promise((resolve, reject) => {
        const req = https.request({
            hostname: 'api.stability.ai',
            path: '/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Content-Length': Buffer.byteLength(body),
            },
        }, (res) => {
            let raw = '';
            res.on('data', (d) => { raw += d; });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(raw);
                    if (parsed.message) {
                        reject(new Error(`Stability: ${parsed.message}`));
                        return;
                    }
                    const b64 = parsed.artifacts?.[0]?.base64;
                    if (!b64) {
                        reject(new Error('Stability returned no image'));
                        return;
                    }
                    resolve(b64);
                }
                catch (err) {
                    reject(err);
                }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
    fs.writeFileSync(outputPath, Buffer.from(imageBase64, 'base64'));
}
// ─── Placeholder SVG ──────────────────────────────────────────────────────────
function makePlaceholderSvg(prompt, size) {
    const [w, h] = (size || '512x512').split('x').map(n => parseInt(n, 10) || 512);
    const shortPrompt = prompt.length > 80 ? prompt.slice(0, 77) + '…' : prompt;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#1a1a2e"/>
      <stop offset="100%" style="stop-color:#16213e"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)" rx="12"/>
  <text x="${w / 2}" y="${h / 2 - 30}" font-family="system-ui,sans-serif" font-size="48" fill="#4A90D9" text-anchor="middle">🎨</text>
  <text x="${w / 2}" y="${h / 2 + 10}" font-family="system-ui,sans-serif" font-size="16" fill="#e2e8f0" text-anchor="middle">${escapeXml(shortPrompt)}</text>
  <text x="${w / 2}" y="${h / 2 + 40}" font-family="system-ui,sans-serif" font-size="13" fill="#718096" text-anchor="middle">Set OPENAI_API_KEY or STABILITY_API_KEY for real images</text>
  <text x="${w / 2}" y="${h - 20}" font-family="system-ui,sans-serif" font-size="12" fill="#4A5568" text-anchor="middle">Generated by knowcap-code</text>
</svg>`;
}
function escapeXml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
// ─── HTTP file download ───────────────────────────────────────────────────────
function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        const protocol = url.startsWith('https') ? https : require('http');
        protocol.get(url, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                file.close();
                downloadFile(res.headers.location, dest).then(resolve).catch(reject);
                return;
            }
            res.pipe(file);
            file.on('finish', () => file.close(() => resolve()));
            file.on('error', reject);
        }).on('error', (err) => {
            fs.unlink(dest, () => { });
            reject(err);
        });
    });
}
// ─── Diagram type detection ───────────────────────────────────────────────────
/** Guess diagram type from a user description */
function detectDiagramType(description) {
    const d = description.toLowerCase();
    if (/sequence|message|call flow|interaction|api call/.test(d))
        return 'sequence';
    if (/class|inherit|extend|implement|uml/.test(d))
        return 'class';
    if (/entity|relation|er diagram|database schema|table/.test(d))
        return 'er';
    if (/gantt|timeline|schedule|sprint|milestone|project plan/.test(d))
        return 'gantt';
    if (/mindmap|mind map|brainstorm/.test(d))
        return 'mindmap';
    if (/architecture|microservice|infra|system design|cloud|deploy/.test(d))
        return 'architecture';
    if (/timeline|history|chronolog/.test(d))
        return 'timeline';
    return 'flowchart';
}
/** Build a prompt that asks the AI to produce a specific diagram type */
function buildDiagramPrompt(description, type) {
    const directive = TYPE_DIRECTIVE[type] || 'flowchart TD';
    const typeHints = {
        flowchart: 'Use flowchart TD syntax with decision diamonds, rectangles for steps, and clear edge labels.',
        sequence: 'Use sequenceDiagram with participant labels. Show request/response pairs.',
        class: 'Use classDiagram with class names, attributes (+/-), methods, and relationships (--|>, ..|>, --o).',
        er: 'Use erDiagram with entity names in UPPER_CASE, attributes typed, and crow\'s foot notation.',
        gantt: 'Use gantt with dateFormat YYYY-MM-DD, sections, and task durations.',
        architecture: 'Use architecture-beta with service icons (server, database, internet, disk).',
        mindmap: 'Use mindmap starting from a central root node. Max 3 levels deep.',
        timeline: 'Use timeline with section years and events under each.',
        mermaid: 'Choose the most appropriate Mermaid diagram type.',
    };
    return `Generate a Mermaid.js diagram for the following:

"${description}"

Requirements:
- Output ONLY the Mermaid code block — no explanation, no markdown fence, no preamble
- Start with: ${directive}
- ${typeHints[type]}
- Keep it clear and readable (max 20-25 nodes/entities)
- Use descriptive labels on nodes and edges`;
}
//# sourceMappingURL=index.js.map