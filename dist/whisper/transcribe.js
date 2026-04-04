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
exports.transcribeFile = transcribeFile;
exports.transcribeViaGroq = transcribeViaGroq;
exports.getWhisperInstallInstructions = getWhisperInstallInstructions;
const child_process = __importStar(require("child_process"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
async function transcribeFile(filePath, options = {}) {
    const { model = 'base', language, outputFormat = 'txt' } = options;
    // Detect whisper installation
    const whisperCmd = detectWhisper();
    if (!whisperCmd) {
        throw new Error('Whisper not found. Install it with:\n  pip install openai-whisper\nOr use Groq (free) for transcription:\n  Set GROQ_API_KEY and it will use whisper-large-v3 via Groq API');
    }
    if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
    }
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowcap-whisper-'));
    const outputPath = path.join(tmpDir, 'output');
    try {
        const args = [
            filePath,
            '--model', model,
            '--output_format', outputFormat,
            '--output_dir', tmpDir,
            '--fp16', 'False',
        ];
        if (language && language !== 'auto') {
            args.push('--language', language);
        }
        child_process.execFileSync(whisperCmd, args, {
            timeout: 300000, // 5 min
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        // Find output file
        const files = fs.readdirSync(tmpDir);
        const outputFile = files.find(f => f.endsWith(`.${outputFormat}`));
        if (!outputFile) {
            throw new Error('Whisper produced no output');
        }
        const text = fs.readFileSync(path.join(tmpDir, outputFile), 'utf-8');
        return { text: text.trim() };
    }
    finally {
        // Cleanup
        try {
            fs.rmSync(tmpDir, { recursive: true });
        }
        catch { /* ignore */ }
    }
}
async function transcribeViaGroq(filePath, apiKey, options = {}) {
    // Use Groq's Whisper API (free tier)
    const fs2 = await Promise.resolve().then(() => __importStar(require('fs')));
    const https = await Promise.resolve().then(() => __importStar(require('https')));
    if (!fs2.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
    }
    const fileBuffer = fs2.readFileSync(filePath);
    const fileName = path.basename(filePath);
    const boundary = `----formdata-${Date.now()}`;
    const formData = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: audio/mpeg\r\n\r\n`),
        fileBuffer,
        Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-large-v3\r\n`),
        Buffer.from(`--${boundary}--\r\n`),
    ]);
    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: 'api.groq.com',
            path: '/openai/v1/audio/transcriptions',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': formData.length,
            },
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.error)
                        reject(new Error(parsed.error.message));
                    else
                        resolve({ text: parsed.text || '' });
                }
                catch {
                    reject(new Error(`Failed to parse Groq transcription response: ${data}`));
                }
            });
            res.on('error', reject);
        });
        req.on('error', reject);
        req.write(formData);
        req.end();
    });
}
function detectWhisper() {
    const candidates = ['whisper', 'whisper.exe', 'python -m whisper', 'python3 -m whisper'];
    for (const cmd of ['whisper', 'whisper.exe']) {
        try {
            child_process.execFileSync(cmd, ['--help'], { stdio: 'ignore', timeout: 2000 });
            return cmd;
        }
        catch { /* continue */ }
    }
    return null;
}
function getWhisperInstallInstructions() {
    return `
To use local Whisper transcription:
  pip install openai-whisper

Or use Groq's free Whisper API (requires GROQ_API_KEY):
  Get a free key at https://console.groq.com
  export GROQ_API_KEY=your_key_here

Supported audio/video formats: mp3, mp4, mpeg, mpga, m4a, wav, webm
`;
}
//# sourceMappingURL=transcribe.js.map