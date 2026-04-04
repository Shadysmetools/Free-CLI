/**
 * keyboards.ts — Inline keyboard builders for Telegram
 *
 * Provides reusable inline keyboard layouts for confirmations,
 * menus, quick actions, and pagination.
 *
 * Reference: OpenClaw inline button model
 * "callback_data: <value>" is passed to the agent as text
 */

import { InlineKeyboard } from 'grammy';

// ─── Confirmation keyboards ───────────────────────────────────────────────────

/** Yes/No confirmation keyboard */
export function confirmKeyboard(yesData = 'confirm:yes', noData = 'confirm:no'): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Yes', yesData)
    .text('❌ No', noData);
}

/** Yes/No/Cancel keyboard */
export function confirmCancelKeyboard(
  yesData = 'confirm:yes',
  noData = 'confirm:no',
  cancelData = 'confirm:cancel',
): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Yes', yesData)
    .text('❌ No', noData)
    .text('🚫 Cancel', cancelData);
}

// ─── Quick action keyboards ───────────────────────────────────────────────────

/** Quick actions for code output */
export function codeActionsKeyboard(filename?: string): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text('📋 Copy', 'action:copy')
    .text('💾 Save', `action:save${filename ? `:${filename}` : ''}`)
    .row()
    .text('▶ Run', 'action:run')
    .text('🔍 Explain', 'action:explain');
  return kb;
}

/** Quick actions for file operations */
export function fileActionsKeyboard(filePath: string): InlineKeyboard {
  const safePath = filePath.slice(0, 50);
  return new InlineKeyboard()
    .text('📖 Read', `file:read:${safePath}`)
    .text('✏ Edit', `file:edit:${safePath}`)
    .row()
    .text('🗑 Delete', `file:delete:${safePath}`)
    .text('📤 Send', `file:send:${safePath}`);
}

/** Model/provider selection keyboard */
export function modelKeyboard(current?: string): InlineKeyboard {
  const models = [
    // Free models
    { label: '🆓 Auto Free (OpenRouter)', value: 'openrouter:openrouter/free' },
    { label: '🆓 Llama 3.3 70B (Groq)', value: 'groq:llama-3.3-70b-versatile' },
    { label: '🆓 Gemini 2.5 Flash', value: 'google:gemini-2.5-flash' },
    { label: '🆓 Devstral (Mistral)', value: 'mistral:devstral-small-latest' },
    { label: '🆓 DeepSeek R1', value: 'openrouter:deepseek/deepseek-r1:free' },
    { label: '🆓 Qwen 3 30B', value: 'openrouter:qwen/qwen3-30b-a3b:free' },
    // BYOK models
    { label: '💰 Claude Sonnet 4.5', value: 'anthropic:claude-sonnet-4-5' },
    { label: '💰 GPT-4o', value: 'openai:gpt-4o' },
  ];

  const kb = new InlineKeyboard();
  for (const model of models) {
    const isCurrent = current === model.value;
    const label = isCurrent ? `✓ ${model.label}` : model.label;
    kb.text(label, `model:set:${model.value}`).row();
  }
  return kb;
}

/** Persona selection keyboard */
export function personaKeyboard(current?: string): InlineKeyboard {
  const personas = [
    { label: '🇺🇸 English', value: 'english' },
    { label: '🇪🇬 Egyptian Arabic', value: 'egyptian' },
    { label: '🇸🇦 Modern Arabic', value: 'arabic' },
    { label: '🔤 Franco', value: 'franco' },
    { label: '🇫🇷 French', value: 'french' },
    { label: '🇩🇪 German', value: 'german' },
  ];

  const kb = new InlineKeyboard();
  let count = 0;
  for (const p of personas) {
    const isCurrent = current === p.value;
    kb.text(isCurrent ? `✓ ${p.label}` : p.label, `persona:set:${p.value}`);
    count++;
    if (count % 2 === 0) kb.row();
  }
  return kb;
}

/** Session management keyboard */
export function sessionKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('🗑 Clear History', 'session:clear')
    .text('📊 Stats', 'session:stats')
    .row()
    .text('📥 Export', 'session:export')
    .text('⚙ Settings', 'session:settings');
}

/** Tool list keyboard */
export function toolsKeyboard(tools: string[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  let count = 0;
  for (const tool of tools.slice(0, 16)) {
    kb.text(tool, `tool:info:${tool}`);
    count++;
    if (count % 2 === 0) kb.row();
  }
  return kb;
}

/** Help menu keyboard */
export function helpKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('🔧 Tools', 'help:tools')
    .text('🤖 Models', 'help:models')
    .row()
    .text('🎭 Personas', 'help:personas')
    .text('⏰ Scheduler', 'help:scheduler')
    .row()
    .text('🔒 Security', 'help:security')
    .text('📊 Stats', 'help:stats');
}

