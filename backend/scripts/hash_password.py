"""Generate APP_PASSWORD_HASH from a password you type (input is hidden).

    python scripts/hash_password.py
"""

import getpass
import secrets
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.auth import hash_password  # noqa: E402


def main() -> None:
    password = getpass.getpass("Password: ")
    if len(password) < 8:
        sys.exit("Use at least 8 characters.")
    if getpass.getpass("Repeat password: ") != password:
        sys.exit("Passwords do not match.")
    print("\nAdd these lines to backend/.env (keep the single quotes so '$' is not expanded):\n")
    print(f"APP_PASSWORD_HASH='{hash_password(password)}'")
    print(f"JWT_SECRET='{secrets.token_urlsafe(48)}'")
    print("\n(Only replace JWT_SECRET if you don't have one yet - changing it logs out every device.)")


if __name__ == "__main__":
    main()
