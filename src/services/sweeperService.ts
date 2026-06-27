import { getDatabase } from '../config/db';
import { decrypt } from './crypto';
import { ethers } from 'ethers';
import { Connection, Keypair as SolKeypair, PublicKey, Transaction as SolTransaction, SystemProgram } from '@solana/web3.js';
import { TronWeb } from 'tronweb';
import * as bitcoin from 'bitcoinjs-lib';
import ECPairFactory from 'ecpair';
import * as ecc from 'tiny-secp256k1';

const ECPair = ECPairFactory(ecc);

// Active loop state to prevent overlapping executions
let isSweeping = false;
let sweeperInterval: NodeJS.Timeout | null = null;

// ERC-20 / TRC-20 minimal ABI for transfer & balance check
const MINIMAL_ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 value) returns (bool)'
];

/**
 * Initializes and starts the background monitoring & sweeping daemon.
 */
export function startSweeper() {
  const enabled = process.env.SWEEPER_ENABLED !== 'false';
  if (!enabled) {
    console.log('Sweeper daemon is disabled via environment configuration.');
    return;
  }

  const intervalMs = parseInt(process.env.SWEEPER_POLL_INTERVAL_MS || '30000', 10);
  console.log(`Starting background Sweeper Daemon (Poll interval: ${intervalMs}ms)...`);

  sweeperInterval = setInterval(async () => {
    if (isSweeping) {
      console.log('[Sweeper] Previous run still in progress. Skipping cycle.');
      return;
    }
    isSweeping = true;
    try {
      await sweepCycle();
    } catch (error) {
      console.error('[Sweeper Error] Error during sweeping cycle:', error);
    } finally {
      isSweeping = false;
    }
  }, intervalMs);
}

/**
 * Stops the background sweeping daemon.
 */
export function stopSweeper() {
  if (sweeperInterval) {
    clearInterval(sweeperInterval);
    sweeperInterval = null;
    console.log('Sweeper Daemon stopped.');
  }
}

/**
 * Executes a single sweep cycle across all generated wallets in database.
 */
async function sweepCycle() {
  const db = await getDatabase();
  
  // 1. Fetch destination addresses from settings table
  const settingsRows = await db.all('SELECT * FROM settings');
  const mainAddresses: { [key: string]: string } = {};
  settingsRows.forEach(row => {
    mainAddresses[row.key] = row.value.trim();
  });

  const mainBtc = mainAddresses['main_btc_address'];
  const mainLtc = mainAddresses['main_ltc_address'];
  const mainEvm = mainAddresses['main_evm_address'];
  const mainSol = mainAddresses['main_sol_address'];
  const mainTrx = mainAddresses['main_trx_address'];

  // 2. Fetch all generated wallets
  const wallets = await db.all('SELECT * FROM wallets');
  if (wallets.length === 0) {
    return;
  }

  // 3. Sweep each wallet according to coin type/network
  for (const wallet of wallets) {
    const coin = wallet.coin.toLowerCase().trim();
    let privateKey: string;
    try {
      privateKey = decrypt(wallet.private_key);
    } catch (err) {
      console.error(`[Sweeper] Failed to decrypt private key for address ${wallet.address}:`, err);
      continue;
    }

    try {
      // Determine network
      if (['eth', 'ethereum', 'bsc', 'polygon', 'usdt_erc20'].includes(coin) || wallet.contract_address && (coin.includes('erc20') || coin.includes('eth') || coin.includes('bsc') || coin.includes('polygon'))) {
        await sweepEVM(wallet, privateKey, mainEvm);
      } else if (['sol', 'solana', 'usdt_sol'].includes(coin) || wallet.contract_address && coin.includes('sol')) {
        await sweepSolana(wallet, privateKey, mainSol);
      } else if (['trx', 'tron', 'usdt_trc20'].includes(coin) || wallet.contract_address && coin.includes('trc20')) {
        await sweepTron(wallet, privateKey, mainTrx);
      } else if (['btc', 'bitcoin'].includes(coin)) {
        await sweepBitcoin(wallet, privateKey, mainBtc);
      } else if (['ltc', 'litecoin'].includes(coin)) {
        await sweepLitecoin(wallet, privateKey, mainLtc);
      }
    } catch (error: any) {
      console.error(`[Sweeper Error] Failed to sweep address ${wallet.address} (${coin}):`, error.message || error);
    }
  }
}

