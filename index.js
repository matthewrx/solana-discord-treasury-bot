require("dotenv").config(); // Load .env file
const axios = require("axios");
const fs = require("fs");
const { Connection, PublicKey } = require("@solana/web3.js");
const Discord = require("discord.js");
const balancesFileName = "./balances.json";
const webhookClient = new Discord.WebhookClient({
  url: process.env.WEBHOOK_URL,
});
const mainneturl = process.env.RPC_URL || "https://api.mainnet-beta.solana.com";

const connection = new Connection(mainneturl, "confirmed");

const client = new Discord.Client({
  intents: [
    Discord.GatewayIntentBits.Guilds,
    Discord.GatewayIntentBits.GuildMessages,
    Discord.GatewayIntentBits.GuildPresences,
  ],
});

const GUILD_ID = process.env.YOUR_DISCORD_SERVER_ID;
const BOT_ID = process.env.YOUR_BOT_ID;

const interval = 60 * 1000 * process.env.INTERVAL_MINUTES;

async function fetchPrice() {
  console.log("getting solana price!");
  let priceResponse = {
    priceUsd: 0,
    error: null,
  };
  try {
    let config = {
      method: "get",
      maxBodyLength: Infinity,
      url: "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
    };
    const response = await axios.request(config);
    const data = await response.data;
    if (data && data.solana.usd) {
      priceResponse.priceUsd = data.solana.usd;
    }
  } catch (error) {
    priceResponse.error = error.message;
    console.log(error);
  }
  console.log("SOL price: $", priceResponse.priceUsd);
  return priceResponse;
}

async function getAccountBalances() {
  console.log("getting account balances!");
  const accountsFile = fs.readFileSync(balancesFileName);
  const accountsFileContent = JSON.parse(accountsFile);
  let updatedAccountBalances = {
    last_updated: Math.round(Date.now() / 1000),
    accounts: [],
  };
  for (let i = 0; i < accountsFileContent.accounts.length; i++) {
    let account = accountsFileContent.accounts[i];
    const accPubkey = new PublicKey(account.address);
    if (account.type == "USDC") {
      const acc_bal = await connection.getTokenAccountBalance(
        accPubkey,
        "confirmed"
      );
      const amount = acc_bal.value.uiAmount;
      if (account.prevBalances.str != amount.toLocaleString()) {
        account.balanceChange.num = amount - account.prevBalances.num;
        account.balanceChange.str = account.balanceChange.num.toLocaleString();
        account.balanceChange.num > 0
          ? (account.balanceChange.direction = "+")
          : "-";
        account.prevBalances.str = amount.toLocaleString();
        account.prevBalances.num = amount;
      } else {
        account.balanceChange.num = 0;
        account.balanceChange.str = "0";
        account.balanceChange.direction = null;
      }
      account.currentBalances.str = amount.toLocaleString();
      account.currentBalances.num = amount;
    }
    if (account.type == "SOL") {
      const acc_bal = await connection.getBalanceAndContext(
        accPubkey,
        "confirmed"
      );
      const amount = acc_bal.value / 1000000000;
      if (account.prevBalances.str != amount.toLocaleString()) {
        account.balanceChange.num = amount - account.prevBalances.num;
        account.balanceChange.str = account.balanceChange.num.toLocaleString();
        account.balanceChange.num > 0
          ? (account.balanceChange.direction = "+")
          : "-";
        account.prevBalances.str = amount.toLocaleString();
        account.prevBalances.num = amount;
      } else {
        account.balanceChange.num = 0;
        account.balanceChange.str = "0";
        account.balanceChange.direction = null;
      }
      account.currentBalances.str = amount.toLocaleString();
      account.currentBalances.num = amount;
    }
    updatedAccountBalances.accounts.push(account);
  }
  fs.writeFileSync(
    balancesFileName,
    JSON.stringify(updatedAccountBalances, null, 2)
  );
  await editWebhook(updatedAccountBalances);
}

async function editWebhook(accountBalances) {
  const timestamp = Math.round(Date.now() / 1000);
  const embed = new Discord.EmbedBuilder()
    .setTitle("Funds")
    .setColor(0x00ffff)
    .setTimestamp(Date.now())
    .setImage(
      "https://i.kym-cdn.com/photos/images/original/002/476/043/910.jpg"
    );
  let total_sol = 0;
  let total_usdc = 0;
  for (let i = 0; i < accountBalances.accounts.length; i++) {
    const acc = accountBalances.accounts[i];
    {
      acc.type == "SOL"
        ? (total_sol += acc.currentBalances.num)
        : (total_usdc += acc.currentBalances.num);
    }
    let field_value;
    if (acc.balanceChange.direction != null) {
      field_value = `${acc.symbol} ${acc.currentBalances.str}\nChange: ${acc.balanceChange.direction} ${acc.balanceChange.str}\n[solscan](https://solscan.io/account/${acc.address})`;
    } else {
      field_value = `${acc.symbol} ${acc.currentBalances.str}\n[solscan](https://solscan.io/account/${acc.address})`;
    }
    embed.addFields({
      name: `${acc.name}:`,
      value: field_value,
      inline: true,
    });
  }
  const solana_price = await fetchPrice();
  embed.addFields(
    {
      name: "Total SOL Balance:",
      value: `◎ ${total_sol.toLocaleString()}`,
      inline: false,
    },
    {
      name: "Total USDC Value:",
      value: `$ ${(
        total_sol * solana_price.priceUsd +
        total_usdc
      ).toLocaleString()}`,
      inline: false,
    },
    {
      name: "Current SOL Price:",
      value: solana_price.priceUsd.toLocaleString(),
      inline: false,
    },
    {
      name: "Updated:",
      value: `<t:${timestamp}:R>`,
      inline: false,
    }
  );
  console.log("submitting webhook!");
  await webhookClient.editMessage(process.env.WEBHOOK_MESSAGE_ID, {
    embeds: [embed],
  });
}

client.on("ready", async () => {
  console.log("Logged in as", client.user.tag);
  const guild = client.guilds.cache.get(GUILD_ID);
  client.user.setPresence({
    activities: [
      {
        name: `Treasury Balances`,
        type: 3,
      },
    ],
    status: "dnd",
  });
  guild.members.edit(BOT_ID, {
    nick: `Treasury`,
  });
  setInterval(getAccountBalances, interval);
});

// Login to Discord
client.login(process.env.DISCORD_TOKEN);
