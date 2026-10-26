"""Run the API for local development with auto-reload: `python dev.py` (from anywhere)."""

import os
import sys
from pathlib import Path

import uvicorn

if __name__ == "__main__":
    here = Path(__file__).resolve().parent
    os.chdir(here)  # so .env and the SQLite file resolve inside backend/
    sys.path.insert(0, str(here))
    uvicorn.run("app.asgi:app", host="0.0.0.0", port=int(os.environ.get("PORT", 8000)), reload=True)
