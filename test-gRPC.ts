// import { SuiGrpcClient } from '@mysten/sui/grpc';
// import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
// import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
// import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
// import { Transaction, Inputs } from '@mysten/sui/transactions';
// import { fromHex } from '@mysten/sui/utils';
// import { fromBase64 } from '@mysten/bcs';
// import dotenv from 'dotenv';

// dotenv.config();

// const PRIVATE_KEY: string = process.env.PRIVATE_KEY || "";
// const SUI_GRPC_ENDPOINT: string = process.env.SUI_GRPC_ENDPOINT || "";
// const CETUS_PACKAGE_ID: string = "0xfbb32ac0fa89a3cb0c56c745b688c6d2a53ac8e43447119ad822763997ffb9c3";
// const GLOBAL_CONFIG = '0xdaa46292632c3c4d8f31f23ea0f9b36a28ff3677e9684980e4438403a67a3d8f';
// const POOL_ID: string = '0xb8d7d9e66a60c239e7a60110efcf8de6c705580ed924d0dde141f4a0e2c90105'; // SUI-USDC Pool
// const POOL_INITIAL_SHARED_VERSION = '373623018'; // Pool's initial shared version
// const USDC_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
// const SUI_TYPE = '0x2::sui::SUI';
// const CLOCK = '0x6';

// const grpcClient = new SuiGrpcClient({
//     network: 'mainnet',
//     baseUrl: SUI_GRPC_ENDPOINT,
// });

// async function getSenderKeyPair(): Promise<Ed25519Keypair> {
//     let keypair;

//     // Check if it's the standard "suiprivkey..." format (Bech32)
//     if (PRIVATE_KEY.startsWith('suiprivkey')) {
//         const { secretKey } = decodeSuiPrivateKey(PRIVATE_KEY);
//         keypair = Ed25519Keypair.fromSecretKey(secretKey);
//     } else {
//         // Otherwise assume it's a Hex string (with or without 0x)
//         const raw = PRIVATE_KEY.replace(/^0x/, '');
//         keypair = Ed25519Keypair.fromSecretKey(fromHex(raw));
//     }

//     return keypair;

// }

// async function main() {
//     const keypair = await getSenderKeyPair();
//     const sender = keypair.toSuiAddress();
//     console.log('Sender:', sender);

//     // 1. Build transaction
//     const tx = new Transaction();
//     tx.setSender(sender);

//     // Fix: The Pool 0xb8d...0105 is likely Pool<USDC, SUI>.
//     // We must match the pool's type order in typeArguments.
//     // Since we want to swap SUI -> USDC, and SUI is Coin B:
//     // - typeArguments: [USDC, SUI]
//     // - a2b: false (B -> A)
//     // - coins_a: zeroCoin (USDC)
//     // - coins_b: swapCoin (SUI)

//     const a2b = false; // SUI (B) -> USDC (A)
//     const byAmountIn = true;
//     const amount = 100000000;
//     // For a2b = false (buying A with B), price limit should be MAX_SQRT_PRICE
//     const sqrtPriceLimit = '79226673515401279992447579055';

//     // Create a zero coin for the output placeholder (USDC - Coin A)
//     const zeroCoin = tx.moveCall({
//         target: '0x2::coin::zero',
//         typeArguments: [USDC_TYPE],
//     });

//     const [swapCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(amount)]);
//     tx.setGasBudget(100000000);

//     const result = tx.moveCall({
//         target: `${CETUS_PACKAGE_ID}::router::swap`,
//         typeArguments: [
//             USDC_TYPE,      // T0 (Coin A)
//             SUI_TYPE        // T1 (Coin B)
//         ],
//         arguments: [
//             tx.object(GLOBAL_CONFIG),           // arg0: GlobalConfig
//             tx.object(Inputs.SharedObjectRef({
//                 objectId: POOL_ID,
//                 initialSharedVersion: 373623018,
//                 mutable: true,
//             })),                                // arg1: Pool
//             zeroCoin,                           // arg2: Coin<T0> (USDC - Zero)
//             swapCoin,                           // arg3: Coin<T1> (SUI - Input)
//             tx.pure.bool(a2b),                  // arg4: a2b
//             tx.pure.bool(byAmountIn),           // arg5: by_amount_in
//             tx.pure.u64(amount),                // arg6: amount
//             tx.pure.u128(sqrtPriceLimit),       // arg7: sqrt_price_limit
//             tx.pure.bool(false),                // arg8: swap_all
//             tx.object.clock()                   // arg9: Clock
//         ],
//     });

//     // Transfer the returned coins back to sender
//     tx.transferObjects([result[0], result[1]], tx.pure.address(sender));

//     // 2. Build bytes (resolves references via client if needed, but here we might need a provider if we use references)
//     // Since we are using gRPC, we might not have a JSON-RPC provider attached to the Transaction builder by default.
//     // However, `tx.build()` usually requires a provider to fetch gas price and object refs.
//     // For this example, we'll assume we can use the default build if we had a client, OR we need to fetch refs manually.
//     // BUT, since we are using `SuiGrpcClient`, we don't have a standard `SuiClient` for `tx.build`.
//     // We might need to use a standard HTTP client just for building, OR use the gRPC client to fetch what's needed (which is harder to plug into Transaction).
//     // Let's try to build it. If it fails due to missing provider, we might need to instantiate a standard SuiClient just for building.

//     // IMPORTANT: The `Transaction` class needs a `client` to resolve object versions and gas price.
//     // We should probably use a standard HTTP client for building the transaction bytes, 
//     // and then use gRPC for execution as requested.
//     // Let's add a standard client for building.

//     // Need to use HTTP endpoint for building (SuiClient doesn't support gRPC) -> Correct or not???
//     const buildClient = new SuiClient({ url: "https://fullnode.mainnet.sui.io:443" });

//     const transactionBytes = await tx.build({ client: buildClient });

//     // 3. Sign
//     const { signature } = await keypair.signTransaction(transactionBytes);

//     // 4. Execute via gRPC
//     console.log('Executing transaction via gRPC...');
//     try {
//         const { response } = await grpcClient.transactionExecutionService.executeTransaction({
//             transaction: {
//                 bcs: {
//                     value: transactionBytes,
//                 },
//             },
//             signatures: [
//                 {
//                     bcs: { value: fromBase64(signature) },
//                     signature: { oneofKind: undefined },
//                 }
//             ],
//         });

//         console.log('✅ Transaction executed successfully!');
//         console.log('Response:', response);
//     } catch (error: any) {
//         console.error('❌ Failed to execute transaction via gRPC:', error);
//     }
// }

// main().catch(console.error);
