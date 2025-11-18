import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as path from 'path';
import dotenv from 'dotenv';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { fromBase64 } from '@mysten/sui/utils';

dotenv.config();

const ENDPOINT: string = process.env.ENDPOINT || "";
const TOKEN: string = process.env.TOKEN || "";

// Configuration
const PROTO_PATH = path.join(__dirname, 'protos/sui/rpc/v2/subscription_service.proto');
const TX_EXECUTION_PROTO_PATH = path.join(__dirname, 'protos/sui/rpc/v2beta2/transaction_execution_service.proto');

// The Cetus Swap Event from Aggregator mode
const CETUS_SWAP_EVENT_TYPE = '0xeffc8ae61f439bb34c9b905ff8f29ec56873dcedf81c7123ff2f1f67c45ec302::cetus::CetusSwapEvent';

// Threshold for copy trading (1000 SUI with 9 decimals)
const COPY_TRADE_THRESHOLD = BigInt(1000_000_000_000); // 1000 SUI

// SUI token type identifier
const SUI_TYPE = '0x2::sui::SUI';

// Your wallet keypair for signing transactions
// IMPORTANT: Load this securely from environment variables or secure storage
const PRIVATE_KEY = process.env.PRIVATE_KEY || ""; // Base64 encoded private key
const keypair = Ed25519Keypair.fromSecretKey(fromBase64(PRIVATE_KEY));

// Load subscription protobuf
const subscriptionPackageDef = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
  includeDirs: [path.join(__dirname, 'protos')],
});

// Load transaction execution protobuf
const txExecutionPackageDef = protoLoader.loadSync(TX_EXECUTION_PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
  includeDirs: [path.join(__dirname, 'protos')],
});

const subscriptionProto = grpc.loadPackageDefinition(subscriptionPackageDef) as any;
const txExecutionProto = grpc.loadPackageDefinition(txExecutionPackageDef) as any;

const SubscriptionService = subscriptionProto.sui.rpc.v2.SubscriptionService;
const TransactionExecutionService = txExecutionProto.sui.rpc.v2beta2.TransactionExecutionService;

// Create clients
const subscriptionClient = new SubscriptionService(ENDPOINT, grpc.credentials.createSsl());
const txExecutionClient = new TransactionExecutionService(ENDPOINT, grpc.credentials.createSsl());

const metadata = new grpc.Metadata();
metadata.add('x-token', TOKEN);

/**
 * ⭐ COPY TRADE LOGIC - This is where we build and execute the swap transaction
 */
