import pytest
from fastapi.testclient import TestClient

from app.auth import hash_password
from app.config import Settings
from app.db import Base
from app.main import create_app

PASSWORD = "correct horse battery staple"
_PASSWORD_HASH = hash_password(PASSWORD)


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(
        _env_file=None,
        app_password_hash=_PASSWORD_HASH,
        jwt_secret="test-secret-" + "x" * 40,
        database_url=f"sqlite:///{tmp_path / 'test.db'}",
        cors_origins="http://localhost:5173",
        login_rate_limit=5,
        login_rate_window_seconds=60,
    )


@pytest.fixture
def app(settings):
    app = create_app(settings)
    Base.metadata.create_all(app.state.db.engine)
    yield app
    app.state.db.engine.dispose()


@pytest.fixture
def client(app) -> TestClient:
    return TestClient(app)


@pytest.fixture
def token(client) -> str:
    res = client.post("/auth/login", json={"password": PASSWORD})
    assert res.status_code == 200
    return res.json()["token"]


@pytest.fixture
def auth(token) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}
