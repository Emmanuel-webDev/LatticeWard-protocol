/**
 * Converts native bank-coin fUSD (`erc20:0x97143B771D34ddb9130b807b135Ae675A5a963CA`)
 * to ERC-20 fUSD on the EVM lane for DEPLOYER via `/cosmos.evm.erc20.v1.MsgConvertCoin`,
 * hybrid-signed with ML-DSA-87 + eth_secp256k1 using @qorechain/sdk.
 *
 * Usage:
 *   npm run convert:fusd             # defaults to 1000000 raw (1 fUSD, 6 decimals)
 *   npm run convert:fusd -- 50000000 # converts 50 fUSD (50000000 raw)
 *
 * Reads DEPLOYER_MNEMONIC from .env. Never prints or logs keys or phrases.
 */
import "dotenv/config";
import { BinaryReader, BinaryWriter } from "@bufbuild/protobuf/wire";
import { type TsProtoGeneratedType } from "@cosmjs/proto-signing";
import {
  EthNativeSigner,
  type EthBroadcaster,
  type UnifiedAccount,
  deriveUnifiedAccount,
  derivePqcLegacy,
  fetchPqcStatus,
  pqcKeyFromRecoveryCode,
  pqcStatusPublicKey,
  qorechainRegistry,
  toHex,
  unifiedAccountFromSeed,
} from "@qorechain/sdk";
import { formatUnits, getBytes } from "ethers";
import { env, getFusd, getProvider } from "../packages/agent-mcp/src/config.js";

export const MSG_CONVERT_COIN_TYPE_URL = "/cosmos.evm.erc20.v1.MsgConvertCoin";
export const FUSD_BANK_DENOM = "erc20:0x97143B771D34ddb9130b807b135Ae675A5a963CA";

export interface MsgConvertCoinValue {
  coin: {
    denom: string;
    amount: string;
  };
  receiver: string;
  sender: string;
}

function encodeCoin(coin: { denom: string; amount: string }, writer = new BinaryWriter()): BinaryWriter {
  if (coin.denom !== "") {
    writer.uint32(10).string(coin.denom);
  }
  if (coin.amount !== "") {
    writer.uint32(18).string(coin.amount);
  }
  return writer;
}

function decodeCoin(input: BinaryReader | Uint8Array, length?: number): { denom: string; amount: string } {
  const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
  const end = length === undefined ? reader.len : reader.pos + length;
  const message = { denom: "", amount: "" };
  while (reader.pos < end) {
    const tag = reader.uint32();
    switch (tag >>> 3) {
      case 1:
        message.denom = reader.string();
        break;
      case 2:
        message.amount = reader.string();
        break;
      default:
        reader.skip(tag & 7);
        break;
    }
  }
  return message;
}

export const MsgConvertCoinType: TsProtoGeneratedType = {
  encode(message: MsgConvertCoinValue, writer = new BinaryWriter()): BinaryWriter {
    if (message.coin !== undefined) {
      encodeCoin(message.coin, writer.uint32(10).fork()).join();
    }
    if (message.receiver !== "") {
      writer.uint32(18).string(message.receiver);
    }
    if (message.sender !== "") {
      writer.uint32(26).string(message.sender);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgConvertCoinValue {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    const message: MsgConvertCoinValue = { coin: { denom: "", amount: "" }, receiver: "", sender: "" };
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.coin = decodeCoin(reader, reader.uint32());
          break;
        case 2:
          message.receiver = reader.string();
          break;
        case 3:
          message.sender = reader.string();
          break;
        default:
          reader.skip(tag & 7);
          break;
      }
    }
    return message;
  },
  fromPartial(object: Partial<MsgConvertCoinValue>): MsgConvertCoinValue {
    return {
      coin: {
        denom: object.coin?.denom ?? "",
        amount: object.coin?.amount ?? "",
      },
      receiver: object.receiver ?? "",
      sender: object.sender ?? "",
    };
  },
};

