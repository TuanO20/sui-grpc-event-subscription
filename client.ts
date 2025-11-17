import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as path from 'path';

// Configuration
const PROTO_PATH = path.join(__dirname, 'protos/sui/rpc/v2/subscription_service.proto');

// Quicknode endpoints consist of two crucial components: the endpoint name and the corresponding token
// For eg: QN Endpoint: https://docs-demo.sui-mainnet.quiknode.pro/abcde123456789
// endpoint will be: docs-demo.sui-mainnet.quiknode.pro:9000  {9000 is the port number for Sui gRPC}
// token will be : abcde123456789

const endpoint = 'attentive-maximum-sheet.sui-mainnet.quiknode.pro:9000';
const token = '72f3205ea10d3926696fd015911fcdeb21812312';

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
const client = new SubscriptionService(endpoint, grpc.credentials.createSsl());

// Add token metadata
const metadata = new grpc.Metadata();
metadata.add('x-token', token);

// Request payload
const request = {
  read_mask: {
    paths: [
      'sequence_number',
      'digest',
      'network_total_transactions',
      'previous_digest',
      'epoch_rolling_gas_cost_summary',
      'timestamp_ms',
      'transactions',
    ],
  },
};

const call = client.SubscribeCheckpoints(request, metadata);

call.on('data', (response: any) => {
  console.log('Received checkpoint:', JSON.stringify(response, null, 2));
});

call.on('error', (error: any) => {
  console.error('Stream error:', error);
});

call.on('end', () => {
  console.log('Stream ended');
});

console.log('Subscribing to checkpoints... Press Ctrl+C to stop.');
process.on('SIGINT', () => {
  console.log('Closing subscription...');
  call.cancel();
  process.exit(0);
});
