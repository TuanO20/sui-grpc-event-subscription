import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as path from 'path';
import dotenv from 'dotenv';

dotenv.config();


// Quicknode endpoints consist of two crucial components: the endpoint name and the corresponding token
// For eg: QN Endpoint: https://docs-demo.sui-mainnet.quiknode.pro/abcde123456789
// endpoint will be: docs-demo.sui-mainnet.quiknode.pro:9000  {9000 is the port number for Sui gRPC}
// token will be : abcde123456789
const ENDPOINT: string = process.env.ENDPOINT || "";
const TOKEN: string = process.env.TOKEN || "";

// Configuration
const PROTO_PATH = path.join(__dirname, 'protos/sui/rpc/v2/subscription_service.proto');



// The Cetus Swap Event from Aggregator mode
const CETUS_SWAP_EVENT_TYPE = '0xeffc8ae61f439bb34c9b905ff8f29ec56873dcedf81c7123ff2f1f67c45ec302::cetus::CetusSwapEvent';

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
  //console.log(checkpoint.transactions);
  console.log("Number of txs in checkpoint: ", checkpoint.transactions.length);

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

      // Parse BCS data to extract pool address and token addresses
      let poolAddress = 'N/A';
      let tokenA = 'N/A';
      let tokenB = 'N/A';
      let atob: boolean = false;
      let amount_in: string = '';
      let amount_out: string = '';

      if (event.contents && event.contents.value) {
        try {
          const buffer = Buffer.from(event.contents.value);

          // Debug: Log the full buffer to understand the structure
          console.log(`[DEBUG] BCS Buffer length: ${buffer.length} bytes`);
          console.log(`[DEBUG] Full buffer (hex): ${buffer.toString('hex')}`);

          // Minimum buffer length check for fixed fields
          if (buffer.length >= 82) {
            // Bytes 0-32: pool (ID - 32 bytes)
            poolAddress = '0x' + buffer.subarray(0, 32).toString('hex');

            // Bytes 32-40: amount_in (u64 - 8 bytes)
            // Bytes 40-48: amount_out (u64 - 8 bytes)
            amount_in = buffer.readBigUInt64LE(32).toString();
            amount_out = buffer.readBigUInt64LE(40).toString();

            // Byte 48: a2b (bool - 1 byte)
            atob = buffer.readUInt8(48) === 1;

            // Bytes 49-82: by_amount_in (bool) + partner_id (ID) - skip these fields

            // Bytes 82+: coin_a (TypeName - variable length, BCS encoded string)
            // Bytes after coin_a: coin_b (TypeName - variable length, BCS encoded string)
            // TypeName in BCS: length (ULEB128) + UTF8 bytes
            let offset = 82;

            // Read coin_a TypeName
            const coinALength = buffer.readUInt8(offset);
            offset += 1;
            if (buffer.length >= offset + coinALength) {
              tokenA = buffer.subarray(offset, offset + coinALength).toString('utf8');
              offset += coinALength;

              // Read coin_b TypeName
              if (buffer.length > offset) {
                const coinBLength = buffer.readUInt8(offset);
                offset += 1;
                if (buffer.length >= offset + coinBLength) {
                  tokenB = buffer.subarray(offset, offset + coinBLength).toString('utf8');
                }
              }
            }
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
      console.log(`Token A:           ${tokenA}`);
      console.log(`Token B:           ${tokenB}`);
      console.log(`Swap A to B:       ${atob}`);
      console.log(`Amount in:         ${amount_in}`);
      console.log(`Amount out:        ${amount_out}`);
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
  // console.log(`\nUnique event types seen (${uniqueEventTypes.size}):`);
  // Array.from(uniqueEventTypes)
  //   .sort()
  //   .forEach((type) => {
  //     const isCetus = type.includes('pool::SwapEvent') || type.includes('cetus');
  //     console.log(`${isCetus ? '  👉 ' : '     '}${type}`);
  //   });
  call.cancel();
  process.exit(0);
});