async function executeCopyTrade(
  poolAddress: string,
  tokenA: string,
  tokenB: string,
  swapAtoB: boolean,
  detectedAmount: string,
  originalSender: string
) {
  console.log('\n🚀 ==================== EXECUTING COPY TRADE ====================');
  console.log(`Original Trader: ${originalSender}`);
  console.log(`Pool: ${poolAddress}`);
  console.log(`Swap Direction: ${swapAtoB ? 'A→B' : 'B→A'}`);
  console.log(`Detected Amount: ${detectedAmount}`);
  console.log(`Token A: ${tokenA}`);
  console.log(`Token B: ${tokenB}`);

  try {
    // Create a new transaction
    const tx = new Transaction();

    // ⭐ SET GAS BUDGET WITH TIP FEE FOR PRIORITY EXECUTION
    // Higher gas budget = higher priority in mempool
    const BASE_GAS_BUDGET = 10_000_000; // 0.01 SUI base gas
    const TIP_FEE = 50_000_000; // 0.05 SUI tip for priority (THIS IS THE TIP!)
    const TOTAL_GAS_BUDGET = BASE_GAS_BUDGET + TIP_FEE;

    tx.setGasBudget(TOTAL_GAS_BUDGET);

    console.log(`\n💰 Gas Budget Settings:`);
    console.log(`   Base Gas: ${BASE_GAS_BUDGET / 1_000_000_000} SUI`);
    console.log(`   ⭐ Tip Fee: ${TIP_FEE / 1_000_000_000} SUI (PRIORITY BOOST)`);
    console.log(`   Total: ${TOTAL_GAS_BUDGET / 1_000_000_000} SUI`);

    // TODO: Build your Cetus swap transaction here
    // This is a placeholder - you need to add the actual Cetus swap logic
    // Example structure:
    // tx.moveCall({
    //   target: `${CETUS_PACKAGE}::router::swap`,
    //   arguments: [
    //     tx.object(poolAddress),
    //     tx.pure(swapAmount),
    //     tx.pure(minAmountOut),
    //     // ... other Cetus-specific arguments
    //   ],
    //   typeArguments: [tokenA, tokenB],
    // });

    console.log('\n📝 Building transaction...');
    console.log('   TODO: Add Cetus swap moveCall here');

    // Build the transaction bytes
    const txBytes = await tx.build({ client: null }); // You need a SuiClient here

    // Sign the transaction
    const signature = await keypair.signTransaction(txBytes);

    console.log('\n✍️ Transaction signed');
    console.log(`   Signature: ${signature.signature.substring(0, 20)}...`);

    // ⭐ EXECUTE TRANSACTION VIA gRPC
    const executeRequest = {
      transaction: {
        bcs: txBytes, // BCS-serialized transaction bytes
      },
      signatures: [
        {
          scheme: 0, // ED25519
          signature: fromBase64(signature.signature),
          public_key: keypair.getPublicKey().toRawBytes(),
        },
      ],
      read_mask: {
        paths: ['transaction', 'finality', 'effects'],
      },
    };

    console.log('\n📤 Submitting transaction to network...');

    // Execute the transaction
    txExecutionClient.ExecuteTransaction(
      executeRequest,
      metadata,
      (err: grpc.ServiceError | null, response: any) => {
        if (err) {
          console.error('\n❌ Transaction execution failed!');
          console.error('Error:', err.message);
          console.error('Details:', err.details);
        } else {
          console.log('\n✅ TRANSACTION EXECUTED SUCCESSFULLY!');
          console.log('Response:', JSON.stringify(response, null, 2));
          console.log('\n🎉 Copy trade completed!');
        }
      }
    );
  } catch (error) {
    console.error('\n❌ Error in executeCopyTrade:', error);
  }
}

/**
 * Check if a swap involves SUI and meets the threshold
 */
function shouldCopyTrade(
  tokenA: string,
  tokenB: string,
  atob: boolean,
  amount_in: string,
  amount_out: string
): boolean {
  const amountInBigInt = BigInt(amount_in);
  const amountOutBigInt = BigInt(amount_out);

  // Check if either token is SUI
  const isSuiSwap = tokenA.includes(SUI_TYPE) || tokenB.includes(SUI_TYPE);

  if (!isSuiSwap) {
    return false;
  }

  // Determine which amount is SUI based on swap direction
  let suiAmount: bigint;

  if (tokenA.includes(SUI_TYPE) && atob) {
    // Swapping SUI (tokenA) → other token
    suiAmount = amountInBigInt;
  } else if (tokenB.includes(SUI_TYPE) && !atob) {
    // Swapping other token → SUI (tokenB)
    suiAmount = amountOutBigInt;
  } else if (tokenB.includes(SUI_TYPE) && atob) {
    // Swapping other token → SUI (tokenB)
    suiAmount = amountOutBigInt;
  } else if (tokenA.includes(SUI_TYPE) && !atob) {
    // Swapping SUI (tokenA) → other token
    suiAmount = amountInBigInt;
  } else {
    return false;
  }

  // Check if SUI amount exceeds threshold
  return suiAmount >= COPY_TRADE_THRESHOLD;
}

// ==================== EVENT MONITORING ====================

