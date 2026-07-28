import pytest
from fastapi import FastAPI

from sag_api.main import lifespan, settings


@pytest.mark.asyncio
async def test_production_lifespan_rejects_secret_shorter_than_32_bytes(monkeypatch):
    monkeypatch.setattr(settings, "environment", "prod")
    monkeypatch.setattr(settings, "secret_key", "too-short")

    with pytest.raises(RuntimeError, match="32"):
        async with lifespan(FastAPI()):
            pass
