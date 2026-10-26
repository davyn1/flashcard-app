from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .auth import create_token, require_auth, verify_password
from .config import Settings, get_settings
from .db import Database
from .ratelimit import RateLimiter
from .sync import router as sync_router


class LoginRequest(BaseModel):
    password: str = Field(min_length=1, max_length=1024)


class LoginResponse(BaseModel):
    token: str
    expires_at: int  # ms since epoch


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    if len(settings.jwt_secret) < 32:
        raise RuntimeError("JWT_SECRET must be set to a random string of at least 32 characters")
    if not settings.app_password_hash:
        raise RuntimeError("APP_PASSWORD_HASH must be set (generate it with scripts/hash_password.py)")

    app = FastAPI(title="Korean Flashcards API", version="0.1.0")
    app.dependency_overrides[get_settings] = lambda: settings
    app.state.db = Database(settings.database_url)
    login_limiter = RateLimiter(settings.login_rate_limit, settings.login_rate_window_seconds)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
        max_age=86400,
    )

    @app.get("/health")
    def health() -> dict:
        return {"ok": True}

    @app.post("/auth/login", response_model=LoginResponse)
    def login(body: LoginRequest, request: Request) -> LoginResponse:
        client_ip = request.client.host if request.client else "unknown"
        retry_after = login_limiter.hit(client_ip)
        if retry_after is not None:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many login attempts. Try again shortly.",
                headers={"Retry-After": str(max(1, int(retry_after) + 1))},
            )
        if not verify_password(body.password, settings.app_password_hash):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect password")
        login_limiter.reset(client_ip)
        token, exp = create_token(settings)
        return LoginResponse(token=token, expires_at=exp * 1000)

    @app.get("/auth/check", dependencies=[Depends(require_auth)])
    def check() -> dict:
        return {"ok": True}

    app.include_router(sync_router)
    return app
