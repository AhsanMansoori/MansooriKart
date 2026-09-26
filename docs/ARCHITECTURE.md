# MansooriKart Architecture Index

The current system overview is [BACKEND_ARCHITECTURE.md](./BACKEND_ARCHITECTURE.md). Domain details are split across the other `*_ARCHITECTURE.md` files in this directory. Historical Fusion and takeover material is explicitly archived under `legacy/`.

The frontend remains React 18 with Vite and Material UI during the staged UI migration. The backend is entirely the TypeScript `/api/v1` runtime. MongoDB transactions are a deployment requirement for multi-record commerce operations.
