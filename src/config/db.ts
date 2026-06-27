import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

let dbInstance: Database | null = null;

export async function getDatabase(): Promise<Database> {
  if (dbInstance) {
    return dbInstance;
  }

  const dbPath = process.env.DB_PATH || './wallets.db';
  const resolvedPath = path.isAbsolute(dbPath) ? dbPath : path.resolve(process.cwd(), dbPath);

  // Open SQLite database
  dbInstance = await open({
    filename: resolvedPath,
    driver: sqlite3.Database
  });

  // Initialize schema
  await dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS wallets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      coin TEXT NOT NULL,
      address TEXT NOT NULL UNIQUE,
      public_key TEXT NOT NULL,
      private_key TEXT NOT NULL,
      mnemonic TEXT NOT NULL,
      derivation_path TEXT NOT NULL,
      contract_address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_wallets_address ON wallets (address);
    CREATE INDEX IF NOT EXISTS idx_wallets_coin ON wallets (coin);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS custom_contracts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      network TEXT NOT NULL,
      address TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Seed default contracts if none exist
  const countRow = await dbInstance.get('SELECT COUNT(*) as count FROM custom_contracts');
  if (countRow && countRow.count === 0) {
    await dbInstance.run(
      `INSERT INTO custom_contracts (symbol, name, network, address) VALUES (?, ?, ?, ?)`,
      ['usdt_erc20', 'Tether USD (ERC-20)', 'ethereum', '0xdAC17F958D2ee523a2206206994597C13D831ec7']
    );
    await dbInstance.run(
      `INSERT INTO custom_contracts (symbol, name, network, address) VALUES (?, ?, ?, ?)`,
      ['usdt_trc20', 'Tether USD (TRC-20)', 'tron', 'TGkxzkDKyMeq2T7edKnyjZoFypyzjkkssq']
    );
    await dbInstance.run(
      `INSERT INTO custom_contracts (symbol, name, network, address) VALUES (?, ?, ?, ?)`,
      ['usdt_sol', 'Tether USD (SPL)', 'solana', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB']
    );
    console.log('Seeded default USDT contract addresses successfully.');
  }

  return dbInstance;
}
