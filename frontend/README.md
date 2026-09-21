# Experience Player (Presentation Frontend)

Next.js 16 (React 19, Tailwind CSS v4, TypeScript) slot cabinet and experience
player for the Casino Experience Engine PoC.

See the **root [README](../README.md)** for full setup, launch instructions,
GRIP event examples, and the allocation matrix.

## Frontend-specific commands

```bash
npm install
npm run dev    # http://localhost:3000 (proxies /api/* to the middleware on :8000)
npm run build  # type-check + production build
```

## Structure

- `app/page.tsx` — 3-column dashboard container & event coordinator
- `app/components/SlotMachine.tsx` — 5-reel cabinet, betting controls, payout engine
- `app/components/VideoPlayer.tsx` — video canvas, Web Audio synthesizer, UI pulse
- `app/components/EventButtons.tsx` — manual GRIP event triggers
- `app/lib/api.ts` — GRIP contracts & `postGripEvent` client
- `public/wuxia/` — themed video assets (scanned by the middleware at runtime)
