import type { QorexEncodedMessage } from "@qorechain/qorex-types";

/**
 * QoreX `signAndBroadcast` requires each message `value` to be protobuf-encoded
 * bytes. We use the official @qorechain/sdk composer + registry (lazy-loaded so
 * the cosmjs dependency tree only downloads when a native tx is actually sent).
 */
export async function encodeOpenEvmWindow(params: {
  sender: string;
  blocks: number;
  maxTxs: number;
  maxValueUqor: string;
  allowedTargets: string[];
}): Promise<QorexEncodedMessage> {
  const sdk = await import("@qorechain/sdk");
  const msg = sdk.openEvmWindowMsg({
    sender: params.sender,
    blocks: params.blocks,
    maxTxs: params.maxTxs,
    maxValue: params.maxValueUqor,
    nativeOnly: false,
    allowedTargets: params.allowedTargets,
  } as never);
  const registry = sdk.qorechainRegistry();
  return { typeUrl: msg.typeUrl, value: registry.encode(msg) };
}

export async function encodeCloseEvmWindow(sender: string): Promise<QorexEncodedMessage> {
  const sdk = await import("@qorechain/sdk");
  const msg = sdk.closeEvmWindowMsg(sender);
  const registry = sdk.qorechainRegistry();
  return { typeUrl: msg.typeUrl, value: registry.encode(msg) };
}
