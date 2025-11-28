import { SuiClient } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import dotenv from 'dotenv';
import { executeTurbosSwap } from './turbos/executeSwap';
import { fromHex } from '@mysten/sui/utils';

dotenv.config();

const SUI_RPC_ENDPOINT = process.env.SUI_RPC_ENDPOINT || '';
const PRIVATE_KEY = process.env.PRIVATE_KEY || '';


// Parameters verified from pool object 0x77f7...
// const poolId = '0x77f786e7bbd5f93f7dc09edbcffd9ea073945564767b65cf605f388328449d50';
// const globalConfig = '0xf1cf0e81048df168ebeb1b8030fad24b3e0b53ae827c25053fff0779c1445b6f';
// const poolInitialSharedVersion = 373475093;

// const tokenAAddress = '0x2::sui::SUI';
// const tokenBAddress = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
// const feeType = '0x91bfbc386a41afcfd9b2533058d7e915a1d3829089cc268ff4333d54d6339ca1::fee3000bps::FEE3000BPS';

// // Turbos Swap Router Function
// const dexSwapFunction = '0xa5a0c25c79e428eba04fb98b3fb2a34db45ab26d4c8faf0d7e39d66a63891e64::swap_router::swap_a_b';


const poolId = '0x5d7a6ee49eba2b546760d2da43e16535936a2d3f98daf54d358c2348c9d1b9ab';
const globalConfig = '0xf1cf0e81048df168ebeb1b8030fad24b3e0b53ae827c25053fff0779c1445b6f';
const poolInitialSharedVersion = 690260223;

const tokenAAddress = '0x8b449b4dc0f8c5f996734eaf23d36a5f6724e02e312a7e4af34bd0bb74de7b17::deagent_token::DEAGENT_TOKEN';
const tokenBAddress = '0x2::sui::SUI';
const feeType = '0xb924dd4ca619fdb3199f9e96129328da0bb7df1f57054dcc765debb360282726::fee20000bps::FEE20000BPS';

// Turbos Swap Router Function
const dexSwapFunction = '0xa5a0c25c79e428eba04fb98b3fb2a34db45ab26d4c8faf0d7e39d66a63891e64::swap_router::swap_a_b';

const client = new SuiClient({ url: SUI_RPC_ENDPOINT });



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

async function testSwap() {
    if (!PRIVATE_KEY) {
        throw new Error('PRIVATE_KEY is not set in .env');
    }

    // Handle potential private key format (bech32 or hex)
    const keypair = await getSenderKeyPair();
    const sender = keypair.toSuiAddress();

    // Get balance of token A
    const balance = await client.getBalance({
        owner: sender,
        coinType: tokenAAddress,
    });

    console.log('Balance:', balance.totalBalance);

    try {
        const a2b = true;
        // sqrtPriceLimit: The price limit for the swap.
        // If a2b (selling A), price goes down, so we set a MIN limit.
        // '4295128740' is the lowest valid sqrtPrice in Turbos (approx MinTick).
        // If b2a (buying A), price goes up, so we set a MAX limit.
        // '792266...' is the highest valid sqrtPrice.
        const sqrtPriceLimit = a2b ? '4295128740' : '79226673515401279992447579055';

        const result = await executeTurbosSwap({
            dexSwapFunction,
            globalConfig,
            poolId,
            poolInitialSharedVersion,
            tokenAAddress,
            tokenBAddress,
            feeType,
            a2b,
            amount: balance.totalBalance,                      // 0.1 SUI
            byAmountIn: true,
            sqrtPriceLimit,
            keypair,
            client,
            threshold: 0,
            recipient: sender,
            deadline: Date.now() + 180000           // Deadline in 3 minutes
        });
        console.log("Swap execution completed.");
    } catch (e) {
        console.error("Swap execution failed:", e);
    }
}

testSwap().catch(console.error);
