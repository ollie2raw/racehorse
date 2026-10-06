import path from 'path';
import { readEnvFile } from './envFile';

function applyEnvFile(filePath: string) {
  for (const [key, value] of Object.entries(readEnvFile(filePath))) {
    if (process.env[key] == null) process.env[key] = value;
  }
}

const serverRoot = path.resolve(__dirname, '..');
applyEnvFile(path.join(serverRoot, '.env'));

