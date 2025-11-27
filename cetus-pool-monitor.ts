import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as path from 'path';
import dotenv from 'dotenv';
import { executeSwap, SwapParams } from './executeTx';
import { SuiClient } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { fromHex } from '@mysten/sui/utils';

dotenv.config();

// Configuration
const PROTO_PATH = path.join(__dirname, 'protos/sui/rpc/v2/subscription_service.proto');
const CETUS_CREATE_POOL_EVENT_TYPE = '0x1eabed72c53feb3805120a081dc15963c204dc8d091542592abaf7a35689b2fb::factory::CreatePoolEvent';

// Token Types
const SUI_TYPE = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
const USDC_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';

// Swap Config
const CETUS_SWAP_FUNCTION = "0xfbb32ac0fa89a3cb0c56c745b688c6d2a53ac8e43447119ad822763997ffb9c3::router::swap";
const GLOBAL_CONFIG = '0xdaa46292632c3c4d8f31f23ea0f9b36a28ff3677e9684980e4438403a67a3d8f';

export interface CreatePoolEvent {
    coin_type_a: string;
    coin_type_b: string;
    pool_id: string;
    tick_spacing: number;
    timestamp?: string;
    transactionDigest: string;
}

export class CetusPoolSubscriber {
    private client: any;
    private endpoint: string;
    private token: string;
    private stream: any;
    private suiClient: SuiClient;
    private keypair: Ed25519Keypair;

    constructor(endpoint: string, token: string, suiClient: SuiClient, keypair: Ed25519Keypair) {
        this.endpoint = endpoint;
        this.token = token;
        this.suiClient = suiClient;
        this.keypair = keypair;
        this.initializeClient();
    }

