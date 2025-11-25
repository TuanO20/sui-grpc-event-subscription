import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuiClient } from '@mysten/sui/client';
import { Transaction, Inputs } from '@mysten/sui/transactions';

export interface SwapParams {
    dexPackageId: string;
    globalConfig: string;
    poolId: string;
    poolInitialSharedVersion: string | number;
    tokenAAddress: string;
    tokenBAddress: string;
    a2b: boolean;
    amount: string | number | bigint;
    byAmountIn: boolean;
    sqrtPriceLimit: string | bigint;
    keypair: Ed25519Keypair;
    client: SuiClient;
    gasBudget?: number | string | bigint;
}

export async function executeSwap(params: SwapParams) {
    const {
        dexPackageId,
        globalConfig,
        poolId,
        poolInitialSharedVersion,
        tokenAAddress,
        tokenBAddress,
        a2b,
        amount,
        byAmountIn,
        sqrtPriceLimit,
        keypair,
        client,
        gasBudget = 100000000
    } = params;

    const sender = keypair.toSuiAddress();
    console.log('Sender:', sender);

    // 1. Build transaction
    const tx = new Transaction();
    tx.setSender(sender);

    // Create a zero coin for the output placeholder (Coin A if a2b is false, meaning we are swapping B -> A)
    // Actually, the zero coin logic in the original script was:
    // const zeroCoin = tx.moveCall({ target: '0x2::coin::zero', typeArguments: [USDC_TYPE] });
    // where USDC_TYPE was Coin A.
    // So we need a zero coin of type Token A.

    const zeroCoin = tx.moveCall({
        target: '0x2::coin::zero',
        typeArguments: [tokenAAddress],
    });

    const [swapCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(amount)]);

    const gasPrice = await client.getReferenceGasPrice();

    // Set gas price is double the reference one -> More priority
    tx.setGasPrice(gasPrice * 2n);
    tx.setGasBudget(gasBudget);

    const result = tx.moveCall({
        target: `${dexPackageId}::router::swap`,
        typeArguments: [
            tokenAAddress,                          // T0 (Coin A)
            tokenBAddress                           // T1 (Coin B)
        ],
        arguments: [
            tx.object(globalConfig),           // arg0: GlobalConfig
            tx.object(Inputs.SharedObjectRef({
                objectId: poolId,
                initialSharedVersion: Number(poolInitialSharedVersion),
                mutable: true,
            })),                                // arg1: Pool
            zeroCoin,                           // arg2: Coin<T0> (Zero)
            swapCoin,                           // arg3: Coin<T1> (Input)
            tx.pure.bool(a2b),                  // arg4: a2b
            tx.pure.bool(byAmountIn),           // arg5: by_amount_in
            tx.pure.u64(amount),                // arg6: amount
            tx.pure.u128(sqrtPriceLimit),       // arg7: sqrt_price_limit
            tx.pure.bool(false),                // arg8: swap_all
            tx.object.clock()                   // arg9: Clock
        ],
    });

    // Transfer the returned coins back to sender
    tx.transferObjects([result[0], result[1]], tx.pure.address(sender));

    // 2. Build & Sign & Execute (All in one via JSON-RPC)
    console.log('Executing transaction via JSON-RPC...');

    try {
        const result = await client.signAndExecuteTransaction({
            signer: keypair,
            transaction: tx,
            options: {
                showEffects: true,
                showEvents: true,
                showObjectChanges: true,
                showBalanceChanges: true
            },
        });

        if (result.effects?.status?.status === 'success') {
            console.log('✅ Transaction executed successfully!');
            console.log('Digest:', result.digest);
            console.log('Status:', result.effects?.status?.status);
            return result;
        } else {
            console.log('❌ Transaction execution failed!');
            console.log('Status:', result.effects?.status?.status);
            throw new Error(`Transaction failed with status: ${result.effects?.status?.status}`);
        }
    } catch (error: any) {
        console.error('❌ Failed to execute transaction:', error);
        throw error;
    }
}
