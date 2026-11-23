export const CHAIN_ID = 9800;
export const CHAIN_ID_HEX = "0x2648";
export const CHAIN_NAME = "QoreChain Diana Testnet";
export const COSMOS_CHAIN_ID = "qorechain-diana";

export const EVM_RPC_URL = "https://evm-testnet.qore.host";
export const REST_API_URL = "https://api-testnet.qore.host";
export const EXPLORER_URL = "https://explore.qore.network";

export const FACTORY_ADDRESS = "0xAEdE5a3B09c9BDC749297C39826C6DDdaF311C5c";
export const REFERENCE_VAULT_ADDRESS = "0x9697a96058555b3A0C50b2338440C84B927caB29";
export const FUSD_ADDRESS = "0x97143B771D34ddb9130b807b135Ae675A5a963CA";
export const FUSD_BANK_DENOM = "erc20:0x97143B771D34ddb9130b807b135Ae675A5a963CA";
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export const PQC_VERIFY_ADDRESS = "0x0000000000000000000000000000000000000A01";
export const PQC_KEY_STATUS_ADDRESS = "0x0000000000000000000000000000000000000A02";

export const DEFAULT_RELAYER_URL = (import.meta.env.VITE_RELAYER_URL as string | undefined)?.trim() || "";

export const INTENT_TUPLE =
  "(bytes32 intentId,address target,address recipient,uint256 value,uint256 deadline,uint256 riskScoreBps,bytes32 rationaleHash)";
export const POLICY_TUPLE =
  "(address agent,uint256 windowExpiresAt,uint256 epochDuration,uint256 maxRiskScoreBps,bool requireRecipientPqc,bool frozen)";
export const ASSET_TUPLE = "(address asset,bool enabled,uint256 maxTxValue,uint256 epochLimit)";
export const WITHDRAW_TUPLE = "(address asset,address to,uint256 amount)";
export const CLAWBACK_TUPLE = "(address newAgent,address rescue,address[] assets)";

export const FACTORY_ABI = [
  `function createVault(bytes32 sovereignKeyHash, ${POLICY_TUPLE} policy, ${ASSET_TUPLE}[] initialAssets) returns (address vault)`,
  "function vaultsOf(address owner) view returns (address[])",
  "function vaultCountOf(address owner) view returns (uint256)",
  "function isVault(address vault) view returns (bool)",
  "function totalVaults() view returns (uint256)",
  "event VaultCreated(address indexed owner, address indexed vault, bytes32 indexed sovereignKeyHash)",
];

export const VAULT_ABI = [
  "function sovereignKeyHash() view returns (bytes32)",
  "function agentKey() view returns (address)",
  "function windowExpiresAt() view returns (uint256)",
  "function epochDuration() view returns (uint256)",
  "function maxRiskScoreBps() view returns (uint256)",
  "function requireRecipientPqc() view returns (bool)",
  "function frozen() view returns (bool)",
  "function policyNonce() view returns (uint256)",
  "function assetLimits(address) view returns (bool enabled,uint256 maxTxValue,uint256 epochLimit,uint256 epochSpent,uint256 epochStart)",
  "function usedIntents(bytes32) view returns (bool)",
  "function sovereignDigest(bytes32 tag, bytes params) view returns (bytes32)",
  "function TAG_CONFIGURE() view returns (bytes32)",
  "function TAG_ASSET() view returns (bytes32)",
  "function TAG_WITHDRAW() view returns (bytes32)",
  "function TAG_CLAWBACK() view returns (bytes32)",
  "function TAG_ROTATE() view returns (bytes32)",
  `function executeScopedAgentIntent(${INTENT_TUPLE} env)`,
  `function configurePolicy(${POLICY_TUPLE} p, bytes mldsaPublicKey, bytes mldsaSignature)`,
  `function setAssetLimit(${ASSET_TUPLE} u, bytes mldsaPublicKey, bytes mldsaSignature)`,
  `function sovereignWithdraw(${WITHDRAW_TUPLE} w, bytes mldsaPublicKey, bytes mldsaSignature)`,
  `function triggerQDayEmergencyClawback(${CLAWBACK_TUPLE} c, bytes mldsaPublicKey, bytes mldsaSignature)`,
  `function emergencyClawback(${CLAWBACK_TUPLE} c, bytes mldsaPublicKey, bytes mldsaSignature)`,
  "function rotateSovereignKey(bytes32 newHash, bytes mldsaPublicKey, bytes mldsaSignature)",
  "event Deposited(address indexed from, uint256 amount)",
  "event AuthenticatedAgentIntentExecuted(bytes32 indexed intentId,address indexed target,address indexed recipient,uint256 value,uint256 riskScoreBps,bytes32 rationaleHash)",
  "event SovereignActionAuthorized(bytes32 indexed tag,bytes32 digest,uint256 newPolicyNonce)",
  "event PolicyConfigured(tuple(address agent,uint256 windowExpiresAt,uint256 epochDuration,uint256 maxRiskScoreBps,bool requireRecipientPqc,bool frozen) policy)",
  "event AssetLimitSet(address indexed asset, bool enabled, uint256 maxTxValue, uint256 epochLimit)",
  "event SovereignWithdrawal(address indexed asset, address indexed to, uint256 amount)",
  "event EmergencyClawback(address indexed oldAgent,address indexed newAgent,address indexed rescue)",
  "error NotAgent()",
  "error VaultFrozen()",
  "error WindowExpired()",
  "error IntentExpired()",
  "error IntentAlreadyUsed(bytes32 intentId)",
  "error AssetNotAllowed(address asset)",
  "error ExceedsScopedMaxTxValue(uint256 requested,uint256 maxAllowed)",
  "error ExceedsEpochSpendLimit(uint256 wouldSpend,uint256 limit)",
  "error RiskScoreTooHigh(uint256 scoreBps,uint256 maxBps)",
  "error RecipientNotQuantumSafe(address recipient)",
  "error SovereignKeyMismatch()",
  "error InvalidMLDSASignature()",
  "error InvalidPolicy()",
  "error TransferFailed()",
  "error ReentrancyGuardReentrantCall()",
  "error ZeroAddress()",
  "error InvalidRecipient(address recipient)",
];

export const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
];

export function explorerTxUrl(hash: string): string {
  return `${EXPLORER_URL}/tx/${hash}`;
}

export function explorerAddrUrl(addr: string): string {
  return `${EXPLORER_URL}/address/${addr}`;
}
