import { executeSwap, SwapParams } from './executeTx';
import { CetusEventSubscriber, CetusSwapEvent } from './cetus-events';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { fromHex } from '@mysten/sui/utils';
import dotenv from 'dotenv';
import * as readline from 'readline';

dotenv.config();

const SUI_RPC_ENDPOINT: string = process.env.SUI_RPC_ENDPOINT || "";
const PRIVATE_KEY: string = process.env.PRIVATE_KEY || "";

// Event Subscription Config
const EVENT_SUBSCRIPTION_ENDPOINT: string = process.env.ENDPOINT || ""; // Use the same env var as cetus-events.ts
const EVENT_SUBSCRIPTION_TOKEN: string = process.env.TOKEN || "";
const MIN_SUI_AMOUNT_THRESHOLD = BigInt(500) * BigInt(1_000_000_000); // 500 SUI

// Swap Config
const CETUS_SWAP_FUNCTION: string = "0xfbb32ac0fa89a3cb0c56c745b688c6d2a53ac8e43447119ad822763997ffb9c3::router::swap";
const GLOBAL_CONFIG = '0xdaa46292632c3c4d8f31f23ea0f9b36a28ff3677e9684980e4438403a67a3d8f';
const POOL_ID: string = '0xb8d7d9e66a60c239e7a60110efcf8de6c705580ed924d0dde141f4a0e2c90105'; // SUI-USDC Pool
const POOL_INITIAL_SHARED_VERSION = '373623018'; // Pool's initial shared version
const USDC_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
const SUI_TYPE = '0x2::sui::SUI';

// Initialize standard JSON-RPC client for execution
const client = new SuiClient({
    // url: SUI_RPC_ENDPOINT
    url: SUI_RPC_ENDPOINT
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

function askQuestion(query: string): Promise<string> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise(resolve => rl.question(query, ans => {
        rl.close();
        resolve(ans);
    }));
}

async function getPoolInitialSharedVersion(poolId: string): Promise<string | null> {
    try {
        const object = await client.getObject({
            id: poolId,
            options: { showOwner: true }
        });

        if (object.data?.owner && typeof object.data.owner === 'object' && 'Shared' in object.data.owner) {
            return object.data.owner.Shared.initial_shared_version.toString();
        }
        return null;
    } catch (e) {
        console.error(`Failed to fetch pool object ${poolId}:`, e);
        return null;
    }
}

async function main() {
    const keypair = await getSenderKeyPair();
    const senderAddress = keypair.toSuiAddress();
    console.log(`Wallet loaded: ${senderAddress}`);

    if (!EVENT_SUBSCRIPTION_ENDPOINT || !EVENT_SUBSCRIPTION_TOKEN) {
        console.error("Missing ENDPOINT or TOKEN in environment variables for event subscription");
        process.exit(1);
    }

    console.log(`Starting Cetus Event Subscriber (Threshold: ${MIN_SUI_AMOUNT_THRESHOLD} MIST)...`);
    const subscriber = new CetusEventSubscriber(EVENT_SUBSCRIPTION_ENDPOINT, EVENT_SUBSCRIPTION_TOKEN, MIN_SUI_AMOUNT_THRESHOLD);

    subscriber.subscribe(async (event: CetusSwapEvent) => {
        // Log the event
        console.log('\n' + '='.repeat(80));
        console.log(`🔄 TARGET SWAP DETECTED`);
        console.log('='.repeat(80));
        console.log(`Txn digest:        ${event.transactionDigest}`);
        console.log(`Pool Address:      ${event.poolAddress}`);
        console.log(`Amount in:         ${event.amountIn}`);
        console.log(`Amount out:        ${event.amountOut}`);
        console.log(`Direction:         ${event.atob ? 'A -> B' : 'B -> A'}`);
        console.log('='.repeat(80));

        // Ask for confirmation
        // Note: This pauses the event processing loop effectively because we await the user input.
        // However, the gRPC stream might continue to buffer events in the background.
        try {
            const answer = await askQuestion("Found target swap! Execute SAME-DIRECTION swap? (type 'y' and enter to confirm): ");

            if (answer.toLowerCase() === 'y') {
                console.log("User confirmed. Fetching pool details...");

                const initialSharedVersion = await getPoolInitialSharedVersion(event.poolAddress);
                if (!initialSharedVersion) {
                    console.error("❌ Could not fetch initial shared version for pool. Aborting.");
                    return;
                }

                console.log(`Pool Initial Shared Version: ${initialSharedVersion}`);
                console.log("Preparing transaction...");

                const params: SwapParams = {
                    dexSwapFunction: CETUS_SWAP_FUNCTION,
                    globalConfig: GLOBAL_CONFIG,
                    poolId: event.poolAddress,
                    poolInitialSharedVersion: initialSharedVersion,
                    tokenAAddress: event.tokenA,
                    tokenBAddress: event.tokenB,
                    a2b: event.atob, // Same direction as event
                    amount: 100000000, // 0.1 SUI - Example amount
                    byAmountIn: true,
                    sqrtPriceLimit: '79226673515401279992447579055', // Placeholder, will be adjusted
                    keypair: keypair,
                    client: client,
                    gasBudget: 100000000
                };

                // Adjust sqrtPriceLimit based on direction
                // If a2b (A -> B), price decreases. Limit should be low (MIN_SQRT_PRICE).
                // If b2a (B -> A), price increases. Limit should be high (MAX_SQRT_PRICE).
                // Using standard Cetus limits:
                // MIN: 4295048016
                // MAX: 79226673515401279992447579055
                if (params.a2b) {
                    params.sqrtPriceLimit = '4295048016';
                } else {
                    params.sqrtPriceLimit = '79226673515401279992447579055';
                }

                console.log("Executing swap...");
                await executeSwap(params);
                console.log("Swap execution completed.");
            } else {
                console.log("User cancelled execution.");
            }
        } catch (e) {
            console.error("Error during execution flow:", e);
        }
    });

    // Keep the process alive
    process.on('SIGINT', () => {
        console.log(`\n\nClosing application...`);
        subscriber.unsubscribe();
        process.exit(0);
    });
}

main().catch(console.error);
