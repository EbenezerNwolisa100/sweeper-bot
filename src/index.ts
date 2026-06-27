import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import walletRoutes from './routes/walletRoutes';
import { getDatabase } from './config/db';
import { startSweeper } from './services/sweeperService';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Routes
app.use('/api/wallets', walletRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Database initialization & server startup
async function startServer() {
  try {
    // Connect to database and run schema migrations
    console.log('Connecting to SQLite database...');
    await getDatabase();
    console.log('Database connected successfully.');

    // Start background monitoring & sweeper bot
    startSweeper();

    // Start listening
    app.listen(PORT, () => {
      console.log(`Wallet Microservice is running at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
