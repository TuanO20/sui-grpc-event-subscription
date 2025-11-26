import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import dotenv from 'dotenv';

dotenv.config();

const SUI_RPC_ENDPOINT: string = process.env.SUI_RPC_ENDPOINT || getFullnodeUrl('mainnet');

const client = new SuiClient({
    url: SUI_RPC_ENDPOINT
});

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
    const POOL_ID = '0xb8d7d9e66a60c239e7a60110efcf8de6c705580ed924d0dde141f4a0e2c90105'; // SUI-USDC Pool
    console.log(`Fetching version for pool: ${POOL_ID}`);
    const version = await getPoolInitialSharedVersion(POOL_ID);
    console.log(`Result: ${version}`);
}

main().catch(console.error);
