import { executeSwap, SwapParams } from './executeTx';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { fromHex } from '@mysten/sui/utils';
import dotenv from 'dotenv';

dotenv.config();

const SUI_GRPC_ENDPOINT: string = process.env.SUI_GRPC_ENDPOINT || "";
const PRIVATE_KEY: string = process.env.PRIVATE_KEY || "";
const SUI_RPC_ENDPOINT: string = getFullnodeUrl('mainnet');

const CETUS_PACKAGE_ID: string = "0xfbb32ac0fa89a3cb0c56c745b688c6d2a53ac8e43447119ad822763997ffb9c3";
const GLOBAL_CONFIG = '0xdaa46292632c3c4d8f31f23ea0f9b36a28ff3677e9684980e4438403a67a3d8f';
const POOL_ID: string = '0xb8d7d9e66a60c239e7a60110efcf8de6c705580ed924d0dde141f4a0e2c90105'; // SUI-USDC Pool
const POOL_INITIAL_SHARED_VERSION = '373623018'; // Pool's initial shared version
const USDC_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
const SUI_TYPE = '0x2::sui::SUI';

// Initialize standard JSON-RPC client
const client = new SuiClient({
    // url: SUI_RPC_ENDPOINT
    url: SUI_GRPC_ENDPOINT
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

async function main() {
    const keypair = await getSenderKeyPair();

    const params: SwapParams = {
        dexPackageId: CETUS_PACKAGE_ID,
        globalConfig: GLOBAL_CONFIG,
        poolId: POOL_ID,
        poolInitialSharedVersion: POOL_INITIAL_SHARED_VERSION,
        tokenAAddress: USDC_TYPE,
        tokenBAddress: SUI_TYPE,
        a2b: false, // SUI (B) -> USDC (A)
        amount: 100000000,
        byAmountIn: true,
        sqrtPriceLimit: '79226673515401279992447579055',
        keypair: keypair,
        client: client,
        gasBudget: 100000000
    };

    console.log("Starting swap test...");
    try {
        await executeSwap(params);
        console.log("Swap test completed successfully.");
    } catch (e) {
        console.error("Swap test failed:", e);
    }
}

main().catch(console.error);