const subscriptionRequest = {
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

const call = subscriptionClient.SubscribeCheckpoints(subscriptionRequest, metadata);

let eventCount = 0;
let checkpointCount = 0;
let copyTradeCount = 0;

call.on('data', (response: any) => {
  checkpointCount++;

  const checkpoint = response.checkpoint;

  if (!checkpoint || !checkpoint.transactions || checkpoint.transactions.length === 0) {
    return;
  }

  console.log(`\n[Checkpoint ${checkpoint.sequence_number}] ${checkpoint.transactions.length} transactions`);

  // Process each transaction in the checkpoint
  for (const tx of checkpoint.transactions) {
    if (!tx.events || !tx.events.events) {
      continue;
    }

    // Filter for Cetus Swap Events
    const cetusSwapEvents = tx.events.events.filter(
      (event: any) => event.event_type === CETUS_SWAP_EVENT_TYPE
    );

    // Process each Cetus Swap Event
    for (const event of cetusSwapEvents) {
      eventCount++;

      let poolAddress = 'N/A';
      let tokenA = 'N/A';
      let tokenB = 'N/A';
      let atob: boolean = false;
      let amount_in: string = '';
      let amount_out: string = '';

      if (event.contents && event.contents.value) {
        try {
          const buffer = Buffer.from(event.contents.value);

          // Parse BCS data
          if (buffer.length >= 82) {
            poolAddress = '0x' + buffer.subarray(0, 32).toString('hex');
            amount_in = buffer.readBigUInt64LE(32).toString();
            amount_out = buffer.readBigUInt64LE(40).toString();
            atob = buffer.readUInt8(48) === 1;

            // Parse token types
            let offset = 82;
            const coinALength = buffer.readUInt8(offset);
            offset += 1;
            if (buffer.length >= offset + coinALength) {
              tokenA = buffer.subarray(offset, offset + coinALength).toString('utf8');
              offset += coinALength;

              if (buffer.length > offset) {
                const coinBLength = buffer.readUInt8(offset);
                offset += 1;
                if (buffer.length >= offset + coinBLength) {
                  tokenB = buffer.subarray(offset, offset + coinBLength).toString('utf8');
                }
              }
            }
          }

          console.log(`\n🔄 Swap Event #${eventCount}:`);
          console.log(`   Pool: ${poolAddress}`);
          console.log(`   ${tokenA} → ${tokenB}`);
          console.log(`   Amount In: ${amount_in}`);
          console.log(`   Amount Out: ${amount_out}`);

          // ⭐ CHECK IF WE SHOULD COPY TRADE THIS SWAP
          if (shouldCopyTrade(tokenA, tokenB, atob, amount_in, amount_out)) {
            copyTradeCount++;
            console.log('\n⚠️  🚨 LARGE SUI SWAP DETECTED! Triggering copy trade...');

            // Execute the copy trade
            executeCopyTrade(
              poolAddress,
              tokenA,
              tokenB,
              atob,
              amount_in,
              event.sender
            );
          }
        } catch (e) {
          console.error('Error parsing event:', e);
        }
      }
    }
  }
});

call.on('error', (error: any) => {
  console.error('Stream error:', error);
});

call.on('end', () => {
  console.log('\nStream ended');
  console.log(`Total Swaps Detected: ${eventCount}`);
  console.log(`Copy Trades Executed: ${copyTradeCount}`);
});

console.log('🔍 Monitoring Cetus Swap Events for Copy Trading...');
console.log(`📊 Threshold: ${Number(COPY_TRADE_THRESHOLD) / 1_000_000_000} SUI`);
console.log(`💰 Tip Fee: 0.05 SUI for priority execution`);
console.log('Press Ctrl+C to stop.\n');

process.on('SIGINT', () => {
  console.log(`\n\nClosing subscription...`);
  console.log(`\n=== FINAL STATISTICS ===`);
  console.log(`Checkpoints processed: ${checkpointCount}`);
  console.log(`Swap events detected: ${eventCount}`);
  console.log(`Copy trades executed: ${copyTradeCount}`);
  call.cancel();
  process.exit(0);
});
