import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
const template = await readFile('.env.example', 'utf8');
const secret = () => randomBytes(36).toString('base64url');
const text = template.replace(/^WORKSPACE_LAB_TOKEN=$/m, `WORKSPACE_LAB_TOKEN=${secret()}`).replace(/^WORKSPACE_LAB_ADMIN_TOKEN=$/m, `WORKSPACE_LAB_ADMIN_TOKEN=${secret()}`).replace(/^DEMO_SESSION_SECRET=$/m, `DEMO_SESSION_SECRET=${secret()}`);
try { await writeFile('.env', text, { flag: 'wx', mode: 0o600 }); console.log('Created .env with local credentials. Set OPENAI_API_KEY and OPENAI_MODEL before live learning.'); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; console.log('Existing .env preserved.'); }
await mkdir('.local', { recursive: true });
