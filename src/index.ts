import { Bot, CommandContext, Context, InlineKeyboard } from "grammy";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import { validateEnv } from "./helper";
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

const startHandler = async (ctx: CommandContext<Context>) => {
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
  const formattedBalance = balance.toNumber()/(10**DEFAULT_DECIMAL_UNITS)
  let replyMessage =
    `<b>Hey ${userName} 👋, welcome to MoonSniper🎉.</b>\n\nFuel's first and fastest bot for trading any asset.\n\n`;
  if (formattedBalance == 0) {
    replyMessage += `You currently have no ETH in your wallet. To get started with trading, send some ETH to your moonsnipe wallet address:\n\n<code>${address.toHexString()}</code> (tap to copy)\n\nOnce done tap refresh and your balance will appear here.\n\n`
  } else {
    replyMessage += `Wallet Address: <code>${address.toHexString()}</code> (tap to copy)\nETH Balance: $${formattedBalance}\n\n`
  }
  replyMessage += `To buy an asset, just enter the assetId.\n\nFor more info on your wallet and to retrieve your private key, tap the wallet button below. We guarantee the safety of user funds on MoonSnipe, but if you expose your private key your funds will not be safe.`
  const inlineKeyboard = new InlineKeyboard().text("Buy 💰", "buy").text("My Trades  🔍", "trades").row().text("Wallet 💳", "wallet").text("Settings ⚙️", "settings").row().text("Refresh 🔄", "refresh")
  ctx.reply(replyMessage, { parse_mode: "HTML", reply_markup: inlineKeyboard });
};

bot.command("start", startHandler);
bot.start().catch((err) => console.log(`An Error occurred: ${err.message}`));
