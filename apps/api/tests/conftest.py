"""测试夹具：在导入 sag_api 之前把配置指向临时目录（settings 为进程级单例）。"""

import asyncio
import os
import sys
import tempfile

import pytest

_TMP = tempfile.mkdtemp(prefix="sag-test-")
os.environ.setdefault("SAG_DATABASE_URL", f"sqlite+aiosqlite:///{_TMP}/sag.db")
os.environ.setdefault("SAG_DATA_DIR", f"{_TMP}/sag")
os.environ.setdefault("SAG_UPLOAD_DIR", f"{_TMP}/uploads")
os.environ.setdefault("SAG_DEBUG", "false")
os.environ.setdefault("SAG_SAG_LANGUAGE", "zh")
# 强制离线：即使存在带真实 key 的 .env，也保证测试确定性（不发起 LLM 调用）
os.environ["SAG_LLM_API_KEY"] = ""
os.environ["SAG_LLM_BASE_URL"] = ""
os.environ["SAG_EMBEDDING_API_KEY"] = ""
os.environ["SAG_MINERU_API_KEY"] = ""
os.environ["SAG_MINERU_BASE_URL"] = ""

_API_DB_CHECKOUTS: dict[int, str] = {}


@pytest.fixture(scope="session", autouse=True)
def _trace_api_database_checkouts():
    from sqlalchemy import event

    from sag_api.core.db import engine

    def record_checkout(_connection, record, _proxy):
        task = asyncio.current_task()
        _API_DB_CHECKOUTS[id(record)] = task.get_name() if task is not None else "<no asyncio task>"

    def record_checkin(_connection, record):
        _API_DB_CHECKOUTS.pop(id(record), None)

    event.listen(engine.sync_engine, "checkout", record_checkout)
    event.listen(engine.sync_engine, "checkin", record_checkin)
    yield
    event.remove(engine.sync_engine, "checkout", record_checkout)
    event.remove(engine.sync_engine, "checkin", record_checkin)


@pytest.fixture(autouse=True)
async def _isolate_persisted_jobs():
    """A test must not recover queued jobs created by an earlier app lifespan."""
    yield
    assert not _API_DB_CHECKOUTS, (
        f"test leaked checked-out API database connections: {_API_DB_CHECKOUTS}"
    )
    if "sag_api.core.db" not in sys.modules:
        return

    from sqlalchemy import delete, inspect

    from sag_api.core.db import SessionLocal, engine
    from sag_api.db.models import Job

    async with engine.connect() as connection:
        exists = await connection.run_sync(lambda sync: inspect(sync).has_table(Job.__tablename__))
    if not exists:
        return

    async with SessionLocal() as session:
        await session.execute(delete(Job))
        await session.commit()
