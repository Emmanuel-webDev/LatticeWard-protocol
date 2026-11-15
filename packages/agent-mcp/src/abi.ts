export const PQC_VERIFY_ADDRESS = "0x0000000000000000000000000000000000000A01";
export const PQC_KEY_STATUS_ADDRESS = "0x0000000000000000000000000000000000000A02";

export const INTENT_TUPLE =
  "(bytes32 intentId,address target,address recipient,uint256 value,uint256 deadline,uint256 riskScoreBps,bytes32 rationaleHash)";
export const POLICY_TUPLE =
  "(address agent,uint256 windowExpiresAt,uint256 epochDuration,uint256 maxRiskScoreBps,bool requireRecipientPqc,bool frozen)";
export const ASSET_TUPLE = "(address asset,bool enabled,uint256 maxTxValue,uint256 epochLimit)";
export const WITHDRAW_TUPLE = "(address asset,address to,uint256 amount)";
export const CLAWBACK_TUPLE = "(address newAgent,address rescue,address[] assets)";

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
  `function executeScopedAgentIntent(${INTENT_TUPLE} env)`,
  `function configurePolicy(${POLICY_TUPLE} p, bytes mldsaPublicKey, bytes mldsaSignature)`,
  `function setAssetLimit(${ASSET_TUPLE} u, bytes mldsaPublicKey, bytes mldsaSignature)`,
  `function sovereignWithdraw(${WITHDRAW_TUPLE} w, bytes mldsaPublicKey, bytes mldsaSignature)`,
  `function emergencyClawback(${CLAWBACK_TUPLE} c, bytes mldsaPublicKey, bytes mldsaSignature)`,
  "function rotateSovereignKey(bytes32 newHash, bytes mldsaPublicKey, bytes mldsaSignature)",
  "event AuthenticatedAgentIntentExecuted(bytes32 indexed intentId,address indexed target,address indexed recipient,uint256 value,uint256 riskScoreBps,bytes32 rationaleHash)",
  "event SovereignActionAuthorized(bytes32 indexed tag,bytes32 digest,uint256 newPolicyNonce)",
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
  "error Reentrancy()",
  "error ZeroAddress()",
  "error InvalidRecipient(address recipient)",
];

export const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
];