    private initializeClient() {
        const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
            keepCase: true,
            longs: String,
            enums: String,
            defaults: true,
            oneofs: true,
            includeDirs: [path.join(__dirname, 'protos')],
        });

        const proto = grpc.loadPackageDefinition(packageDefinition) as any;
        const SubscriptionService = proto.sui.rpc.v2.SubscriptionService;

        this.client = new SubscriptionService(this.endpoint, grpc.credentials.createSsl());
    }

    public subscribe() {
        const metadata = new grpc.Metadata();
        metadata.add('x-token', this.token);

        const request = {
            read_mask: {
                paths: [
                    'sequence_number',
                    'digest',
                    'summary',
                    'summary.timestamp_ms',
                    'transactions',
                    'transactions.digest',
                    'transactions.events',
                    'transactions.events.events',
                ],
            },
        };

        console.log('🔍 Subscribing to Cetus CreatePool Events...');
        console.log(`Event Type: ${CETUS_CREATE_POOL_EVENT_TYPE}`);

        this.stream = this.client.SubscribeCheckpoints(request, metadata);

        this.stream.on('data', async (response: any) => {
            const checkpoint = response.checkpoint;

            if (!checkpoint || !checkpoint.transactions || checkpoint.transactions.length === 0) {
                return;
            }

            for (const tx of checkpoint.transactions) {
                if (!tx.events || !tx.events.events) {
                    continue;
                }

                const createPoolEvents = tx.events.events.filter(
                    (event: any) => event.event_type === CETUS_CREATE_POOL_EVENT_TYPE
                );

                for (const event of createPoolEvents) {
                    await this.processEvent(event, checkpoint, tx);
                }
            }
        });

        this.stream.on('error', (error: any) => {
            console.error('Stream error:', error);
            this.reconnect();
        });

        this.stream.on('end', () => {
            console.log('\nStream ended');
        });
    }

    private async reconnect() {
        console.log('⚠️ Connection lost. Reconnecting in 5s...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        this.subscribe();
    }

    private async processEvent(event: any, checkpoint: any, tx: any) {
        try {
            // Try to parse from BCS if contents.value exists, or use parsedJson if available
            // The user provided example suggests we might get parsed JSON or need to decode BCS.
            // Standard Sui gRPC usually provides BCS in `contents`.
            // However, for simplicity and robustness, let's look at how `cetus-events.ts` did it.
            // It used BCS parsing. But `CreatePoolEvent` structure is simpler.
            // Let's assume we can decode it or it might be available in a different field if the node supports it.
            // BUT, `cetus-events.ts` manually parses BCS. I should probably do the same or try to find a way to get parsed JSON.
            // Wait, the user said "This is the sample structure of event".
            // If the gRPC returns BCS, I need to decode it.
            // Let's try to see if we can decode it.
            // Structure: coin_type_a (string/type), coin_type_b (string/type), pool_id (address), tick_spacing (u32)

            // Actually, decoding dynamic types like coin_type_a/b from BCS manually is hard without a schema.
            // However, the event `type` arguments usually contain the coin types!
            // `0x...::factory::CreatePoolEvent<CoinTypeA, CoinTypeB>`
            // So we can extract CoinTypeA and CoinTypeB from `event.event_type` string if it has generics.
            // BUT, the user provided `CETUS_CREATE_POOL_EVENT_TYPE` without generics in the constant.
            // The actual event type in the stream WILL have generics: `...::CreatePoolEvent<...>`

            // Let's look at `event.event_type`.
            // Example: `0x...::factory::CreatePoolEvent<0x...::sui::SUI, 0x...::bullish::BULLISH>`

            const eventType = event.event_type as string;
            const match = eventType.match(/<(.+), (.+)>/);

            let coinTypeA = '';
            let coinTypeB = '';

            if (match) {
                coinTypeA = match[1];
                coinTypeB = match[2];
            } else {
                // Fallback: maybe it's in the BCS data?
                // Parsing BCS for variable length strings/types is complex.
                // Let's rely on the type arguments for now as it's standard for Move events.
                console.warn(`Could not extract coin types from event type: ${eventType}`);
                return;
            }

            // We also need pool_id. This is definitely in the event data.
            // If we can't easily parse BCS, we might be stuck.
            // However, `cetus-events.ts` parsed BCS.
            // Let's try to parse the pool_id from BCS.
            // struct CreatePoolEvent has copy, drop, store {
            //     coin_type_a: TypeName, // This might be a string or just reflected in type args? 
            //     // Actually in Move, events often duplicate the type info in the data or just rely on the tag.
            //     // The user sample shows: {"coin_type_a": "...", "coin_type_b": "...", "pool_id": "...", "tick_spacing": 2}
            //     // If this is the JSON representation, then the BCS data corresponds to this struct.
            // }

            // Let's assume we need to parse BCS.
            // `pool_id` is likely an address (32 bytes).
            // `tick_spacing` is u32 (4 bytes).
            // `coin_type_a` and `coin_type_b` are `TypeName` which is a wrapper around String (ascii).

            let poolId = '';
            let tickSpacing = 0;

            if (event.contents && event.contents.value) {
                const buffer = Buffer.from(event.contents.value);
                // We need a proper BCS parser or guess the offsets.
                // Variable length strings (TypeName) make fixed offsets impossible.
                // But we can try to read it dynamically.

                let offset = 0;

                // coin_type_a (string)
                // first byte is length?
                // The `TypeName` struct in Move is `struct TypeName { name: String }`.
                // `String` is `struct String { bytes: vector<u8> }`.
                // So it's a vector<u8>.
                // BCS vector: ULEB128 length + bytes.

                // Helper to read vector<u8> as string
                const readString = () => {
                    // Assuming length is < 128 for now (1 byte ULEB128)
                    const len = buffer.readUInt8(offset);
                    offset += 1;
                    const str = buffer.subarray(offset, offset + len).toString('utf8');
                    offset += len;
                    return str;
                };

                // coin_type_a
                const coinAFromData = readString();
                // coin_type_b
                const coinBFromData = readString();
                // pool_id (address = 32 bytes)
                poolId = '0x' + buffer.subarray(offset, offset + 32).toString('hex');
                offset += 32;
                // tick_spacing (u32 = 4 bytes)
                tickSpacing = buffer.readUInt32LE(offset);

                // Verify if our extracted types match
                // console.log(`Parsed: A=${coinAFromData}, B=${coinBFromData}, Pool=${poolId}, Tick=${tickSpacing}`);
            } else {
                console.error('No content in event');
                return;
            }

            console.log('\n' + '='.repeat(80));
            console.log(`🆕 NEW POOL DETECTED`);
            console.log('='.repeat(80));
            console.log(`Pool ID:       ${poolId}`);
            console.log(`Token A:       ${coinTypeA}`);
            console.log(`Token B:       ${coinTypeB}`);
            console.log(`Tick Spacing:  ${tickSpacing}`);
            console.log('='.repeat(80));

            // Filter logic
            // We want pools where one token is SUI or USDC, and the other is the "New Token".
            // We want to buy the "New Token" using the "Base Token" (SUI or USDC).

            let baseToken = '';
            let newToken = '';
            let isA2B = false; // We want to swap Base -> New.
            // If Base is A, we swap A -> B (a2b = true).
            // If Base is B, we swap B -> A (a2b = false).

            // Normalize types (remove leading 0s after 0x if needed, but usually strict match is better)
            // The constants SUI_TYPE and USDC_TYPE are full addresses.
            // The event types might be slightly different (e.g. no leading zeros in address part).
            // Let's try to match loosely or normalize.

            const normalize = (t: string) => t.replace('0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI', '0x2::sui::SUI');

            const typeA = normalize(coinTypeA);
            const typeB = normalize(coinTypeB);
            const sui = normalize(SUI_TYPE);
            const usdc = normalize(USDC_TYPE);

            if (typeA === sui || typeA === usdc) {
                baseToken = typeA;
                newToken = typeB;
                isA2B = true; // Swap A (Base) -> B (New)
            } else if (typeB === sui || typeB === usdc) {
                baseToken = typeB;
                newToken = typeA;
                isA2B = false; // Swap B (Base) -> A (New)
            } else {
                console.log('Pool does not contain SUI or USDC. Skipping.');
                return;
            }

            console.log(`Targeting New Token: ${newToken}`);
            console.log(`Base Token: ${baseToken}`);
            console.log(`Direction: ${isA2B ? 'A -> B' : 'B -> A'}`);

            // Execute Swap
            await this.triggerSwap(poolId, coinTypeA, coinTypeB, isA2B);

        } catch (e) {
            console.error('Error processing event:', e);
        }
    }

    private async triggerSwap(poolId: string, tokenA: string, tokenB: string, a2b: boolean) {
        console.log('🚀 Triggering Auto-Buy...');

        if (process.env.DRY_RUN === 'true') {
            console.log('⚠️ [DRY RUN] Skipping actual swap execution.');
            return;
        }

        // We need the initial shared version of the pool.
        // Since it's a new pool, we might need to fetch it.
        const initialSharedVersion = await getPoolInitialSharedVersion(this.suiClient, poolId);
        if (!initialSharedVersion) {
            console.error('Could not fetch initial shared version. Aborting swap.');
            return;
        }

        const params: SwapParams = {
            dexSwapFunction: CETUS_SWAP_FUNCTION,
            globalConfig: GLOBAL_CONFIG,
            poolId: poolId,
            poolInitialSharedVersion: initialSharedVersion,
            tokenAAddress: tokenA,
            tokenBAddress: tokenB,
            a2b: a2b,
            amount: 100_000_000, // 0.1 SUI/USDC (Adjust decimals if USDC)
            byAmountIn: true,
            sqrtPriceLimit: a2b ? '4295048016' : '79226673515401279992447579055',
            keypair: this.keypair,
            client: this.suiClient,
            gasBudget: 100_000_000
        };

        try {
            await executeSwap(params);
            console.log('✅ Swap executed successfully!');
        } catch (e) {
            console.error('❌ Swap execution failed:', e);
        }
    }
}

