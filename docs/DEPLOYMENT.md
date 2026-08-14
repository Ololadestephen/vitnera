# Deployment

Deploy the contract, reviewer, upload API, and web application as separate trust and secret boundaries.

## 1. Contract

Server-only environment:

```env
BOTCHAIN_RPC_URL=https://rpc.bohr.life
BOTCHAIN_CHAIN_ID=968
DEPLOYER_PRIVATE_KEY=...
REVIEWER_ADDRESS=0x...
VERIFIER_ADDRESS=0x...
```

Run:

```bash
cd botchain-rwa/contracts
source ../.env
forge script script/Deploy.s.sol:DeployAegisKeyRWA --rpc-url "$BOTCHAIN_RPC_URL" --broadcast
```

Save the deployed contract address and first deployment block.

## 2. Reviewer

The reviewer holds sensitive API and signing keys. Deploy it to a server/container platform, not as browser code.

```env
AI_PROVIDER=groq
AI_API_KEY=gsk_...
AI_BASE_URL=https://api.groq.com/openai/v1
AI_MODEL=openai/gpt-oss-20b
REVIEWER_PRIVATE_KEY=0x...
REVIEWER_PORT=8790
REVIEWER_ALLOWED_ORIGINS=https://rwa.example.com
BOTCHAIN_CHAIN_ID=968
VITNERA_CONTRACT=0x...
```

The address derived from `REVIEWER_PRIVATE_KEY` must equal `REVIEWER_ADDRESS` authorized during deployment.

```bash
docker build -f services/reviewer/Dockerfile -t vitnera-reviewer .
docker run --env-file .env -p 8790:8790 vitnera-reviewer
```

Use a managed secret store and rotate the reviewer by authorizing a new address before retiring the old one.

## 3. Upload API

Reuse `access-control-backend` or deploy an equivalent API with:

```env
PINATA_JWT=...
MAX_UPLOAD_BYTES=52428800
UPLOAD_ALLOWED_ORIGINS=https://rwa.example.com
```

Required endpoint:

```text
POST /api/upload/ipfs
```

The API never needs room keys or plaintext documents.

## 4. Web

Public frontend environment:

```env
VITE_BOTCHAIN_RPC_URL=https://rpc.bohr.life
VITE_BOTCHAIN_CHAIN_ID=968
VITE_VITNERA_CONTRACT=0x...
VITE_DEPLOYMENT_BLOCK=...
VITE_STORAGE_API_URL=https://uploads.example.com
VITE_REVIEWER_API_URL=https://reviewer.example.com
```

Build settings:

```text
Root directory: botchain-rwa
Build command: npm install && npm run build -w @vitnera/web
Output directory: apps/web/dist
```

The SPA rewrite in `botchain-rwa/vercel.json` keeps client-side routes working after refresh.

## Production Checklist

- Use a dedicated BOT Chain RPC with rate limits appropriate for event reads.
- Restrict reviewer and upload CORS to the production web origin.
- Keep all non-`VITE_` secrets server-side.
- Review the configured AI provider's data controls before processing sensitive documents. Do not claim zero retention unless the deployed provider account guarantees it.
- Fund and monitor the reviewer/deployer operational wallets separately.
- Verify the contract source in the BOT Chain explorer.
- Run `npm test` and `npm run build` from `botchain-rwa` before release.
