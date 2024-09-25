import { Address } from "fuels";
import { InlineKeyboard } from "grammy";

export const validateEnv = (required: string[]) => {
  let missen = false;
  let message = "Could not found these variables in env ";
  for (const variable of required) {
    if (!process.env[variable]) {
      message += `${variable} `;
      missen = true;
    }
  }
  if (missen) {
    throw new Error(message);
  }
};

export const getHomeReplyMessage = (formattedBalance: number, userName: string | undefined, address: Address) => {
    let replyMessage =
    `<b>Hey ${userName} 👋, welcome to MoonSniper🎉.</b>\n\nFuel's first and fastest bot for trading any asset.\n\n`;
  if (formattedBalance == 0) {
    replyMessage += `You currently have no ETH in your wallet. To get started with trading, send some ETH to your moonsnipe wallet address:\n\n<code>${address.toHexString()}</code> (tap to copy)\n\nOnce done tap refresh and your balance will appear here.\n\n`
  } else {
    replyMessage += `Wallet Address: <code>${address.toHexString()}</code> (tap to copy)\nETH Balance: $${formattedBalance}\n\n`
  }
  replyMessage += `To buy an asset, just enter the assetId.\n\nFor more info on your wallet and to retrieve your private key, tap the wallet button below. We guarantee the safety of user funds on MoonSnipe, but if you expose your private key your funds will not be safe.`
  return replyMessage
}

export const getHomeInlineKeyboard = () => {
    return new InlineKeyboard()
      .text("Buy 💰", "buy")
      .text("My Trades  🔍", "trades")
      .row().text("Wallet 💳", "wallet")
      .text("Settings ⚙️", "settings")
      .row()
      .text("Refresh 🔄", "refresh")
}
