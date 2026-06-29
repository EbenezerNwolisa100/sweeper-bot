import { Request, Response } from 'express';
import { getDatabase } from '../config/db';
import { generateWallet } from '../services/walletGenerator';
import { encrypt, decrypt } from '../services/crypto';
// HEllo
/**
 * Handles wallet generation requests.
 * POST /api/wallets/generate
 * Body: { coin: string, mnemonic?: string }
 */
export async function generateWalletHandler(req: Request, res: Response): Promise<void> {
  try {
    const { coin, mnemonic, contractAddress, networkType } = req.body;

    if (!coin) {
      res.status(400).json({ success: false, error: 'The "coin" field is required.' });
      return;
    }

    // Generate the wallet details
    const wallet = generateWallet(coin, mnemonic, contractAddress, networkType);

    // Encrypt sensitive fields
    const encryptedPrivateKey = encrypt(wallet.privateKey);
    const encryptedMnemonic = encrypt(wallet.mnemonic);

    // Save to SQLite
    const db = await getDatabase();
    await db.run(
      `INSERT INTO wallets (coin, address, public_key, private_key, mnemonic, derivation_path, contract_address)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        wallet.coin,
        wallet.address,
        wallet.publicKey,
        encryptedPrivateKey,
        encryptedMnemonic,
        wallet.derivationPath,
        wallet.contractAddress || null
      ]
    );

    // Return plain details to the caller
    res.status(201).json({
      success: true,
      data: {
        coin: wallet.coin,
        address: wallet.address,
        publicKey: wallet.publicKey,
        privateKey: wallet.privateKey,
        mnemonic: wallet.mnemonic,
        derivationPath: wallet.derivationPath,
        contractAddress: wallet.contractAddress
      }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'An error occurred during wallet generation.'
    });
  }
}

/**
 * Lists all generated wallets.
 * GET /api/wallets
 */
export async function listWalletsHandler(req: Request, res: Response): Promise<void> {
  try {
    const db = await getDatabase();
    const rows = await db.all('SELECT * FROM wallets ORDER BY created_at DESC');

    // Decrypt fields
    const wallets = rows.map(row => {
      let decryptedPrivateKey = 'Decryption error';
      let decryptedMnemonic = 'Decryption error';

      try {
        decryptedPrivateKey = decrypt(row.private_key);
        decryptedMnemonic = decrypt(row.mnemonic);
      } catch (err) {
        // Fallback if decryption fails (e.g. wrong key config)
      }

      return {
        id: row.id,
        coin: row.coin,
        address: row.address,
        publicKey: row.public_key,
        privateKey: decryptedPrivateKey,
        mnemonic: decryptedMnemonic,
        derivationPath: row.derivation_path,
        contractAddress: row.contract_address,
        createdAt: row.created_at
      };
    });

    res.json({ success: true, count: wallets.length, data: wallets });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to retrieve wallets.'
    });
  }
}

/**
 * Retrieves a single wallet by address.
 * GET /api/wallets/:address
 */
export async function getWalletByAddressHandler(req: Request, res: Response): Promise<void> {
  try {
    const { address } = req.params;

    if (!address) {
      res.status(400).json({ success: false, error: 'Address parameter is required.' });
      return;
    }

    const db = await getDatabase();
    const row = await db.get('SELECT * FROM wallets WHERE address = ?', [address.trim()]);

    if (!row) {
      res.status(404).json({ success: false, error: 'Wallet not found.' });
      return;
    }

    let decryptedPrivateKey = 'Decryption error';
    let decryptedMnemonic = 'Decryption error';

    try {
      decryptedPrivateKey = decrypt(row.private_key);
      decryptedMnemonic = decrypt(row.mnemonic);
    } catch (err) {
      // Fallback
    }

    res.json({
      success: true,
      data: {
        id: row.id,
        coin: row.coin,
        address: row.address,
        publicKey: row.public_key,
        privateKey: decryptedPrivateKey,
        mnemonic: decryptedMnemonic,
        derivation_path: row.derivation_path,
        contract_address: row.contract_address,
        createdAt: row.created_at
      }
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'An error occurred while fetching the wallet.'
    });
  }
}

/**
 * Retrieves all admin settings.
 * GET /api/wallets/config/settings
 */
export async function getSettingsHandler(req: Request, res: Response): Promise<void> {
  try {
    const db = await getDatabase();
    const rows = await db.all('SELECT * FROM settings');
    
    // Map array to key-value object
    const settings: { [key: string]: string } = {};
    rows.forEach(row => {
      settings[row.key] = row.value;
    });

    res.json({ success: true, data: settings });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to retrieve settings.'
    });
  }
}

/**
 * Updates admin settings (destination wallet addresses).
 * POST /api/wallets/config/settings
 */
export async function updateSettingsHandler(req: Request, res: Response): Promise<void> {
  try {
    const { settings } = req.body;

    if (!settings || typeof settings !== 'object') {
      res.status(400).json({ success: false, error: 'Invalid settings object.' });
      return;
    }

    const db = await getDatabase();
    
    // Begin transaction for database safety
    await db.run('BEGIN TRANSACTION');
    try {
      for (const [key, value] of Object.entries(settings)) {
        await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, String(value).trim()]);
      }
      await db.run('COMMIT');
    } catch (err) {
      await db.run('ROLLBACK');
      throw err;
    }

    res.json({ success: true, message: 'Settings saved successfully.' });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update settings.'
    });
  }
}

/**
 * Retrieves all custom contracts.
 * GET /api/wallets/config/contracts
 */
export async function getContractsHandler(req: Request, res: Response): Promise<void> {
  try {
    const db = await getDatabase();
    const rows = await db.all('SELECT * FROM custom_contracts ORDER BY symbol ASC');
    res.json({ success: true, data: rows });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to retrieve custom contracts.'
    });
  }
}

/**
 * Adds a new custom contract.
 * POST /api/wallets/config/contracts
 */
export async function addContractHandler(req: Request, res: Response): Promise<void> {
  try {
    const { symbol, name, network, address } = req.body;

    if (!symbol || !name || !network || !address) {
      res.status(400).json({ success: false, error: 'All fields (symbol, name, network, address) are required.' });
      return;
    }

    const db = await getDatabase();
    await db.run(
      `INSERT INTO custom_contracts (symbol, name, network, address) VALUES (?, ?, ?, ?)`,
      [symbol.toLowerCase().trim(), name.trim(), network.toLowerCase().trim(), address.trim()]
    );

    res.status(201).json({ success: true, message: 'Custom contract registered successfully.' });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to add custom contract.'
    });
  }
}

/**
 * Deletes a custom contract by ID.
 * DELETE /api/wallets/config/contracts/:id
 */
export async function deleteContractHandler(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    if (!id) {
      res.status(400).json({ success: false, error: 'ID parameter is required.' });
      return;
    }

    const db = await getDatabase();
    await db.run('DELETE FROM custom_contracts WHERE id = ?', [id]);

    res.json({ success: true, message: 'Custom contract deleted successfully.' });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete custom contract.'
    });
  }
}