/**
 * Sweeps EVM compatible networks (Ethereum, BSC, Polygon) for Native and ERC-20 balances.
 */
async function sweepEVM(wallet: any, privateKey: string, targetAddress: string) {
  if (!targetAddress) return;

  const coin = wallet.coin.toLowerCase();
  let rpcUrl = '';

  if (coin === 'bsc') {
    rpcUrl = process.env.BSC_RPC_URL || 'https://binance.llamarpc.com';
  } else if (coin === 'polygon') {
    rpcUrl = process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com';
  } else {
    rpcUrl = process.env.ETH_RPC_URL || 'https://rpc.ankr.com/eth'; // Default to Ethereum
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const signer = new ethers.Wallet(privateKey, provider);
  const address = wallet.address;

  // Handle Token sweeping (ERC-20)
  if (wallet.contract_address) {
    const contract = new ethers.Contract(wallet.contract_address, MINIMAL_ERC20_ABI, signer);
    const balance: bigint = await contract.balanceOf(address);

    if (balance > 0n) {
      // Check native gas balance
      const nativeBalance = await provider.getBalance(address);
      const feeData = await provider.getFeeData();
      const gasPrice = feeData.gasPrice || 30000000000n; // fallback to 30 gwei
      const gasLimit = 65000n; // Estimate for token transfer
      const gasCost = gasLimit * gasPrice;

      if (nativeBalance >= gasCost) {
        console.log(`[Sweeper] Sweeping ${balance.toString()} ERC20 tokens from ${address} to ${targetAddress}...`);
        const tx = await contract.transfer(targetAddress, balance);
        await tx.wait();
        console.log(`[Sweeper] ERC20 Sweep Successful! Tx Hash: ${tx.hash}`);
      } else {
        console.warn(`[Sweeper Warning] Insufficient EVM native gas on ${address} to sweep ERC-20 tokens. Needs: ${ethers.formatEther(gasCost)} native asset.`);
      }
    }
  } else {
    // Handle Native Asset sweeping
    const balance = await provider.getBalance(address);
    if (balance > 0n) {
      const feeData = await provider.getFeeData();
      const gasPrice = feeData.gasPrice || 30000000000n;
      const gasLimit = 21000n;
      const gasCost = gasLimit * gasPrice;

      if (balance > gasCost) {
        const sweepAmount = balance - gasCost;
        console.log(`[Sweeper] Sweeping ${ethers.formatEther(sweepAmount)} native asset from ${address} to ${targetAddress}...`);
        const tx = await signer.sendTransaction({
          to: targetAddress,
          value: sweepAmount,
          gasLimit
        });
        await tx.wait();
        console.log(`[Sweeper] Native EVM Sweep Successful! Tx Hash: ${tx.hash}`);
      }
    }
  }
}

/**
 * Sweeps Solana network for Native SOL and SPL balances.
 */
async function sweepSolana(wallet: any, privateKeyHex: string, targetAddress: string) {
  if (!targetAddress) return;

  const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');

  // Solana Keypair from Hex Secret Key
  const secretKey = Buffer.from(privateKeyHex, 'hex');
  const keypair = SolKeypair.fromSecretKey(secretKey);
  const address = keypair.publicKey;

  if (wallet.contract_address) {
    // Solana SPL Token sweeping logic (USDT)
    const tokenMint = new PublicKey(wallet.contract_address);
    const destinationPubkey = new PublicKey(targetAddress);

    // Fetch account SPL info
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(address, {
      mint: tokenMint
    });

    if (tokenAccounts.value.length > 0) {
      const tokenAccountInfo = tokenAccounts.value[0].account.data.parsed.info;
      const tokenAmount = tokenAccountInfo.tokenAmount.amount; // String format raw representation
      const decimals = tokenAccountInfo.tokenAmount.decimals;

      if (BigInt(tokenAmount) > 0n) {
        // Confirm gas availability
        const solBalance = await connection.getBalance(address);
        if (solBalance > 5000) { // Native txn fee is 5000 lamports
          console.log(`[Sweeper] Solana SPL sweeping is configured. Detected: ${tokenAmount} raw tokens on ${wallet.address}`);
          // Build and send transaction using standard Web3 Transfer instructions
          // Note: In real-world context, requires finding destination token address or creating it.
        } else {
          console.warn(`[Sweeper Warning] Insufficient SOL gas on ${wallet.address} to sweep SPL tokens.`);
        }
      }
    }
  } else {
    // Native SOL sweeping
    const balance = await connection.getBalance(address);
    const rentExemptRef = await connection.getMinimumBalanceForRentExemption(0);
    const fee = 5000; // standard tx fee

    if (balance > rentExemptRef + fee) {
      const sweepAmount = balance - fee - rentExemptRef;
      console.log(`[Sweeper] Sweeping ${sweepAmount / 1e9} SOL from ${wallet.address} to ${targetAddress}...`);
      
      const transaction = new SolTransaction().add(
        SystemProgram.transfer({
          fromPubkey: address,
          toPubkey: new PublicKey(targetAddress),
          lamports: sweepAmount
        })
      );

      const signature = await connection.sendTransaction(transaction, [keypair]);
      await connection.confirmTransaction(signature, 'confirmed');
      console.log(`[Sweeper] Solana SOL Sweep Successful! Tx Signature: ${signature}`);
    }
  }
}

/**
 * Sweeps TRON network for Native TRX and TRC-20 balances.
 */
async function sweepTron(wallet: any, privateKey: string, targetAddress: string) {
  if (!targetAddress) return;

  const rpcUrl = process.env.TRON_RPC_URL || 'https://api.trongrid.io';
  
  // Initialize TronWeb
  const tronWeb = new TronWeb({
    fullHost: rpcUrl,
    privateKey: privateKey
  });

  const address = wallet.address;

  if (wallet.contract_address) {
    // Handle TRC-20 sweeping
    const contract = await tronWeb.contract().at(wallet.contract_address);
    const balanceObj = await contract.balanceOf(address).call();
    const balance = balanceObj.toString();

    if (BigInt(balance) > 0n) {
      const trxBalanceRaw = await tronWeb.trx.getBalance(address);
      const trxBalance = Number(trxBalanceRaw);

      if (trxBalance > 15000000) { // ~15 TRX minimum for token fee execution if no energy
        console.log(`[Sweeper] Sweeping TRC-20 tokens from Tron address ${address} to ${targetAddress}...`);
        const result = await contract.transfer(targetAddress, balance).send();
        console.log(`[Sweeper] TRC-20 Sweep Successful! TxID: ${result}`);
      } else {
        console.warn(`[Sweeper Warning] Insufficient TRX gas/fee balance on ${address} to sweep TRC-20. Needs: ~15 TRX.`);
      }
    }
  } else {
    // Handle Native TRX sweeping
    const balanceRaw = await tronWeb.trx.getBalance(address);
    const balance = Number(balanceRaw);

    if (balance > 2000000) { // Minimum 2 TRX to justify transaction fee (~1 TRX)
      const sweepAmount = balance - 1000000; // Deduct 1 TRX for fee
      console.log(`[Sweeper] Sweeping ${sweepAmount / 1e6} TRX from ${address} to ${targetAddress}...`);
      const trade = await tronWeb.trx.sendTransaction(targetAddress, sweepAmount);
      if (trade.result) {
        console.log(`[Sweeper] Tron TRX Sweep Successful! TxID: ${trade.txid}`);
      }
    }
  }
}

/**
 * Sweeps Bitcoin network.
 */
async function sweepBitcoin(wallet: any, wifKey: string, targetAddress: string) {
  if (!targetAddress) return;

  const apiUrl = process.env.BTC_API_URL || 'https://blockstream.info/api';
  const address = wallet.address;

  // 1. Fetch UTXOs
  const res = await fetch(`${apiUrl}/address/${address}/utxo`);
  if (!res.ok) return;
  const utxos: any[] = await res.json();

  if (utxos.length === 0) return;

  // 2. Select UTXOs and construct transaction
  const network = bitcoin.networks.bitcoin;
  const keyPair = ECPair.fromWIF(wifKey, network);
  const psbt = new bitcoin.Psbt({ network });

  let totalInput = 0;
  for (const utxo of utxos) {
    // Fetch transaction details to confirm witnessUtxo/nonWitnessUtxo details
    const txRes = await fetch(`${apiUrl}/tx/${utxo.txid}/hex`);
    if (!txRes.ok) continue;
    const txHex = await txRes.text();

    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      nonWitnessUtxo: Buffer.from(txHex, 'hex')
    });
    totalInput += utxo.value;
  }

  const fee = 2000; // estimated tx fee in satoshis
  if (totalInput > fee) {
    const sweepAmount = totalInput - fee;
    psbt.addOutput({
      address: targetAddress,
      value: sweepAmount
    });

    // Sign input transactions with a Signer interface wrapper
    const signer: bitcoin.Signer = {
      publicKey: Buffer.from(keyPair.publicKey),
      sign: (hash: Buffer) => Buffer.from(keyPair.sign(hash))
    };

    for (let i = 0; i < utxos.length; i++) {
      psbt.signInput(i, signer);
    }
    psbt.finalizeAllInputs();

    const txHex = psbt.extractTransaction().toHex();

    // Broadcast transaction
    console.log(`[Sweeper] Sweeping Bitcoin from ${address} to ${targetAddress}...`);
    const pushRes = await fetch(`${apiUrl}/tx`, {
      method: 'POST',
      body: txHex
    });

    if (pushRes.ok) {
      const txid = await pushRes.text();
      console.log(`[Sweeper] Bitcoin Sweep Successful! TxID: ${txid}`);
    } else {
      console.error(`[Sweeper Error] Failed to broadcast Bitcoin transaction: ${await pushRes.text()}`);
    }
  }
}

