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
/** Yes/No confirmation keyboard */
export declare function confirmKeyboard(yesData?: string, noData?: string): InlineKeyboard;
/** Yes/No/Cancel keyboard */
export declare function confirmCancelKeyboard(yesData?: string, noData?: string, cancelData?: string): InlineKeyboard;
/** Quick actions for code output */
export declare function codeActionsKeyboard(filename?: string): InlineKeyboard;
/** Quick actions for file operations */
export declare function fileActionsKeyboard(filePath: string): InlineKeyboard;
/** Model/provider selection keyboard */
export declare function modelKeyboard(current?: string): InlineKeyboard;
/** Persona selection keyboard */
export declare function personaKeyboard(current?: string): InlineKeyboard;
/** Session management keyboard */
export declare function sessionKeyboard(): InlineKeyboard;
/** Tool list keyboard */
export declare function toolsKeyboard(tools: string[]): InlineKeyboard;
/** Help menu keyboard */
export declare function helpKeyboard(): InlineKeyboard;
/** Scheduler actions keyboard */
export declare function schedulerKeyboard(): InlineKeyboard;
/** Pagination keyboard */
export declare function paginationKeyboard(page: number, total: number, prefix: string): InlineKeyboard;
/** Admin panel keyboard */
export declare function adminKeyboard(): InlineKeyboard;
/** Cancel keyboard — single button */
export declare function cancelKeyboard(data?: string): InlineKeyboard;
//# sourceMappingURL=keyboards.d.ts.map