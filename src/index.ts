import { Bot, CallbackQueryContext, CommandContext, Context, InlineKeyboard } from "grammy";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import { getHomeInlineKeyboard, getHomeReplyMessage, validateEnv } from "./helper";
import { MiraAmm, ReadonlyMiraAmm } from "mira-dex-ts";
import { Account, Address, DEFAULT_DECIMAL_UNITS, Provider, WalletUnlocked } from "fuels";

if (process.env.NODE_ENV == "development") {
  dotenv.config();
}

const requiredEnv = ["BOT_TOKEN", "ENCRYPTION_KEY"];
validateEnv(requiredEnv);

const BOT_TOKEN = process.env.BOT_TOKEN;
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const PROVIDER_URL = process.env.PROVIDER_URL;
const bot = new Bot(BOT_TOKEN!);
const prisma = new PrismaClient();

const homeHandler = async (ctx: CommandContext<Context>) => {
  const provider = await Provider.create(PROVIDER_URL!);
  const chatId = ctx.msg.chat.id;
  const userName = ctx.msg.chat.username;
  let wallet: WalletUnlocked;
  let userWallet = await prisma.wallet.findUnique({
      where: { chatId },
  });

  if (userWallet) {
      wallet = await WalletUnlocked.fromEncryptedJson(userWallet.walletJson, ENCRYPTION_KEY!)
  } else {
      wallet = WalletUnlocked.generate();
      const encryptedJson = await wallet.encrypt(ENCRYPTION_KEY!);
      await prisma.wallet.create({
          data: {
            chatId,
            walletJson: encryptedJson,
          },
      });
  }
  const address = Address.fromB256(wallet.address.toB256());
  wallet.provider = provider
  const balance = await wallet.getBalance(provider.getBaseAssetId());
  const formattedBalance = balance.toNumber()/(10**DEFAULT_DECIMAL_UNITS);
  const replyMessage = getHomeReplyMessage(formattedBalance, userName, address);
  const inlineKeyboard = getHomeInlineKeyboard();
  ctx.reply(replyMessage, { parse_mode: "HTML", reply_markup: inlineKeyboard });
};

const buyHandler = async (ctx: CallbackQueryContext<Context>) => {
    ctx.reply("You want to buy??....")
}

const myTradesHandler = async (ctx: CallbackQueryContext<Context>) => {
    ctx.reply("You want to view your trades??...")
}

const walletHandler = async (ctx: CallbackQueryContext<Context>) => {
    ctx.reply("You want to view your wallet??...")
}

const settingsHandler = async (ctx: CallbackQueryContext<Context>) => {
    ctx.reply("You want to view your settings??...")
}

const refreshHandler = async (ctx: CallbackQueryContext<Context>) => {
    const provider = await Provider.create(PROVIDER_URL!);
    const userWallet = await prisma.wallet.findUniqueOrThrow({
        where: { chatId: ctx.msg?.chat.id },
    });
    const wallet = await WalletUnlocked.fromEncryptedJson(userWallet.walletJson, ENCRYPTION_KEY!);
    const address = Address.fromB256(wallet.address.toB256());
    wallet.provider = provider;
    const balance = await wallet.getBalance(provider.getBaseAssetId());
    const formattedBalance = balance.toNumber()/(10**DEFAULT_DECIMAL_UNITS);
    const replyMessage = getHomeReplyMessage(formattedBalance, ctx.msg?.chat.username, address);
    const inlineKeyboard = getHomeInlineKeyboard();
    ctx.editMessageText(replyMessage, { reply_markup: inlineKeyboard, parse_mode: "HTML"})
}

bot.command("start", homeHandler);
bot.command("home", homeHandler);
bot.callbackQuery("refresh", refreshHandler);
bot.callbackQuery("buy", buyHandler);
bot.callbackQuery("trades", myTradesHandler);
bot.callbackQuery("wallet", walletHandler);
bot.callbackQuery("settings", settingsHandler);
bot.catch((err) => console.log(`An Error occurred: ${err.message}`))
bot.start()
bot.api.setMyCommands([
    { command: "home", description: "open main menu" },
    { command: "settings", description: "customize bot" }
])