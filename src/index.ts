import { Bot, CommandContext, Context } from "grammy";
import dotenv from 'dotenv';
import { validateEnv } from "./helper";

if (process.env.NODE_ENV == "development") {
    dotenv.config();
}

const requiredEnv = ["BOT_TOKEN"]
validateEnv(requiredEnv);

const BOT_TOKEN = process.env.BOT_TOKEN;
const bot = new Bot(BOT_TOKEN!);

const startHandler = (ctx: CommandContext<Context>) => {
    // send request to backend server to register user
    ctx.reply("Welcome! My Friend.");
}

bot.command("start", (ctx) => ctx.reply("Welcome! Up and running."));

bot.start();