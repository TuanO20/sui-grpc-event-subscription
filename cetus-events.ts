import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as path from 'path';
import dotenv from 'dotenv';

dotenv.config();

// Configuration
const PROTO_PATH = path.join(__dirname, 'protos/sui/rpc/v2/subscription_service.proto');
const CETUS_SWAP_EVENT_TYPE = '0xeffc8ae61f439bb34c9b905ff8f29ec56873dcedf81c7123ff2f1f67c45ec302::cetus::CetusSwapEvent';
const SUI_TYPE = '0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
const MIN_SUI_AMOUNT = BigInt(10) * BigInt(1_000_000_000); // 50 SUI

export interface CetusSwapEvent {
  checkpoint: string;
  transactionDigest: string;
  poolAddress: string;
  tokenA: string;
  tokenB: string;
  atob: boolean;
  amountIn: string;
  amountOut: string;
  timestamp?: string;
  sender: string;
}

export class CetusEventSubscriber {
  private client: any;
  private endpoint: string;
  private token: string;
  private stream: any;

  constructor(endpoint: string, token: string) {
    this.endpoint = endpoint;
    this.token = token;
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

  public subscribe(callback: (event: CetusSwapEvent) => void) {
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

    console.log('🔍 Subscribing to Cetus Swap Events...');
    console.log(`Event Type: ${CETUS_SWAP_EVENT_TYPE}`);

    this.stream = this.client.SubscribeCheckpoints(request, metadata);

    let eventCount = 0;
    let checkpointCount = 0;
    let transactionCount = 0;
    let totalEventsCount = 0;
    const uniqueEventTypes = new Set<string>();

    this.stream.on('data', (response: any) => {
      checkpointCount++;
      const checkpoint = response.checkpoint;

      if (!checkpoint || !checkpoint.transactions || checkpoint.transactions.length === 0) {
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

        for (const event of cetusSwapEvents) {
          const parsedEvent = this.parseEvent(event, checkpoint, tx);
          if (parsedEvent) {
            eventCount++;
            callback(parsedEvent);
          }
        }
      }

      if (checkpointCount % 10 === 0) {
        console.log(`\n[STATS] Checkpoints: ${checkpointCount} | Transactions: ${transactionCount} | Total Events: ${totalEventsCount} | Cetus Swaps: ${eventCount}`);
      }
    });

    this.stream.on('error', (error: any) => {
      console.error('Stream error:', error);
    });

    this.stream.on('end', () => {
      console.log('\nStream ended');
    });
  }

  public unsubscribe() {
    if (this.stream) {
      this.stream.cancel();
    }
  }

  private parseEvent(event: any, checkpoint: any, tx: any): CetusSwapEvent | null {
    let poolAddress = 'N/A';
    let tokenA = 'N/A';
    let tokenB = 'N/A';
    let atob: boolean = false;
    let amount_in: string = '';
    let amount_out: string = '';

    if (event.contents && event.contents.value) {
      try {
        const buffer = Buffer.from(event.contents.value);
        if (buffer.length >= 82) {
          poolAddress = '0x' + buffer.subarray(0, 32).toString('hex');
          amount_in = buffer.readBigUInt64LE(32).toString();
          amount_out = buffer.readBigUInt64LE(40).toString();
          atob = buffer.readUInt8(48) === 1;

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
      } catch (e) {
        console.error('Error parsing BCS:', e);
        return null;
      }
    }

    // Filter: Only show SUI -> Token swaps with Amount > 50 SUI
    let isSuiToToken = false;
    let suiAmount = BigInt(0);

    if (atob) {
      if (tokenA === SUI_TYPE) {
        isSuiToToken = true;
        suiAmount = BigInt(amount_in);
      }
    } else {
      if (tokenB === SUI_TYPE) {
        isSuiToToken = true;
        suiAmount = BigInt(amount_in);
      }
    }

    if (!isSuiToToken || suiAmount <= MIN_SUI_AMOUNT) {
      return null;
    }

    return {
      checkpoint: checkpoint.sequence_number,
      transactionDigest: tx.digest,
      poolAddress,
      tokenA,
      tokenB,
      atob,
      amountIn: amount_in,
      amountOut: amount_out,
      timestamp: checkpoint.summary?.timestamp_ms || checkpoint.timestamp_ms,
      sender: event.sender
    };
  }
}

// Main execution block
if (require.main === module) {
  const ENDPOINT: string = process.env.ENDPOINT || "";
  const TOKEN: string = process.env.TOKEN || "";

  if (!ENDPOINT || !TOKEN) {
    console.error("Missing ENDPOINT or TOKEN in environment variables");
    process.exit(1);
  }

  const subscriber = new CetusEventSubscriber(ENDPOINT, TOKEN);

  subscriber.subscribe((event) => {
    console.log('\n' + '='.repeat(80));
    console.log(`🔄 CETUS SWAP EVENT`);
    console.log('='.repeat(80));
    console.log(`Checkpoint:        ${event.checkpoint}`);
    if (event.timestamp) {
      console.log(`Timestamp:         ${new Date(parseInt(event.timestamp)).toISOString()}`);
    }
    console.log(`Transaction ID:    ${event.transactionDigest}`);
    console.log(`Sender:            ${event.sender}`);
    console.log(`Pool Address:      ${event.poolAddress}`);
    console.log(`Token A:           ${event.tokenA}`);
    console.log(`Token B:           ${event.tokenB}`);
    console.log(`Swap A to B:       ${event.atob}`);
    console.log(`Amount in:         ${event.amountIn}`);
    console.log(`Amount out:        ${event.amountOut}`);
    console.log('='.repeat(80));
  });

  process.on('SIGINT', () => {
    console.log(`\n\nClosing subscription...`);
    subscriber.unsubscribe();
    process.exit(0);
  });
}
