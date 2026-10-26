import time

import bcrypt
import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .config import Settings, get_settings

_argon2 = PasswordHasher()
_bearer = HTTPBearer(auto_error=False)
JWT_ALGORITHM = "HS256"
SUBJECT = "owner"


def hash_password(password: str) -> str:
    return _argon2.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    if not password_hash:
        return False
    try:
        if password_hash.startswith("$argon2"):
            return _argon2.verify(password_hash, password)
        if password_hash.startswith(("$2a$", "$2b$", "$2y$")):
            return bcrypt.checkpw(password.encode(), password_hash.encode())
    except (VerificationError, InvalidHashError, ValueError):
        return False
    return False


def create_token(settings: Settings) -> tuple[str, int]:
    now = int(time.time())
    exp = now + settings.jwt_expire_days * 86400
    token = jwt.encode({"sub": SUBJECT, "iat": now, "exp": exp}, settings.jwt_secret, algorithm=JWT_ALGORITHM)
    return token, exp


def require_auth(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    settings: Settings = Depends(get_settings),
) -> None:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if creds is None or creds.scheme.lower() != "bearer":
        raise unauthorized
    try:
        payload = jwt.decode(
            creds.credentials,
            settings.jwt_secret,
            algorithms=[JWT_ALGORITHM],
            options={"require": ["exp", "sub"]},
        )
    except jwt.PyJWTError:
        raise unauthorized from None
    if payload.get("sub") != SUBJECT:
        raise unauthorized
