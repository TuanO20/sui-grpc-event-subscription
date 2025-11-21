import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Transaction, Inputs } from '@mysten/sui/transactions';
import { fromHex } from '@mysten/sui/utils';
import dotenv from 'dotenv';

dotenv.config();

const SUI_GRPC_ENDPOINT: string = process.env.SUI_GRPC_ENDPOINT || "";

const PRIVATE_KEY: string = process.env.PRIVATE_KEY || "";
// Use standard mainnet RPC endpoint
const SUI_RPC_ENDPOINT: string = getFullnodeUrl('mainnet');

const CETUS_PACKAGE_ID: string = "0xfbb32ac0fa89a3cb0c56c745b688c6d2a53ac8e43447119ad822763997ffb9c3";
const GLOBAL_CONFIG = '0xdaa46292632c3c4d8f31f23ea0f9b36a28ff3677e9684980e4438403a67a3d8f';
const POOL_ID: string = '0xb8d7d9e66a60c239e7a60110efcf8de6c705580ed924d0dde141f4a0e2c90105'; // SUI-USDC Pool
const POOL_INITIAL_SHARED_VERSION = '373623018'; // Pool's initial shared version
const USDC_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
const SUI_TYPE = '0x2::sui::SUI';

// Initialize standard JSON-RPC client
const client = new SuiClient({
    // url: SUI_RPC_ENDPOINT
    url: SUI_GRPC_ENDPOINT
});

async function getSenderKeyPair(): Promise<Ed25519Keypair> {
    let keypair;

    // Check if it's the standard "suiprivkey..." format (Bech32)
    if (PRIVATE_KEY.startsWith('suiprivkey')) {
        const { secretKey } = decodeSuiPrivateKey(PRIVATE_KEY);
        keypair = Ed25519Keypair.fromSecretKey(secretKey);
    } else {
        // Otherwise assume it's a Hex string (with or without 0x)
        const raw = PRIVATE_KEY.replace(/^0x/, '');
        keypair = Ed25519Keypair.fromSecretKey(fromHex(raw));
    }

    return keypair;
}

async function main() {
    const keypair = await getSenderKeyPair();
    const sender = keypair.toSuiAddress();
    console.log('Sender:', sender);

    // 1. Build transaction
    const tx = new Transaction();
    tx.setSender(sender);

    // Fix: The Pool 0xb8d...0105 is likely Pool<USDC, SUI>.
    // We must match the pool's type order in typeArguments.
    // Since we want to swap SUI -> USDC, and SUI is Coin B:
    // - typeArguments: [USDC, SUI]
    // - a2b: false (B -> A)
    // - coins_a: zeroCoin (USDC)
    // - coins_b: swapCoin (SUI)

    const a2b = false; // SUI (B) -> USDC (A)
    const byAmountIn = true;
    const amount = 100000000;
    // For a2b = false (buying A with B), price limit should be MAX_SQRT_PRICE
    const sqrtPriceLimit = '79226673515401279992447579055';

    // Create a zero coin for the output placeholder (USDC - Coin A)
    const zeroCoin = tx.moveCall({
        target: '0x2::coin::zero',
        typeArguments: [USDC_TYPE],
    });

    const [swapCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(amount)]);

    const gasPrice = await client.getReferenceGasPrice();

    // Set gas price is double the reference one -> More priority
    tx.setGasPrice(gasPrice * 2n);
    tx.setGasBudget(100000000);

    const result = tx.moveCall({
        target: `${CETUS_PACKAGE_ID}::router::swap`,
        typeArguments: [
            USDC_TYPE,                          // T0 (Coin A)
            SUI_TYPE                            // T1 (Coin B)
        ],
        arguments: [
            tx.object(GLOBAL_CONFIG),           // arg0: GlobalConfig
            tx.object(Inputs.SharedObjectRef({
                objectId: POOL_ID,
                initialSharedVersion: 373623018,
                mutable: true,
            })),                                // arg1: Pool
            zeroCoin,                           // arg2: Coin<T0> (USDC - Zero)
            swapCoin,                           // arg3: Coin<T1> (SUI - Input)
            tx.pure.bool(a2b),                  // arg4: a2b
            tx.pure.bool(byAmountIn),           // arg5: by_amount_in
            tx.pure.u64(amount),                // arg6: amount
            tx.pure.u128(sqrtPriceLimit),       // arg7: sqrt_price_limit
            tx.pure.bool(false),                // arg8: swap_all
            tx.object.clock()                   // arg9: Clock
        ],
    });

    // Transfer the returned coins back to sender
    tx.transferObjects([result[0], result[1]], tx.pure.address(sender));

    // 2. Build & Sign & Execute (All in one via JSON-RPC)
    console.log('Executing transaction via JSON-RPC...');

    try {
        const result = await client.signAndExecuteTransaction({
            signer: keypair,
            transaction: tx,
            options: {
                showEffects: true,
                showEvents: true,
                showObjectChanges: true,
                showBalanceChanges: true
            },
        });

        if (result.effects?.status?.status === 'success') {
            console.log('✅ Transaction executed successfully!');
            console.log('Digest:', result.digest);
            console.log('Status:', result.effects?.status?.status);
        } else {
            console.log('❌ Transaction execution failed!');
            console.log('Status:', result.effects?.status?.status);
        }
    } catch (error: any) {
        console.error('❌ Failed to execute transaction:', error);
    }
}

main().catch(console.error);