/** Scheduler actions keyboard */
export function schedulerKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('➕ Add job', 'cron:add')
    .text('📋 List jobs', 'cron:list')
    .row()
    .text('▶ Run now', 'cron:run')
    .text('🗑 Delete', 'cron:delete');
}

/** Pagination keyboard */
export function paginationKeyboard(page: number, total: number, prefix: string): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (page > 0) kb.text('◀ Prev', `${prefix}:page:${page - 1}`);
  kb.text(`${page + 1}/${total}`, 'noop');
  if (page < total - 1) kb.text('Next ▶', `${prefix}:page:${page + 1}`);
  return kb;
}

/** Admin panel keyboard */
export function adminKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('📊 Sessions', 'admin:sessions')
    .text('🔧 Tools', 'admin:tools')
    .row()
    .text('🔄 Restart', 'admin:restart')
    .text('📝 Logs', 'admin:logs')
    .row()
    .text('👥 Users', 'admin:users')
    .text('⏰ Jobs', 'admin:jobs');
}

/** Cancel keyboard — single button */
export function cancelKeyboard(data = 'cancel'): InlineKeyboard {
  return new InlineKeyboard().text('🚫 Cancel', data);
}

// ─── Onboarding keyboards ─────────────────────────────────────────────────────

/** Role selection keyboard for onboarding */
export function roleKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('🧑‍💻 Coding Assistant', 'soul:role:coding').row()
    .text('📚 Research Assistant', 'soul:role:research').row()
    .text('🤖 General AI', 'soul:role:general').row()
    .text('🛠️ DevOps Bot', 'soul:role:devops').row()
    .text('📊 Data Analyst', 'soul:role:data').row()
    .text('🎨 Creative Assistant', 'soul:role:creative');
}

/** Language selection keyboard for onboarding */
export function languageKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('🇬🇧 English', 'soul:lang:english').row()
    .text('🇪🇬 Egyptian Arabic (عامية)', 'soul:lang:egyptian').row()
    .text('🔤 Franco/Arabizi (3araby)', 'soul:lang:franco').row()
    .text('🇸🇦 Arabic (فصحى)', 'soul:lang:arabic').row()
    .text('🇫🇷 French', 'soul:lang:french')
    .text('🇪🇸 Spanish', 'soul:lang:spanish').row()
    .text('🇩🇪 German', 'soul:lang:german')
    .text('🇹🇷 Turkish', 'soul:lang:turkish').row()
    .text('🌍 Auto-detect', 'soul:lang:auto');
}

/** Language change keyboard (same as onboarding, different prefix context) */
export function languageChangeKeyboard(current?: string): InlineKeyboard {
  const mark = (lang: string) => current === lang ? '✓ ' : '';
  return new InlineKeyboard()
    .text(`${mark('english')}🇬🇧 English`, 'soul:lang:english').row()
    .text(`${mark('egyptian')}🇪🇬 Egyptian Arabic`, 'soul:lang:egyptian').row()
    .text(`${mark('franco')}🔤 Franco/Arabizi`, 'soul:lang:franco').row()
    .text(`${mark('arabic')}🇸🇦 Arabic (فصحى)`, 'soul:lang:arabic').row()
    .text(`${mark('french')}🇫🇷 French`, 'soul:lang:french')
    .text(`${mark('spanish')}🇪🇸 Spanish`, 'soul:lang:spanish').row()
    .text(`${mark('german')}🇩🇪 German`, 'soul:lang:german')
    .text(`${mark('turkish')}🇹🇷 Turkish`, 'soul:lang:turkish').row()
    .text(`${mark('auto')}🌍 Auto-detect`, 'soul:lang:auto');
}

/** Role change keyboard */
export function roleChangeKeyboard(current?: string): InlineKeyboard {
  const mark = (role: string) => current === role ? '✓ ' : '';
  return new InlineKeyboard()
    .text(`${mark('coding')}🧑‍💻 Coding`, 'soul:role:coding')
    .text(`${mark('research')}📚 Research`, 'soul:role:research').row()
    .text(`${mark('general')}🤖 General`, 'soul:role:general')
    .text(`${mark('devops')}🛠️ DevOps`, 'soul:role:devops').row()
    .text(`${mark('data')}📊 Data`, 'soul:role:data')
    .text(`${mark('creative')}🎨 Creative`, 'soul:role:creative');
}
