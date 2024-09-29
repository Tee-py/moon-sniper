import {
  Bot,
  CallbackQueryContext,
  CommandContext,
  Context,
  GrammyError,
  HttpError,
  InlineKeyboard,
  SessionFlavor,
  session,
} from "grammy";
import {
  type Conversation,
  type ConversationFlavor,
  conversations,
  createConversation,
} from "@grammyjs/conversations";
import { freeStorage } from "@grammyjs/storage-free";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import {
  getAsset,
  getHomeInlineKeyboard,
  getHomeReplyMessage,
  getPoolId,
  validateEnv,
} from "./helper";
import { MiraAmm, ReadonlyMiraAmm } from "mira-dex-ts";
import {
  Address,
  BN,
  DEFAULT_DECIMAL_UNITS,
  Provider,
  WalletUnlocked,
} from "fuels";
import { SUPPORTED_ASSETS } from "./constants";

if (process.env.NODE_ENV == "development") {
  dotenv.config({ path: ".env" });
}

const requiredEnv = ["BOT_TOKEN", "ENCRYPTION_KEY"];
validateEnv(requiredEnv);

interface SessionData {
  buyAsset: {
    name: string;
    symbol: string;
    decimals: number;
    assetId: string;
  };
}

type BotContext = Context & SessionFlavor<SessionData> & ConversationFlavor;
type BotConversation = Conversation<BotContext>;

const BOT_TOKEN = process.env.BOT_TOKEN;
console.log(BOT_TOKEN);
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const PROVIDER_URL = process.env.PROVIDER_URL;
const bot = new Bot<BotContext>(BOT_TOKEN!);
bot.use(
  session({
    storage: freeStorage<SessionData>(bot.token),
    initial: () => ({
      buyAsset: {
        name: "",
        symbol: "",
        decimals: 3,
        assetId: "",
      },
    }),
  }),
);
bot.use(conversations());
const prisma = new PrismaClient();

const buyAsset = async (conversation: BotConversation, ctx: BotContext) => {
  const asset = ctx.session.buyAsset;
  const provider = await Provider.create(PROVIDER_URL!);
  await ctx.reply(
    `Enter the amount of ${asset.symbol} to buy...\nYou can click cancel to exit this conversation.`,
    {
      reply_markup: new InlineKeyboard().text(
        "Cancel ❌",
        "exit_convo:buyAsset",
      ),
    },
  );
  const {
    msg: { text },
  } = await conversation.waitFor("message:text");
  try {
    // Validate entered amount
    const buyAmount = parseFloat(text);
    if (Number.isNaN(buyAmount)) {
      throw "Invalid amount provided";
    }

    // fetch user wallet from the db
    const userWallet = await prisma.wallet.findUniqueOrThrow({
      where: { chatId: ctx.msg?.chat.id },
    });
    const wallet = await WalletUnlocked.fromEncryptedJson(
      userWallet.walletJson,
      ENCRYPTION_KEY!,
    );
    wallet.provider = provider;

    // set up mira amm sdk
    const miraAmm = new MiraAmm(wallet);
    const readonlyAmm = new ReadonlyMiraAmm(provider);
    const assetOut = {
      bits: asset.assetId,
    };

    // fetch the expected amount out
    const poolId = getPoolId(asset.assetId);
    const preview = await readonlyAmm.previewSwapExactOutput(
      assetOut,
      buyAmount * 10 ** asset.decimals,
      [poolId],
    );

    // create swap script transaction request
    const deadline = Date.now() / 1000;
    const req = await miraAmm.swapExactOutput(
      buyAmount * 10 ** asset.decimals,
      assetOut,
      preview[1],
      [poolId],
      new BN(deadline),
    );

    // estimate gas fee
    const est = await provider.estimateTxGasAndFee({
      transactionRequest: req,
    });
    req.maxFee = est.maxFee;

    // check if balance is enough to cover transaction cost
    const balance = await wallet.getBalance(provider.getBaseAssetId());

    if (preview[1].add(est.maxFee).gt(balance)) {
      const txnCost =
        preview[1].add(est.maxFee).toNumber() / 10 ** DEFAULT_DECIMAL_UNITS;
      const availableBalance = balance.toNumber() / 10 ** DEFAULT_DECIMAL_UNITS;
      const address = Address.fromB256(wallet.address.toB256());
      await ctx.reply(
        `Transaction failed due to insufficient balance ❌. \nTransfer more ETH to your address <code>${address.toHexString()}</code>(tap to copy) and try again 🔄.\n\nTransaction Cost: ${txnCost}\nWallet Balance: ${availableBalance}`,
        { parse_mode: "HTML" },
      );
    }
    const resp = await wallet.simulateTransaction(req);
    if (resp.dryRunStatus?.type == "DryRunSuccessStatus") {
      const { id } = await wallet.sendTransaction(req);
      const cost = preview[1].toNumber() / 10 ** DEFAULT_DECIMAL_UNITS;
      const positionExists = await prisma.position.findFirst({
        where: {
          assetId: asset.assetId,
        },
      });
      if (positionExists) {
        // update the amount here
        const newAmount = new BN(positionExists.amount).add(
          new BN((buyAmount * 10 ** asset.decimals).toString()),
        );
        await prisma.position.update({
          where: { id: positionExists.id },
          data: {
            amount: newAmount.toString(),
          },
        });
      } else {
        await prisma.position.create({
          data: {
            wallet: {
              connect: { id: userWallet.id },
            },
            assetId: asset.assetId,
            assetSymbol: asset.symbol,
            decimals: asset.decimals,
            amount: (buyAmount * 10 ** asset.decimals).toString(),
          },
        });
      }
      const explorerLink = `https://app.fuel.network/tx/${id}/simple`;
      await ctx.reply(
        `Swap successfull ✅: Bought ${buyAmount} ${asset.symbol} for ${cost} ETH.\n<a href="${explorerLink}">View on fuel explorer</a>`,
        { parse_mode: "HTML" },
      );
    } else {
      console.log(resp.dryRunStatus);
      console.log(resp.receipts);
      throw "Simulation failed failed...";
    }
  } catch (error) {
    console.log(error);
    await ctx.reply(
      "An Error occurred while trying to swap asset ❌... Please try again 🔄",
    );
  }
  return;
};

