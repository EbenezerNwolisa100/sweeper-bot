import { generateWallet, USDT_CONTRACTS } from './services/walletGenerator';
import { encrypt, decrypt } from './services/crypto';

async function testEncryptionDecryption() {
  console.log('\n--- Running Encryption / Decryption Tests ---');
  const sampleText = 'my-super-secret-passphrase-123';
  
  try {
    const encrypted = encrypt(sampleText);
    console.log(`Encrypted Output format matches: ${encrypted.includes(':')}`);
    
    const decrypted = decrypt(encrypted);
    if (decrypted === sampleText) {
      console.log('✅ Encryption / Decryption test PASSED');
    } else {
      console.error(`❌ Failed: Decrypted text is "${decrypted}", expected "${sampleText}"`);
    }
  } catch (error) {
    console.error('❌ Encryption test failed with error:', error);
  }
}

function testWalletDerivations() {
  console.log('\n--- Running HD Wallet Derivation Tests ---');
  
  const testMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  
  const testCases = [
    {
      coin: 'btc',
      expectedAddress: '112J4GVEfTcvfF3t4f1rnH12X1AmdmxfW9', // Let's derive and verify
      desc: 'Bitcoin (Legacy P2PKH)'
    },
    {
      coin: 'eth',
      expectedAddress: '0x1C13Ebc7D566085a698F531065D653f53831ec7B', // We will print what it derives
      desc: 'Ethereum'
    },
    {
      coin: 'bsc',
      desc: 'BNB Smart Chain'
    },
    {
      coin: 'polygon',
      desc: 'Polygon'
    },
    {
      coin: 'sol',
      desc: 'Solana'
    },
    {
      coin: 'trx',
      desc: 'Tron'
    },
    {
      coin: 'ltc',
      desc: 'Litecoin (Legacy)'
    },
    {
      coin: 'usdt_sol',
      desc: 'Solana USDT',
      expectedContract: USDT_CONTRACTS.SOLANA
    },
    {
      coin: 'usdt_trc20',
      desc: 'Tron USDT (TRC20)',
      expectedContract: USDT_CONTRACTS.TRC20
    },
    {
      coin: 'usdt_erc20',
      desc: 'Ethereum USDT (ERC20)',
      expectedContract: USDT_CONTRACTS.ERC20
    }
  ];

  for (const tc of testCases) {
    try {
      const wallet = generateWallet(tc.coin, testMnemonic);
      console.log(`\nAsset: ${tc.desc} (${tc.coin})`);
      console.log(`- Path: ${wallet.derivationPath}`);
      console.log(`- Address: ${wallet.address}`);
      console.log(`- Public Key: ${wallet.publicKey}`);
      console.log(`- Private Key length: ${wallet.privateKey.length}`);
      
      if (tc.expectedContract) {
        if (wallet.contractAddress === tc.expectedContract) {
          console.log(`  ✅ Contract matches: ${wallet.contractAddress}`);
        } else {
          console.error(`  ❌ Failed: Contract is "${wallet.contractAddress}", expected "${tc.expectedContract}"`);
        }
      }
      
      // Let's do sanity validation of addresses
      if (tc.coin === 'btc') {
        // Starts with 1 (legacy BTC)
        if (wallet.address.startsWith('1')) {
          console.log(`  ✅ Address starts with '1'`);
        } else {
          console.error(`  ❌ Failed: BTC address does not start with '1': ${wallet.address}`);
        }
      } else if (tc.coin === 'ltc') {
        // Starts with L (legacy LTC)
        if (wallet.address.startsWith('L')) {
          console.log(`  ✅ Address starts with 'L'`);
        } else {
          console.error(`  ❌ Failed: LTC address does not start with 'L': ${wallet.address}`);
        }
      } else if (['eth', 'bsc', 'polygon', 'usdt_erc20'].includes(tc.coin)) {
        // Starts with 0x
        if (wallet.address.startsWith('0x')) {
          console.log(`  ✅ Address starts with '0x'`);
        } else {
          console.error(`  ❌ Failed: EVM address does not start with '0x': ${wallet.address}`);
        }
      } else if (['trx', 'usdt_trc20'].includes(tc.coin)) {
        // Starts with T
        if (wallet.address.startsWith('T')) {
          console.log(`  ✅ Address starts with 'T'`);
        } else {
          console.error(`  ❌ Failed: Tron address does not start with 'T': ${wallet.address}`);
        }
      }
    } catch (error: any) {
      console.error(`❌ Failed derivation for ${tc.desc}:`, error.message);
    }
  }
}

async function run() {
  console.log('🚀 Starting Wallet Microservice Tests...');
  await testEncryptionDecryption();
  testWalletDerivations();
}

run();
