import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import dotenv from 'dotenv';

dotenv.config();


const SUI_RPC_ENDPOINT = process.env.SUI_RPC_ENDPOINT || "";



async function getPoolLiquidity(poolId: string) {
    const client = new SuiClient({ url: SUI_RPC_ENDPOINT });

    const poolObject = await client.getObject({
        id: poolId,
        options: { showContent: true }, // <--- Critical: fetch internal fields
    });

    const content = poolObject.data?.content as any;
    if (content && content.fields) {
        const coinA = content.fields.coin_a;
        const coinB = content.fields.coin_b;
        console.log(`Coin A Reserve: ${coinA}`);
        console.log(`Coin B Reserve: ${coinB}`);
    } else {
        console.log("Could not find pool content fields");
    }

}

getPoolLiquidity("0x2a98773f44d34c16c8c9213e56050fdfc04ee210d5b7b7b26b14555ff5643b7f");