bot.use(createConversation(buyAsset));

const homeHandler = async (ctx: CommandContext<BotContext>) => {
  console.log("triggered..");
  const provider = await Provider.create(PROVIDER_URL!);
  const chatId = ctx.msg.chat.id;
  const userName = ctx.msg.chat.username;
  let wallet: WalletUnlocked;
  let userWallet = await prisma.wallet.findUnique({
    where: { chatId },
  });

  if (userWallet) {
    wallet = await WalletUnlocked.fromEncryptedJson(
      userWallet.walletJson,
      ENCRYPTION_KEY!,
    );
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
  wallet.provider = provider;
  const balance = await wallet.getBalance(provider.getBaseAssetId());
  const formattedBalance = balance.toNumber() / 10 ** DEFAULT_DECIMAL_UNITS;
  const replyMessage = getHomeReplyMessage(formattedBalance, userName, address);
  const inlineKeyboard = getHomeInlineKeyboard(formattedBalance);
  ctx.reply(replyMessage, { parse_mode: "HTML", reply_markup: inlineKeyboard });
};

const assetListHandler = async (ctx: CommandContext<BotContext>) => {
  let messageText = "Supported Assets 💹:\n\n";
  for (const asset of SUPPORTED_ASSETS) {
    messageText += `Name: ${asset.name}\nSymbol: <code>${asset.symbol}</code> (tap to copy)\nAsset Id: <code>${asset.assetId}</code> (tap to copy)\n\n`;
  }
  await ctx.reply(messageText, {
    parse_mode: "HTML",
    reply_markup: new InlineKeyboard().text("Close ❌", "close"),
  });
};

const buyHandler = async (ctx: CallbackQueryContext<BotContext>) => {
  const messageText =
    "Buy Asset:\n\nTo buy an asset, enter the asset symbol or assetId.\n\nEnter the <code>/assets</code> command to view supported asset lists and their symbol.";
  ctx.reply(messageText, {
    reply_markup: new InlineKeyboard().text("Close ❌", "close"),
    parse_mode: "HTML",
  });
};

const myTradesHandler = async (ctx: CallbackQueryContext<BotContext>) => {
  const chatId = ctx.msg?.chat.id;
  const userWallet = await prisma.wallet.findUniqueOrThrow({
    where: { chatId },
  });
  const positions = await prisma.position.findMany({
    where: { walletId: userWallet.id },
  });
  if (positions.length == 0) {
    await ctx.reply("You have no open trades", {
      reply_markup: new InlineKeyboard().text("Close ❌", "close"),
    });
  } else {
    let messageText = "Open Trades 📈:\n\n";
    for (const position of positions) {
      const formattedAmount =
        parseInt(position.amount) / 10 ** position.decimals;
      messageText += `<code>/trade ${position.id}</code> (tap to copy command)\nAsset: ${position.assetSymbol}\nAmount: ${formattedAmount} ${position.assetSymbol}\n\n`;
    }
    await ctx.reply(messageText, {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().text("Close ❌", "close"),
    });
  }
};

const tradeDetailHandler = async (ctx: CommandContext<BotContext>) => {
  const positionId = ctx.msg.text.slice(6);
  const position = await prisma.position.findUniqueOrThrow({
    where: { id: parseInt(positionId) },
  });
  const formattedAmount = parseInt(position.amount) / 10 ** position.decimals;
  const asset = getAsset(position.assetId);
  const messageText = `${asset?.name} | ${asset?.symbol} | <a href='https://app.fuel.network/account/${asset?.assetId}'>${asset?.assetId}</a>\n\nAsset: ${position.assetSymbol}\nAmount: ${formattedAmount} ${position.assetSymbol}\n\n`;
  ctx.reply(messageText, {
    reply_markup: new InlineKeyboard()
      .text("Sell 📈", "sell_asset")
      .text("Close ❌", "close"),
    parse_mode: "HTML",
  });
};

const walletHandler = async (ctx: CallbackQueryContext<BotContext>) => {
  const provider = await Provider.create(PROVIDER_URL!);
  const userWallet = await prisma.wallet.findUniqueOrThrow({
    where: { chatId: ctx.msg?.chat.id },
  });
  const wallet = await WalletUnlocked.fromEncryptedJson(
    userWallet.walletJson,
    ENCRYPTION_KEY!,
  );
  const address = Address.fromB256(wallet.address.toB256());
  wallet.provider = provider;
  const balance = await wallet.getBalance(provider.getBaseAssetId());
  const formattedBalance = balance.toNumber() / 10 ** DEFAULT_DECIMAL_UNITS;
  const messageText = `Wallet Info:\n\nAddress: <code>${address.toHexString()}</code>\nBalance: ${formattedBalance} ETH\n\nTap the address to copy and send ETH to deposit.`;
  const inlineKeyboard = new InlineKeyboard()
    .url(
      "View on explorer",
      `https://app.fuel.network/account/${address.toHexString()}`,
    )
    .text("Close  ❌", "close")
    .row()
    .text("Withdraw ETH 📈", "withdraw")
    .text("Export Private Key 🔐", "export_confirm")
    .row()
    .text("Refresh 🔄", `refresh_wallet:${formattedBalance}`);
  ctx.reply(messageText, { parse_mode: "HTML", reply_markup: inlineKeyboard });
};

const handleExportConfirm = async (ctx: CallbackQueryContext<BotContext>) => {
  const messageText =
    "Please confirm private key export.\n\n❗️<b>WARNING</b>❗️\nNever share your private key with anyone. Sharing your private key gives them <b>full control over your wallet and assets.</b>";
  const inlineKeyboard = new InlineKeyboard()
    .text("Confirm ✅", "export_pk")
    .text("Cancel  ❌", "close");
  ctx.reply(messageText, { parse_mode: "HTML", reply_markup: inlineKeyboard });
};

const handleExportPrivateKey = async (
  ctx: CallbackQueryContext<BotContext>,
) => {
  const userWallet = await prisma.wallet.findUniqueOrThrow({
    where: { chatId: ctx.msg?.chat.id },
  });
  const wallet = await WalletUnlocked.fromEncryptedJson(
    userWallet.walletJson,
    ENCRYPTION_KEY!,
  );
  const messageText = `Your Private Key is:\n\n<code>${wallet.privateKey}</code> (tap to copy).\n\nYou can now import the key into Fuelet Wallet or Fuel Wallet.\nKindly click on close to delete this message after copying you private key.`;
  const inlineKeyboard = new InlineKeyboard().text("Close  ❌", "close");
  ctx.reply(messageText, { parse_mode: "HTML", reply_markup: inlineKeyboard });
};

const settingsHandler = async (ctx: CallbackQueryContext<BotContext>) => {
  ctx.reply("Coming soon...🔜");
};

const refreshHandler = async (ctx: CallbackQueryContext<BotContext>) => {
  const provider = await Provider.create(PROVIDER_URL!);
  const userWallet = await prisma.wallet.findUniqueOrThrow({
    where: { chatId: ctx.msg?.chat.id },
  });
  const wallet = await WalletUnlocked.fromEncryptedJson(
    userWallet.walletJson,
    ENCRYPTION_KEY!,
  );
  const address = Address.fromB256(wallet.address.toB256());
  wallet.provider = provider;
  const formerBalance = parseFloat(ctx.callbackQuery.data.split(":")[1]);
  const balance = await wallet.getBalance(provider.getBaseAssetId());
  const formattedBalance = balance.toNumber() / 10 ** DEFAULT_DECIMAL_UNITS;
  if (formerBalance != formattedBalance) {
    const replyMessage = getHomeReplyMessage(
      formattedBalance,
      ctx.msg?.chat.username,
      address,
    );
    const inlineKeyboard = getHomeInlineKeyboard(formattedBalance);
    ctx.editMessageText(replyMessage, {
      reply_markup: inlineKeyboard,
      parse_mode: "HTML",
    });
  }
};

const walletRefreshHandler = async (ctx: CallbackQueryContext<BotContext>) => {
  const provider = await Provider.create(PROVIDER_URL!);
  const userWallet = await prisma.wallet.findUniqueOrThrow({
    where: { chatId: ctx.msg?.chat.id },
  });
  const wallet = await WalletUnlocked.fromEncryptedJson(
    userWallet.walletJson,
    ENCRYPTION_KEY!,
  );
  const address = Address.fromB256(wallet.address.toB256());
  wallet.provider = provider;
  const formerBalance = parseFloat(ctx.callbackQuery.data.split(":")[1]);
  const balance = await wallet.getBalance(provider.getBaseAssetId());
  const formattedBalance = balance.toNumber() / 10 ** DEFAULT_DECIMAL_UNITS;
  if (formerBalance != formattedBalance) {
    const messageText = `Wallet Info:\n\nAddress: <code>${address.toHexString()}</code>\nBalance: ${formattedBalance} ETH\n\nTap the address to copy and send ETH to deposit.`;
    const inlineKeyboard = new InlineKeyboard()
      .url(
        "View on explorer",
        `https://app.fuel.network/account/${address.toHexString()}`,
      )
      .text("Close  ❌", "close")
      .row()
      .text("Withdraw ETH 📈", "withdraw")
      .text("Export Private Key 🔐", "export")
      .row()
      .text("Refresh 🔄", `refresh_wallet:${formattedBalance}`);
    ctx.editMessageText(messageText, {
      reply_markup: inlineKeyboard,
      parse_mode: "HTML",
    });
  }
};

const closeHandler = async (ctx: CallbackQueryContext<BotContext>) => {
  await ctx.deleteMessage();
};

const exitConvoHandler = async (ctx: CallbackQueryContext<BotContext>) => {
  const convoId = ctx.callbackQuery.data.split(":")[1];
  await ctx.conversation.exit(convoId);
  await ctx.deleteMessage();
};

bot.command("start", homeHandler);
bot.command("home", homeHandler);
bot.command("assets", assetListHandler);
bot.command("trade", tradeDetailHandler);
bot.callbackQuery(/^refresh:/, refreshHandler);
bot.callbackQuery(/^refresh_wallet:/, walletRefreshHandler);
bot.callbackQuery(/^exit_convo:/, exitConvoHandler);
bot.callbackQuery("buy", buyHandler);
bot.callbackQuery("trades", myTradesHandler);
bot.callbackQuery("wallet", walletHandler);
bot.callbackQuery("settings", settingsHandler);
bot.callbackQuery("close", closeHandler);
bot.callbackQuery("export_confirm", handleExportConfirm);
bot.callbackQuery("export_pk", handleExportPrivateKey);
bot.on("message", async (ctx) => {
  const message = ctx.message;
  const asset = getAsset(message.text || "");
  if (asset == null) {
    ctx.reply(
      `Asset not found ❌.\n\nMake sure value (${message.text}) is part of the supported asset list.\n\nYou can enter an assetId or asset symbol to buy an asset.\n\nTo view supported asset list, enter <code>/assets</code> command`,
      { parse_mode: "HTML" },
    );
  } else {
    ctx.session.buyAsset = asset;
    await ctx.conversation.enter("buyAsset");
  }
});
bot.catch((err) => {
  const ctx = err.ctx;
  console.error(`Error while handling update ${ctx.update.update_id}:`);
  const e = err.error;
  if (e instanceof GrammyError) {
    console.error("Error in request:", e.description);
  } else if (e instanceof HttpError) {
    console.error("Could not contact Telegram:", e);
  } else {
    console.error("Unknown error:", e);
  }
});

bot.start();
bot.api.setMyCommands([
  { command: "home", description: "open main menu" },
  { command: "assets", description: "view supported asset list" },
]);
