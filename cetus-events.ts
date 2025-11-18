import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as path from 'path';
import dotenv from 'dotenv';

dotenv.config();


// Quicknode endpoints consist of two crucial components: the endpoint name and the corresponding token
// For eg: QN Endpoint: https://docs-demo.sui-mainnet.quiknode.pro/abcde123456789
// endpoint will be: docs-demo.sui-mainnet.quiknode.pro:9000  {9000 is the port number for Sui gRPC}
// token will be : abcde123456789
const ENDPOINT : string = process.env.ENDPOINT || "";
const TOKEN : string = process.env.TOKEN || "";

// Configuration
const PROTO_PATH = path.join(__dirname, 'protos/sui/rpc/v2/subscription_service.proto');



// The Cetus Swap Event type we want to filter for
const CETUS_SWAP_EVENT_TYPE = '0x1eabed72c53feb3805120a081dc15963c204dc8d091542592abaf7a35689b2fb::pool::SwapEvent';

// Load protobuf definitions
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

// Create secure client
const client = new SubscriptionService(ENDPOINT, grpc.credentials.createSsl());

// Add token metadata
const metadata = new grpc.Metadata();
metadata.add('x-token', TOKEN);

// Request payload - we need to request transactions and their events
// Note: Paths are relative to Checkpoint message (nested inside response)
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

const call = client.SubscribeCheckpoints(request, metadata);

let eventCount = 0;
let checkpointCount = 0;
let transactionCount = 0;
let totalEventsCount = 0;
const uniqueEventTypes = new Set<string>();

call.on('data', (response: any) => {
  checkpointCount++;
  const checkpoint = response.checkpoint;

  if (!checkpoint) {
    console.log(`[DEBUG] Checkpoint ${checkpointCount}: No checkpoint data`);
    return;
  }

  if (!checkpoint.transactions || checkpoint.transactions.length === 0) {
    console.log(`[DEBUG] Checkpoint ${checkpoint.sequence_number}: No transactions`);
    return;
  }

  // Process each transaction in the checkpoint
  for (const tx of checkpoint.transactions) {
    transactionCount++;

    if (!tx.events || !tx.events.events) {
      continue;
    }

    // Log all event types we see
    for (const event of tx.events.events) {
      totalEventsCount++;
      if (event.event_type) {
        uniqueEventTypes.add(event.event_type);
      }
    }

    // Filter for Cetus Swap Events
    const cetusSwapEvents = tx.events.events.filter(
      (event: any) => event.event_type === CETUS_SWAP_EVENT_TYPE
    );

    // Display each Cetus Swap Event
    for (const event of cetusSwapEvents) {
      eventCount++;

      // Parse BCS data to extract pool address
      let poolAddress = 'N/A';

      if (event.contents && event.contents.value) {
        try {
          const buffer = Buffer.from(event.contents.value);

          // Extract pool address (first 32 bytes after the initial byte)
          if (buffer.length >= 33) {
            poolAddress = '0x' + buffer.subarray(1, 33).toString('hex');
          }
        } catch (e) {
          console.error('Error parsing BCS:', e);
        }
      }

      console.log('\n' + '='.repeat(80));
      console.log(`🔄 CETUS SWAP EVENT #${eventCount}`);
      console.log('='.repeat(80));
      console.log(`Checkpoint:        ${checkpoint.sequence_number}`);
      const timestamp = checkpoint.summary?.timestamp_ms || checkpoint.timestamp_ms;
      if (timestamp) {
        console.log(`Timestamp:         ${new Date(parseInt(timestamp)).toISOString()}`);
      }
      console.log(`Transaction ID:    ${tx.digest}`);
      console.log(`Sender:            ${event.sender}`);
      console.log(`Event Type:        ${event.event_type}`);
      console.log(`Pool Address:      ${poolAddress}`);
      console.log('='.repeat(80));
    }
  }

  // Print periodic stats
  if (checkpointCount % 10 === 0) {
    console.log(`\n[STATS] Checkpoints: ${checkpointCount} | Transactions: ${transactionCount} | Total Events: ${totalEventsCount} | Cetus Swaps: ${eventCount}`);
    console.log(`[STATS] Unique event types seen: ${uniqueEventTypes.size}`);
  }
});

call.on('error', (error: any) => {
  console.error('Stream error:', error);
});

call.on('end', () => {
  console.log('\nStream ended');
  console.log(`Total Cetus Swap Events received: ${eventCount}`);
});

console.log('🔍 Subscribing to Cetus Swap Events...');
console.log(`Event Type: ${CETUS_SWAP_EVENT_TYPE}`);
console.log('Press Ctrl+C to stop.\n');

process.on('SIGINT', () => {
  console.log(`\n\nClosing subscription...`);
  console.log(`\n=== FINAL STATISTICS ===`);
  console.log(`Checkpoints processed: ${checkpointCount}`);
  console.log(`Transactions processed: ${transactionCount}`);
  console.log(`Total events seen: ${totalEventsCount}`);
  console.log(`Cetus Swap Events found: ${eventCount}`);
  console.log(`\nUnique event types seen (${uniqueEventTypes.size}):`);
  Array.from(uniqueEventTypes)
    .sort()
    .forEach((type) => {
      const isCetus = type.includes('pool::SwapEvent') || type.includes('cetus');
      console.log(`${isCetus ? '  👉 ' : '     '}${type}`);
    });
  call.cancel();
  process.exit(0);
});
