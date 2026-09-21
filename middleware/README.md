# Experience Engine Middleware

The **Experience Engine** is the core middleware layer of the casino presentation pipeline. It ingests inbound simulated **GRIP events** from the slot machine game backend, recognizes the game outcome and momentum, and allocates multi-track presentation directives (video, audio soundtrack, and cabinet lighting pulses).

## Running the Middleware Standalone

```powershell
cd middleware
pip install -r requirements.txt
python -m uvicorn main:app --reload --port 8000
```

## Endpoints

- `GET /` or `GET /health` — Health check
- `GET /api/events` — Enumeration of supported GRIP event types
- `POST /api/grip-event` — Primary GRIP event ingestion and sensory directive allocation
- `GET /docs` — Interactive OpenAPI / Swagger UI
