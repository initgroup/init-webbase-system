from __future__ import annotations

import math
import os
import time
from collections import OrderedDict, deque
from threading import Lock

from fastapi import HTTPException, Request


def _bounded_int(
    environment_key: str,
    default: int,
    minimum: int,
    maximum: int,
) -> int:
    try:
        configured = int(os.getenv(environment_key, str(default)))
    except (TypeError, ValueError):
        configured = default
    return max(minimum, min(configured, maximum))


_WINDOW_SECONDS = _bounded_int(
    "INIT_AUTH_RATE_LIMIT_WINDOW_SECONDS",
    60,
    10,
    3600,
)
_LOGIN_MAX_ATTEMPTS = _bounded_int(
    "INIT_LOGIN_RATE_LIMIT_MAX_ATTEMPTS",
    10,
    1,
    100,
)
_SIGNUP_MAX_ATTEMPTS = _bounded_int(
    "INIT_SIGNUP_RATE_LIMIT_MAX_ATTEMPTS",
    5,
    1,
    50,
)
_MAX_CLIENTS = _bounded_int(
    "INIT_AUTH_RATE_LIMIT_MAX_CLIENTS",
    2048,
    128,
    10000,
)
_LIMITS = {
    "login": _LOGIN_MAX_ATTEMPTS,
    "signup": _SIGNUP_MAX_ATTEMPTS,
}
_attempts: OrderedDict[tuple[str, str], deque[float]] = OrderedDict()
_attempts_lock = Lock()


def _client_ip(request: Request) -> str:
    if request.client is None:
        return "unknown"
    return str(request.client.host or "unknown")


def check_auth_rate_limit(request: Request, scope: str) -> None:
    limit = _LIMITS.get(scope)
    if limit is None:
        raise ValueError(f"Unsupported rate-limit scope: {scope}")

    now = time.monotonic()
    cutoff = now - _WINDOW_SECONDS
    key = (scope, _client_ip(request))
    retry_after = 0

    with _attempts_lock:
        bucket = _attempts.get(key)
        if bucket is None:
            while len(_attempts) >= _MAX_CLIENTS:
                _attempts.popitem(last=False)
            bucket = deque()
            _attempts[key] = bucket
        else:
            _attempts.move_to_end(key)

        while bucket and bucket[0] <= cutoff:
            bucket.popleft()

        if len(bucket) >= limit:
            retry_after = max(
                1,
                math.ceil(_WINDOW_SECONDS - (now - bucket[0])),
            )
        else:
            bucket.append(now)

    if retry_after:
        raise HTTPException(
            status_code=429,
            detail="Too many authentication attempts. Try again later.",
            headers={"Retry-After": str(retry_after)},
        )