function createRestBroadcaster(restUrl: string): EthBroadcaster {
  const base = restUrl.replace(/\/+$/, "");
  return {
    async broadcastTx(tx: Uint8Array, timeoutMs = 45_000, pollIntervalMs = 2_000) {
      const txBytesBase64 = Buffer.from(tx).toString("base64");
      const postRes = await fetch(`${base}/cosmos/tx/v1beta1/txs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tx_bytes: txBytesBase64,
          mode: "BROADCAST_MODE_SYNC",
        }),
      });
      if (!postRes.ok) {
        const body = await postRes.text();
        throw new Error(`Broadcast HTTP ${postRes.status}: ${body}`);
      }
      const postJson = (await postRes.json()) as {
        tx_response?: {
          code?: number;
          txhash?: string;
          raw_log?: string;
        };
      };
      const syncResp = postJson.tx_response;
      const txHash = syncResp?.txhash ?? "";
      if (!txHash) {
        throw new Error(`Missing txhash in broadcast response: ${JSON.stringify(postJson)}`);
      }
      if ((syncResp?.code ?? 0) !== 0) {
        return {
          code: syncResp!.code!,
          transactionHash: txHash,
          rawLog: syncResp?.raw_log,
        };
      }

      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, pollIntervalMs));
        const pollRes = await fetch(`${base}/cosmos/tx/v1beta1/txs/${txHash}`);
        if (!pollRes.ok) continue;
        const pollJson = (await pollRes.json()) as {
          tx_response?: {
            code?: number;
            txhash?: string;
            height?: string;
            gas_used?: string;
            gas_wanted?: string;
            raw_log?: string;
          };
        };
        const tr = pollJson.tx_response;
        if (tr && tr.height && Number(tr.height) > 0) {
          return {
            code: tr.code ?? 0,
            transactionHash: tr.txhash ?? txHash,
            height: Number(tr.height),
            gasUsed: tr.gas_used ? BigInt(tr.gas_used) : undefined,
            gasWanted: tr.gas_wanted ? BigInt(tr.gas_wanted) : undefined,
            rawLog: tr.raw_log,
          };
        }
      }
      throw new Error(`Timed out waiting for tx ${txHash} to commit on-chain`);
    },
  };
}

async function fetchBankFusdBalance(restUrl: string, qorAddress: string): Promise<string> {
  const base = restUrl.replace(/\/+$/, "");
  const res = await fetch(`${base}/cosmos/bank/v1beta1/balances/${qorAddress}`);
  if (!res.ok) return "0";
  const data = (await res.json()) as { balances?: { denom: string; amount: string }[] };
  const entry = data.balances?.find((b) => b.denom === FUSD_BANK_DENOM);
  return entry?.amount ?? "0";
}

async function fetchAccountNumberAndSequence(
  restUrl: string,
  qorAddress: string,
): Promise<{ accountNumber: bigint; sequence: bigint }> {
  const base = restUrl.replace(/\/+$/, "");
  const res = await fetch(`${base}/cosmos/auth/v1beta1/accounts/${qorAddress}`);
  if (!res.ok) {
    throw new Error(`Failed to query account auth for ${qorAddress}: HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    account?: {
      account_number?: string;
      sequence?: string;
      base_account?: {
        account_number?: string;
        sequence?: string;
      };
    };
  };
  const accNum = data.account?.account_number ?? data.account?.base_account?.account_number ?? "0";
  const seq = data.account?.sequence ?? data.account?.base_account?.sequence ?? "0";
  return {
    accountNumber: BigInt(accNum),
    sequence: BigInt(seq),
  };
}

async function main() {
  const mnemonic = process.env.DEPLOYER_MNEMONIC?.trim();
  const deployerPk = process.env.DEPLOYER_PRIVATE_KEY?.trim();
  const recoveryCode = process.env.DEPLOYER_PQC_RECOVERY_CODE?.trim();

  if (!mnemonic && !(deployerPk && recoveryCode)) {
    console.error(
      "ERROR: MsgConvertCoin is a Cosmos-lane transaction that requires hybrid signing (secp256k1 + ML-DSA-87).\n" +
        "DEPLOYER_PRIVATE_KEY (0x...) only contains the classical secp256k1 key and cannot derive the ML-DSA-87 key.\n" +
        "Please add EITHER:\n" +
        '  1) DEPLOYER_MNEMONIC="<12 or 24 word phrase>" in .env, OR\n' +
        '  2) DEPLOYER_PQC_RECOVERY_CODE="QRC1-..." in .env (alongside DEPLOYER_PRIVATE_KEY).',
    );
    process.exit(1);
  }

  const rawAmount = process.argv[2]?.trim() || "1000000"; // default: 1 fUSD (6 decimals)
  if (!/^\d+$/.test(rawAmount) || BigInt(rawAmount) <= 0n) {
    throw new Error(`Invalid raw fUSD amount: ${rawAmount}`);
  }

  const restUrl = process.env.QOR_REST_API?.trim() || "https://api-testnet.qore.host";
  const cosmosChainId = process.env.QOR_COSMOS_CHAIN_ID?.trim() || "qorechain-diana";

  let account: UnifiedAccount;
  if (mnemonic) {
    account = await deriveUnifiedAccount(mnemonic);
    if (recoveryCode) {
      account.pqc = pqcKeyFromRecoveryCode(recoveryCode, account.cosmos);
    } else {
      const pqcStatus = await fetchPqcStatus({ rest: restUrl, address: account.cosmos });
      const onChainPk = pqcStatusPublicKey(pqcStatus);
      if (onChainPk && toHex(onChainPk) !== toHex(account.pqc.publicKey)) {
        const legacyPqc = derivePqcLegacy(mnemonic);
        if (toHex(onChainPk) === toHex(legacyPqc.publicKey)) {
          account.pqc = legacyPqc;
        }
      }
    }
  } else {
    const pkHex = deployerPk!.startsWith("0x") ? deployerPk! : `0x${deployerPk!}`;
    account = unifiedAccountFromSeed(getBytes(pkHex), { recoveryCode: recoveryCode! });
  }

  const provider = getProvider();
  const fusd = getFusd(provider);
  const fusdDecimals = Number(await fusd.decimals());

  const [erc20Before, bankBefore, auth] = await Promise.all([
    fusd.balanceOf(account.evm) as Promise<bigint>,
    fetchBankFusdBalance(restUrl, account.cosmos),
    fetchAccountNumberAndSequence(restUrl, account.cosmos),
  ]);

  console.log(`DEPLOYER: ${account.evm} (${account.cosmos})`);
  console.log(
    `Before conversion: ERC-20 fUSD=${formatUnits(erc20Before, fusdDecimals)} (raw=${erc20Before.toString()}) | Bank fUSD=${formatUnits(BigInt(bankBefore), fusdDecimals)} (raw=${bankBefore})`,
  );

  const registry = qorechainRegistry([[MSG_CONVERT_COIN_TYPE_URL, MsgConvertCoinType]]);
  const signer = new EthNativeSigner(account, {
    registry,
    signMode: "hybrid",
    signBytesVersion: "auto",
    rest: restUrl,
  });

  const convertMsg = {
    typeUrl: MSG_CONVERT_COIN_TYPE_URL,
    value: MsgConvertCoinType.fromPartial({
      coin: {
        denom: FUSD_BANK_DENOM,
        amount: rawAmount,
      },
      sender: account.cosmos,
      receiver: account.evm,
    }),
  };

  const fee = {
    amount: [{ denom: "uqor", amount: "60000" }],
    gas: "600000",
  };

  console.log(`Broadcasting MsgConvertCoin (${formatUnits(BigInt(rawAmount), fusdDecimals)} fUSD, raw=${rawAmount})...`);
  const transport = createRestBroadcaster(restUrl);
  const res = await signer.signAndBroadcast(transport, {
    chainId: cosmosChainId,
    accountNumber: auth.accountNumber,
    sequence: auth.sequence,
    messages: [convertMsg],
    fee,
    memo: "LatticeWard MsgConvertCoin fUSD",
  });

  console.log(`Committed in block ${res.height ?? "?"} | txHash=${res.transactionHash}`);

  const [erc20After, bankAfter] = await Promise.all([
    fusd.balanceOf(account.evm) as Promise<bigint>,
    fetchBankFusdBalance(restUrl, account.cosmos),
  ]);

  console.log(
    `After conversion:  ERC-20 fUSD=${formatUnits(erc20After, fusdDecimals)} (raw=${erc20After.toString()}) | Bank fUSD=${formatUnits(BigInt(bankAfter), fusdDecimals)} (raw=${bankAfter})`,
  );
}

main().catch((err) => {
  console.error(`MsgConvertCoin failed: ${(err as Error).message}`);
  process.exit(1);
});
