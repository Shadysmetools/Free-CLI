"use strict";
/**
 * keyboards.ts — Inline keyboard builders for Telegram
 *
 * Provides reusable inline keyboard layouts for confirmations,
 * menus, quick actions, and pagination.
 *
 * Reference: OpenClaw inline button model
 * "callback_data: <value>" is passed to the agent as text
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.confirmKeyboard = confirmKeyboard;
exports.confirmCancelKeyboard = confirmCancelKeyboard;
exports.codeActionsKeyboard = codeActionsKeyboard;
exports.fileActionsKeyboard = fileActionsKeyboard;
exports.modelKeyboard = modelKeyboard;
exports.personaKeyboard = personaKeyboard;
exports.sessionKeyboard = sessionKeyboard;
exports.toolsKeyboard = toolsKeyboard;
exports.helpKeyboard = helpKeyboard;
exports.schedulerKeyboard = schedulerKeyboard;
exports.paginationKeyboard = paginationKeyboard;
exports.adminKeyboard = adminKeyboard;
exports.cancelKeyboard = cancelKeyboard;
exports.roleKeyboard = roleKeyboard;
exports.languageKeyboard = languageKeyboard;
exports.languageChangeKeyboard = languageChangeKeyboard;
exports.roleChangeKeyboard = roleChangeKeyboard;
const grammy_1 = require("grammy");
// ─── Confirmation keyboards ───────────────────────────────────────────────────
/** Yes/No confirmation keyboard */
function confirmKeyboard(yesData = 'confirm:yes', noData = 'confirm:no') {
    return new grammy_1.InlineKeyboard()
        .text('✅ Yes', yesData)
        .text('❌ No', noData);
}
/** Yes/No/Cancel keyboard */
function confirmCancelKeyboard(yesData = 'confirm:yes', noData = 'confirm:no', cancelData = 'confirm:cancel') {
    return new grammy_1.InlineKeyboard()
        .text('✅ Yes', yesData)
        .text('❌ No', noData)
        .text('🚫 Cancel', cancelData);
}
// ─── Quick action keyboards ───────────────────────────────────────────────────
/** Quick actions for code output */
function codeActionsKeyboard(filename) {
    const kb = new grammy_1.InlineKeyboard()
        .text('📋 Copy', 'action:copy')
        .text('💾 Save', `action:save${filename ? `:${filename}` : ''}`)
        .row()
        .text('▶ Run', 'action:run')
        .text('🔍 Explain', 'action:explain');
    return kb;
}
/** Quick actions for file operations */
function fileActionsKeyboard(filePath) {
    const safePath = filePath.slice(0, 50);
    return new grammy_1.InlineKeyboard()
        .text('📖 Read', `file:read:${safePath}`)
        .text('✏ Edit', `file:edit:${safePath}`)
        .row()
        .text('🗑 Delete', `file:delete:${safePath}`)
        .text('📤 Send', `file:send:${safePath}`);
}
/** Model/provider selection keyboard */
function modelKeyboard(current) {
    const models = [
        { label: 'Llama 3.3 70B (free)', value: 'openrouter:meta-llama/llama-3.3-70b-instruct:free' },
        { label: 'Gemini Flash (free)', value: 'google:gemini-2.0-flash' },
        { label: 'Claude Haiku', value: 'anthropic:claude-haiku-4-20251128' },
        { label: 'GPT-4o mini', value: 'openai:gpt-4o-mini' },
        { label: 'DeepSeek R1 (free)', value: 'openrouter:deepseek/deepseek-r1:free' },
    ];
    const kb = new grammy_1.InlineKeyboard();
    for (const model of models) {
        const isCurrent = current === model.value;
        const label = isCurrent ? `✓ ${model.label}` : model.label;
        kb.text(label, `model:set:${model.value}`).row();
    }
    return kb;
}
/** Persona selection keyboard */
function personaKeyboard(current) {
    const personas = [
        { label: '🇺🇸 English', value: 'english' },
        { label: '🇪🇬 Egyptian Arabic', value: 'egyptian' },
        { label: '🇸🇦 Modern Arabic', value: 'arabic' },
        { label: '🔤 Franco', value: 'franco' },
        { label: '🇫🇷 French', value: 'french' },
        { label: '🇩🇪 German', value: 'german' },
    ];
    const kb = new grammy_1.InlineKeyboard();
    let count = 0;
    for (const p of personas) {
        const isCurrent = current === p.value;
        kb.text(isCurrent ? `✓ ${p.label}` : p.label, `persona:set:${p.value}`);
        count++;
        if (count % 2 === 0)
            kb.row();
    }
    return kb;
}
/** Session management keyboard */
function sessionKeyboard() {
    return new grammy_1.InlineKeyboard()
        .text('🗑 Clear History', 'session:clear')
        .text('📊 Stats', 'session:stats')
        .row()
        .text('📥 Export', 'session:export')
        .text('⚙ Settings', 'session:settings');
}
/** Tool list keyboard */
function toolsKeyboard(tools) {
    const kb = new grammy_1.InlineKeyboard();
    let count = 0;
    for (const tool of tools.slice(0, 16)) {
        kb.text(tool, `tool:info:${tool}`);
        count++;
        if (count % 2 === 0)
            kb.row();
    }
    return kb;
}
/** Help menu keyboard */
function helpKeyboard() {
    return new grammy_1.InlineKeyboard()
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
function schedulerKeyboard() {
    return new grammy_1.InlineKeyboard()
        .text('➕ Add job', 'cron:add')
        .text('📋 List jobs', 'cron:list')
        .row()
        .text('▶ Run now', 'cron:run')
        .text('🗑 Delete', 'cron:delete');
}
/** Pagination keyboard */
function paginationKeyboard(page, total, prefix) {
    const kb = new grammy_1.InlineKeyboard();
    if (page > 0)
        kb.text('◀ Prev', `${prefix}:page:${page - 1}`);
    kb.text(`${page + 1}/${total}`, 'noop');
    if (page < total - 1)
        kb.text('Next ▶', `${prefix}:page:${page + 1}`);
    return kb;
}
/** Admin panel keyboard */
function adminKeyboard() {
    return new grammy_1.InlineKeyboard()
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
function cancelKeyboard(data = 'cancel') {
    return new grammy_1.InlineKeyboard().text('🚫 Cancel', data);
}
// ─── Onboarding keyboards ─────────────────────────────────────────────────────
/** Role selection keyboard for onboarding */
function roleKeyboard() {
    return new grammy_1.InlineKeyboard()
        .text('🧑‍💻 Coding Assistant', 'soul:role:coding').row()
        .text('📚 Research Assistant', 'soul:role:research').row()
        .text('🤖 General AI', 'soul:role:general').row()
        .text('🛠️ DevOps Bot', 'soul:role:devops').row()
        .text('📊 Data Analyst', 'soul:role:data').row()
        .text('🎨 Creative Assistant', 'soul:role:creative');
}
/** Language selection keyboard for onboarding */
function languageKeyboard() {
    return new grammy_1.InlineKeyboard()
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
function languageChangeKeyboard(current) {
    const mark = (lang) => current === lang ? '✓ ' : '';
    return new grammy_1.InlineKeyboard()
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
function roleChangeKeyboard(current) {
    const mark = (role) => current === role ? '✓ ' : '';
    return new grammy_1.InlineKeyboard()
        .text(`${mark('coding')}🧑‍💻 Coding`, 'soul:role:coding')
        .text(`${mark('research')}📚 Research`, 'soul:role:research').row()
        .text(`${mark('general')}🤖 General`, 'soul:role:general')
        .text(`${mark('devops')}🛠️ DevOps`, 'soul:role:devops').row()
        .text(`${mark('data')}📊 Data`, 'soul:role:data')
        .text(`${mark('creative')}🎨 Creative`, 'soul:role:creative');
}
//# sourceMappingURL=keyboards.js.map