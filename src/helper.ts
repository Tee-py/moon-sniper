import {
  Address,
  DEFAULT_DECIMAL_UNITS,
  Provider,
  WalletUnlocked,
} from "fuels";
import { InlineKeyboard } from "grammy";
import { SUPPORTED_ASSETS } from "./constants";
import { PoolId } from "mira-dex-ts";

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

export const getEthBalance = async (
  wallet: WalletUnlocked,
  provider: Provider,
) => {
  wallet.provider = provider;
  const balance = await wallet.getBalance(provider.getBaseAssetId());
  return balance.toNumber() / 10 ** DEFAULT_DECIMAL_UNITS;
};

export const getHomeReplyMessage = (
  formattedBalance: number,
  userName: string | undefined,
  address: Address,
) => {
  let replyMessage = `<b>Hey ${userName} 👋, welcome to MoonSniper🎉.</b>\n\nFuel's first and fastest bot for trading any asset.\n\n`;
  if (formattedBalance == 0) {
    replyMessage += `You currently have no ETH in your wallet. To get started with trading, send some ETH to your moonsnipe wallet address:\n\n<code>${address.toHexString()}</code> (tap to copy)\n\nOnce done tap refresh and your balance will appear here.\n\n`;
  } else {
    replyMessage += `Wallet Address: <code>${address.toHexString()}</code> (tap to copy)\nETH Balance: $${formattedBalance}\n\n`;
  }
  replyMessage += `To buy an asset, just enter the assetId or symbol.\nTo view list of supported assets, enter the <code>/assets</code> command.\n\nFor more info on your wallet and to retrieve your private key, tap the wallet button below. We guarantee the safety of user funds on MoonSnipe, but if you expose your private key your funds will not be safe.`;
  return replyMessage;
};

export const getHomeInlineKeyboard = (balance: number) => {
  return new InlineKeyboard()
    .text("Buy 💰", "buy")
    .text("My Trades  🔍", "trades")
    .row()
    .text("Wallet 💳", "wallet")
    .text("Settings ⚙️", "settings")
    .row()
    .text("Refresh 🔄", `refresh:${balance}`);
};

export const getAsset = (param: string) => {
  const match = SUPPORTED_ASSETS.filter(
    (asset) =>
      asset.assetId == param ||
      asset.symbol.toLowerCase() == param.toLowerCase(),
  );
  if (match.length == 0) {
    return null;
  }
  return match[0];
};

export const getPoolId = (assetId: string) => {
  const poolId: PoolId = [
    // ETH
    {
      bits: "0xf8f8b6283d7fa5b672b530cbb84fcccb4ff8dc40f8176ef4544ddb1f1952ad07",
    },
    // USDT
    {
      bits: assetId,
    },
    false,
  ];
  return poolId;
};
