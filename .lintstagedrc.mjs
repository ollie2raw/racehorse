import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default {
  'client/src/**/*.{ts,tsx}': (files) => {
    // Typecheck always covers the full project; staged files are the trigger.
    const relFiles = files.map((f) => path.relative(path.join(__dirname, 'client'), f)).join(' ');
    return [
      `bash -c 'cd client && ESLINT_USE_FLAT_CONFIG=false npx eslint --max-warnings 0 -c .eslintrc.json ${relFiles}'`,
      `npm run typecheck --prefix client`,
    ];
  },
};
