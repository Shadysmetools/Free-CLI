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
    { label: 'Llama 3.3 70B (free)', value: 'openrouter:meta-llama/llama-3.3-70b-instruct:free' },
    { label: 'Gemini Flash (free)', value: 'google:gemini-2.0-flash' },
    { label: 'Claude Haiku', value: 'anthropic:claude-haiku-4-20251128' },
    { label: 'GPT-4o mini', value: 'openai:gpt-4o-mini' },
    { label: 'DeepSeek R1 (free)', value: 'openrouter:deepseek/deepseek-r1:free' },
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