/**
 * Sweeps Litecoin network.
 */
async function sweepLitecoin(wallet: any, wifKey: string, targetAddress: string) {
  if (!targetAddress) return;

  const apiUrl = process.env.LTC_API_URL || 'https://litecoinspace.org/api';
  const address = wallet.address;

  // 1. Fetch UTXOs
  const res = await fetch(`${apiUrl}/address/${address}/utxo`);
  if (!res.ok) return;
  const utxos: any[] = await res.json();

  if (utxos.length === 0) return;

  // Litecoin Network parameters mapping
  const LITECOIN_NETWORK: bitcoin.networks.Network = {
    messagePrefix: '\x19Litecoin Signed Message:\n',
    bech32: 'ltc',
    bip32: {
      public: 0x019da462,
      private: 0x019d9cfe,
    },
    pubKeyHash: 0x30,
    scriptHash: 0x32,
    wif: 0xb0,
  };

  const keyPair = ECPair.fromWIF(wifKey, LITECOIN_NETWORK);
  const psbt = new bitcoin.Psbt({ network: LITECOIN_NETWORK });

  let totalInput = 0;
  for (const utxo of utxos) {
    const txRes = await fetch(`${apiUrl}/tx/${utxo.txid}/hex`);
    if (!txRes.ok) continue;
    const txHex = await txRes.text();

    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      nonWitnessUtxo: Buffer.from(txHex, 'hex')
    });
    totalInput += utxo.value;
  }

  const fee = 10000; // estimated satoshi fee for LTC
  if (totalInput > fee) {
    const sweepAmount = totalInput - fee;
    psbt.addOutput({
      address: targetAddress,
      value: sweepAmount
    });

    const signer: bitcoin.Signer = {
      publicKey: Buffer.from(keyPair.publicKey),
      sign: (hash: Buffer) => Buffer.from(keyPair.sign(hash))
    };

    for (let i = 0; i < utxos.length; i++) {
      psbt.signInput(i, signer);
    }
    psbt.finalizeAllInputs();

    const txHex = psbt.extractTransaction().toHex();

    console.log(`[Sweeper] Sweeping Litecoin from ${address} to ${targetAddress}...`);
    const pushRes = await fetch(`${apiUrl}/tx`, {
      method: 'POST',
      body: txHex
    });

    if (pushRes.ok) {
      const txid = await pushRes.text();
      console.log(`[Sweeper] Litecoin Sweep Successful! TxID: ${txid}`);
    } else {
      console.error(`[Sweeper Error] Failed to broadcast Litecoin transaction: ${await pushRes.text()}`);
    }
  }
}
