/**
 * commands.ts — Telegram slash command handlers
 *
 * All /commands the bot responds to, matching OpenClaw's command set:
 * /help /clear /model /models /tools /persona /lang /memory /stats /cost
 * /sessions /status /cron /remind /profile /admin /config
 *
 * Commands are processed here and can send back formatted HTML replies.
 */
import { BotContext, BotRuntime } from './telegram';
export type CommandHandler = (ctx: BotContext, runtime: BotRuntime, args: string[]) => Promise<void>;
export interface BotCommand {
    command: string;
    description: string;
    adminOnly?: boolean;
    handler: CommandHandler;
}
export declare const COMMANDS: BotCommand[];
export declare function findCommand(name: string): BotCommand | undefined;
/** Returns the list of commands for BotFather registration */
export declare function getCommandList(): Array<{
    command: string;
    description: string;
}>;
//# sourceMappingURL=commands.d.ts.map