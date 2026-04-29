require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const rawKey = process.env.PRIVATE_KEY || "";
// Normalise key — MetaMask exports without 0x prefix; ethers requires it
const PRIVATE_KEY = rawKey.length === 64
  ? "0x" + rawKey
  : rawKey.startsWith("0x") && rawKey.length === 66
    ? rawKey
    : "0x0000000000000000000000000000000000000000000000000000000000000001";
const AMOY_RPC_URL = process.env.AMOY_RPC_URL || "https://rpc-amoy.polygon.technology/";

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    amoy: {
      url: AMOY_RPC_URL,
      accounts: [PRIVATE_KEY],
      chainId: 80002,
    },
  },
  etherscan: {
    apiKey: {
      polygonAmoy: process.env.POLYGONSCAN_API_KEY || "",
    },
    customChains: [
      {
        network: "polygonAmoy",
        chainId: 80002,
        urls: {
          apiURL: "https://api-amoy.polygonscan.com/api",
          browserURL: "https://amoy.polygonscan.com",
        },
      },
    ],
  },
};
