import * as bip39 from 'bip39';
import BIP32Factory from 'bip32';
import * as ecc from 'tiny-secp256k1';
import * as bitcoin from 'bitcoinjs-lib';
import { ethers } from 'ethers';
import { Keypair } from '@solana/web3.js';
import { derivePath } from 'ed25519-hd-key';
import { keccak256 } from 'js-sha3';
import bs58 from 'bs58';
import crypto from 'crypto';

// Initialize BIP32 library
const bip32 = BIP32Factory(ecc);

// Litecoin network parameters
const LITECOIN_NETWORK: bitcoin.networks.Network = {
  messagePrefix: '\x19Litecoin Signed Message:\n',
  bech32: 'ltc',
  bip32: {
    public: 0x019da462,
    private: 0x019d9cfe,
  },
  pubKeyHash: 0x30, // Starts with 'L'
  scriptHash: 0x32, // Starts with 'M' or '3'
  wif: 0xb0,        // Starts with 'T' (compressed)
};

export interface WalletDetails {
  coin: string;
  address: string;
  publicKey: string;
  privateKey: string;
  mnemonic: string;
  derivationPath: string;
  contractAddress?: string;
}

// USDT Token Contracts
export const USDT_CONTRACTS = {
  SOLANA: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  TRC20: 'TGkxzkDKyMeq2T7edKnyjZoFypyzjkkssq',
  ERC20: '0xdAC17F958D2ee523a2206206994597C13D831ec7'
};

/**
 * Generates a cryptocurrency wallet using BIP39 and BIP44 standards.
 * @param coin Ticker of the cryptocurrency (e.g. btc, eth, bsc, polygon, sol, trx, ltc, usdt_sol, usdt_trc20, usdt_erc20)
 * @param optionalMnemonic Optional 12-word mnemonic to derive from. If not provided, a new one is generated.
 */
export function generateWallet(
  coin: string,
  optionalMnemonic?: string,
  customContractAddress?: string,
  networkType?: string
): WalletDetails {
  // Normalize coin symbol
  const symbol = coin.toLowerCase().trim();
  const net = networkType ? networkType.toLowerCase().trim() : symbol;

  // 1. Generate or validate mnemonic
  let mnemonic = optionalMnemonic ? optionalMnemonic.trim() : bip39.generateMnemonic(128);
  if (!bip39.validateMnemonic(mnemonic)) {
    throw new Error('Invalid 12-word mnemonic phrase.');
  }

  // 2. Generate Seed from Mnemonic
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const root = bip32.fromSeed(seed);

  let address = '';
  let publicKey = '';
  let privateKey = '';
  let derivationPath = '';
  let contractAddress: string | undefined = undefined;

  switch (net) {
    case 'btc':
    case 'bitcoin': {
      derivationPath = "m/44'/0'/0'/0/0";
      const child = root.derivePath(derivationPath);
      
      const p2pkh = bitcoin.payments.p2pkh({
        pubkey: child.publicKey,
        network: bitcoin.networks.bitcoin
      });

      if (!p2pkh.address) throw new Error('Failed to derive BTC address.');
      address = p2pkh.address;
      publicKey = child.publicKey.toString('hex');
      privateKey = child.toWIF();
      break;
    }

    case 'ltc':
    case 'litecoin': {
      derivationPath = "m/44'/2'/0'/0/0";
      const child = root.derivePath(derivationPath);

      const p2pkh = bitcoin.payments.p2pkh({
        pubkey: child.publicKey,
        network: LITECOIN_NETWORK
      });

      if (!p2pkh.address) throw new Error('Failed to derive LTC address.');
      address = p2pkh.address;
      publicKey = child.publicKey.toString('hex');
      privateKey = child.toWIF();
      break;
    }

    case 'eth':
    case 'ethereum':
    case 'bsc':
    case 'polygon':
    case 'usdt_erc20': {
      derivationPath = "m/44'/60'/0'/0/0";
      
      // Derive using ethers HDNodeWallet
      const wallet = ethers.HDNodeWallet.fromMnemonic(
        ethers.Mnemonic.fromPhrase(mnemonic)!,
        derivationPath
      );

      address = wallet.address;
      publicKey = wallet.publicKey;
      privateKey = wallet.privateKey; // Hex format starting with 0x

      if (customContractAddress) {
        contractAddress = customContractAddress;
      } else if (symbol === 'usdt_erc20') {
        contractAddress = USDT_CONTRACTS.ERC20;
      }
      break;
    }

    case 'sol':
    case 'solana':
    case 'usdt_sol':
    case 'usdt_solana': {
      // Solana standard Ed25519 derivation path
      derivationPath = "m/44'/501'/0'/0'";
      const derivedSeed = derivePath(derivationPath, seed.toString('hex')).key;
      const keypair = Keypair.fromSeed(derivedSeed);

      address = keypair.publicKey.toBase58();
      publicKey = keypair.publicKey.toBase58();
      privateKey = Buffer.from(keypair.secretKey).toString('hex'); // 64-byte secret key hex

      if (customContractAddress) {
        contractAddress = customContractAddress;
      } else if (symbol === 'usdt_sol' || symbol === 'usdt_solana') {
        contractAddress = USDT_CONTRACTS.SOLANA;
      }
      break;
    }

    case 'trx':
    case 'tron':
    case 'usdt_trc20': {
      derivationPath = "m/44'/195'/0'/0/0";
      const child = root.derivePath(derivationPath);
      const privateKeyHex = child.privateKey!.toString('hex');

      // Get uncompressed public key from private key hex using ethers SigningKey
      const signingKey = new ethers.SigningKey(Buffer.from(privateKeyHex, 'hex'));
      const uncompressedPubKey = signingKey.publicKey; // hex string with '0x04' prefix

      // Tron Address Derivation:
      // Remove the leading '0x04' byte (first 4 characters of the hex string)
      const pubKeyBytes = Buffer.from(uncompressedPubKey.substring(4), 'hex');
      const hash = keccak256(pubKeyBytes);
      const last20Bytes = Buffer.from(hash, 'hex').subarray(-20);
      
      // Prepend Mainnet prefix 0x41
      const addressBuffer = Buffer.concat([Buffer.from([0x41]), last20Bytes]);

      // Base58Check Checksum: Double SHA256 of the prefixed address
      const sha256_1 = crypto.createHash('sha256').update(addressBuffer).digest();
      const sha256_2 = crypto.createHash('sha256').update(sha256_1).digest();
      const checksum = sha256_2.subarray(0, 4);

      // Concatenate and encode
      const finalAddressBytes = Buffer.concat([addressBuffer, checksum]);
      address = bs58.encode(finalAddressBytes); // Standard Tron address starting with 'T'
      publicKey = signingKey.compressedPublicKey; // Hex compressed public key
      privateKey = privateKeyHex;

      if (customContractAddress) {
        contractAddress = customContractAddress;
      } else if (symbol === 'usdt_trc20') {
        contractAddress = USDT_CONTRACTS.TRC20;
      }
      break;
    }

    default:
      throw new Error(`Unsupported coin or network: "${net}". Supported networks are: btc, eth, bsc, polygon, sol, trx, ltc, and their USDT variants.`);
  }

  return {
    coin: symbol,
    address,
    publicKey,
    privateKey,
    mnemonic,
    derivationPath,
    contractAddress
  };
}
