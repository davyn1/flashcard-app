import time

import bcrypt
import jwt

from app.auth import verify_password

from .conftest import PASSWORD


def test_login_correct_password_returns_long_lived_token(client, settings):
    res = client.post("/auth/login", json={"password": PASSWORD})
    assert res.status_code == 200
    body = res.json()
    payload = jwt.decode(body["token"], settings.jwt_secret, algorithms=["HS256"])
    assert payload["sub"] == "owner"
    # ~90 days
    assert payload["exp"] - time.time() > 89 * 86400
    assert body["expires_at"] == payload["exp"] * 1000


def test_login_incorrect_password(client):
    res = client.post("/auth/login", json={"password": "wrong"})
    assert res.status_code == 401


def test_login_validates_input(client):
    assert client.post("/auth/login", json={}).status_code == 422
    assert client.post("/auth/login", json={"password": ""}).status_code == 422
    assert client.post("/auth/login", json={"password": "x" * 2000}).status_code == 422


def test_login_is_rate_limited(client):
    for _ in range(5):
        assert client.post("/auth/login", json={"password": "wrong"}).status_code == 401
    res = client.post("/auth/login", json={"password": PASSWORD})
    assert res.status_code == 429
    assert "Retry-After" in res.headers


def test_missing_token_is_rejected(client):
    assert client.get("/auth/check").status_code == 401
    assert client.get("/sync/pull").status_code == 401
    assert client.post("/sync/push", json={}).status_code == 401


def test_invalid_and_expired_tokens_are_rejected(client, settings):
    assert client.get("/auth/check", headers={"Authorization": "Bearer nonsense"}).status_code == 401
    forged = jwt.encode({"sub": "owner", "exp": int(time.time()) + 60}, "another-secret-" + "y" * 40, "HS256")
    assert client.get("/auth/check", headers={"Authorization": f"Bearer {forged}"}).status_code == 401
    expired = jwt.encode({"sub": "owner", "exp": int(time.time()) - 10}, settings.jwt_secret, "HS256")
    assert client.get("/auth/check", headers={"Authorization": f"Bearer {expired}"}).status_code == 401


def test_valid_token_is_accepted(client, auth):
    assert client.get("/auth/check", headers=auth).status_code == 200


def test_bcrypt_hashes_are_supported():
    h = bcrypt.hashpw(b"hunter22", bcrypt.gensalt()).decode()
    assert verify_password("hunter22", h)
    assert not verify_password("hunter23", h)
    assert not verify_password("anything", "")
    assert not verify_password("anything", "plaintext-not-a-hash")


def test_cors_allows_only_configured_origin(client):
    ok = client.options(
        "/auth/login",
        headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST"},
    )
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:5173"
    bad = client.options(
        "/auth/login",
        headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"},
    )
    assert "access-control-allow-origin" not in bad.headers