async function getPoolInitialSharedVersion(client: SuiClient, poolId: string): Promise<string | null> {
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

// Main Execution
async function main() {
    const SUI_RPC_ENDPOINT = process.env.SUI_RPC_ENDPOINT || "";
    const ENDPOINT = process.env.ENDPOINT || "";
    const TOKEN = process.env.TOKEN || "";
    const PRIVATE_KEY = process.env.PRIVATE_KEY || "";

    if (!SUI_RPC_ENDPOINT || !ENDPOINT || !TOKEN || !PRIVATE_KEY) {
        console.error("Missing environment variables (SUI_RPC_ENDPOINT, ENDPOINT, TOKEN, PRIVATE_KEY)");
        process.exit(1);
    }

    // Initialize Sui Client
    const client = new SuiClient({ url: SUI_RPC_ENDPOINT });

    // Initialize Keypair
    let keypair;
    if (PRIVATE_KEY.startsWith('suiprivkey')) {
        const { secretKey } = decodeSuiPrivateKey(PRIVATE_KEY);
        keypair = Ed25519Keypair.fromSecretKey(secretKey);
    } else {
        const raw = PRIVATE_KEY.replace(/^0x/, '');
        keypair = Ed25519Keypair.fromSecretKey(fromHex(raw));
    }

    console.log(`Wallet: ${keypair.toSuiAddress()}`);

    const subscriber = new CetusPoolSubscriber(ENDPOINT, TOKEN, client, keypair);
    subscriber.subscribe();

    // Keep alive
    process.on('SIGINT', () => {
        console.log('\nExiting...');
        process.exit(0);
    });
}

if (require.main === module) {
    main().catch(console.error);
}
