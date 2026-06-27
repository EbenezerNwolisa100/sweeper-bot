import { Router } from 'express';
import {
  generateWalletHandler,
  listWalletsHandler,
  getWalletByAddressHandler,
  getSettingsHandler,
  updateSettingsHandler,
  getContractsHandler,
  addContractHandler,
  deleteContractHandler
} from '../controllers/walletController';

const router = Router();

// Settings Configuration
router.get('/config/settings', getSettingsHandler);
router.post('/config/settings', updateSettingsHandler);

// Custom Contracts Configuration
router.get('/config/contracts', getContractsHandler);
router.post('/config/contracts', addContractHandler);
router.delete('/config/contracts/:id', deleteContractHandler);

// Core Wallet Generation & Queries
router.post('/generate', generateWalletHandler);
router.get('/', listWalletsHandler);
router.get('/:address', getWalletByAddressHandler);

export default router;
