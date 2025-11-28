import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuiClient } from '@mysten/sui/client';
import { Transaction, Inputs } from '@mysten/sui/transactions';

export interface SwapParams {
    dexSwapFunction: string;
    globalConfig: string;
    poolId: string;
    poolInitialSharedVersion: string | number;
    tokenAAddress: string;
    tokenBAddress: string;
    feeType: string;
    a2b: boolean;
    amount: string | number | bigint;
    byAmountIn: boolean;
    sqrtPriceLimit: string | bigint;
    keypair: Ed25519Keypair;
    client: SuiClient;
    gasBudget?: number | string | bigint;
    threshold?: string | number | bigint;
    recipient?: string;
    deadline?: number;
}

export async function executeTurbosSwap(params: SwapParams) {
    const {
        dexSwapFunction,
        globalConfig,
        poolId,
        poolInitialSharedVersion,
        tokenAAddress,
        tokenBAddress,
        feeType,
        a2b,
        amount,
        byAmountIn,
        sqrtPriceLimit,
        keypair,
        client,
        gasBudget = 100000000,
        threshold = 0,
        recipient,
        deadline
    } = params;

    const sender = keypair.toSuiAddress();
    console.log('Sender:', sender);

    // 1. Build transaction
    const tx = new Transaction();
    tx.setSender(sender);

    // Determine input token type
    const inputTokenType = a2b ? tokenAAddress : tokenBAddress;
    const isSui = inputTokenType.includes('::sui::SUI');

    let swapCoin;
    if (isSui) {
        [swapCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(amount)]);
    } else {
        // Fetch coins of the input type
        const coins = await client.getCoins({
            owner: sender,
            coinType: inputTokenType,
        });

        if (coins.data.length === 0) {
            throw new Error(`No coins found for type ${inputTokenType}`);
        }

        // For simplicity, take the first coin. In production, you'd merge.
        // If the first coin has enough balance, split it.
        // If not, we'd need to merge. For this test, assuming the first coin (or merged) is enough.
        // To be safe, let's merge all coins first if there are multiple.

        let primaryCoin;
        if (coins.data.length > 1) {
            tx.mergeCoins(tx.object(coins.data[0].coinObjectId), coins.data.slice(1).map(c => tx.object(c.coinObjectId)));
            primaryCoin = tx.object(coins.data[0].coinObjectId);
        } else {
            primaryCoin = tx.object(coins.data[0].coinObjectId);
        }

        [swapCoin] = tx.splitCoins(primaryCoin, [tx.pure.u64(amount)]);
    }

    const gasPrice = await client.getReferenceGasPrice();

    // Set gas price is at least x5 the reference one -> To be more priority
    tx.setGasPrice(gasPrice * 5n);
    tx.setGasBudget(gasBudget);

    // Determine function name and handle a2b logic
    const targetFunction = a2b
        ? dexSwapFunction
        : dexSwapFunction.replace('swap_a_b', 'swap_b_a');

    console.log(`Swapping ${a2b ? 'A -> B' : 'B -> A'} using function: ${targetFunction}`);

    const result = tx.moveCall({
        target: `${targetFunction}`,
        typeArguments: [
            tokenAAddress,                          // T0 (Coin A)
            tokenBAddress,                          // T1 (Coin B)
            feeType                                 // T2 (Fee Tier)
        ],
        arguments: [
            tx.object(Inputs.SharedObjectRef({
                objectId: poolId,
                initialSharedVersion: Number(poolInitialSharedVersion),
                mutable: true,
            })),                                // arg0: Pool
            tx.makeMoveVec({ elements: [swapCoin] }), // arg1: vector<Coin<T0>> or vector<Coin<T1>>
            tx.pure.u64(amount),                // arg2: amount_specified
            tx.pure.u64(threshold),             // arg3: amount_threshold
            tx.pure.u128(sqrtPriceLimit),       // arg4: sqrt_price_limit
            tx.pure.bool(byAmountIn),           // arg5: is_exact_in
            tx.pure.address(recipient || sender), // arg6: recipient
            tx.pure.u64(deadline || Date.now() + 60000), // arg7: deadline
            tx.object.clock(),                  // arg8: Clock
            tx.object(globalConfig)             // arg9: Versioned
        ],
    });

    // 2. Build & Sign & Execute (All in one via JSON-RPC)
    console.log('Executing transaction via JSON-RPC...');

    try {
        // Dry run to check for errors
        console.log('Dry running transaction...');
        const dryRunResult = await client.devInspectTransactionBlock({
            sender: sender,
            transactionBlock: tx,
        });

        if (dryRunResult.effects.status.status === 'failure') {
            console.error('❌ Dry run failed:', JSON.stringify(dryRunResult.effects.status, null, 2));
            console.error('Dry run error:', dryRunResult.error);
            throw new Error(`Dry run failed: ${dryRunResult.effects.status.error}`);
        }
        console.log('✅ Dry run successful!');

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
            console.log('Status:', JSON.stringify(result.effects?.status, null, 2));
            console.log('Effects:', JSON.stringify(result.effects, null, 2));
            throw new Error(`Transaction failed with status: ${result.effects?.status?.status}`);
        }
    } catch (error: any) {
        console.error('❌ Failed to execute transaction:', error);
        throw error;
    }
}
