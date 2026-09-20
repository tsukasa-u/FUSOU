"""
fusou_datasets._client
~~~~~~~~~~~~~~~~~~~~~~

HTTP API client with Device Trust authentication, retries, and error handling.
"""

import os
import sys
import json
import time
from typing import Optional, Dict, Any

import requests

from ._config import _config, _get_api_key, _get_client_id, DEFAULT_API_URL
from ._exceptions import (
    FusouDatasetsError,
    AuthenticationError,
    VerificationError,
    RateLimitError,
)

REQUEST_TIMEOUT = 30
DOWNLOAD_TIMEOUT = 300
CLIENT_VERSION = "0.2.0"


def _is_colab() -> bool:
    """Check if running in Google Colab."""
    try:
        import google.colab
        return True
    except ImportError:
        return False


def _get_colab_credentials() -> Optional[Dict[str, str]]:
    """Get email and token from Google Colab environment."""
    if not _is_colab():
        return None
    try:
        from google.colab import auth
        from google.auth import default
        creds, project = default()
        email = getattr(creds, "service_account_email", None) or getattr(creds, "signer_email", None)
        token = getattr(creds, "token", None)
        if email:
            return {"email": email, "token": token}
    except Exception:
        pass
    return None


def _mask_url_tokens(url: str) -> str:
    """Mask sensitive tokens or signatures from URLs for safe logging."""
    import urllib.parse
    parsed = urllib.parse.urlparse(url)
    if not parsed.query:
        return url
    qs = urllib.parse.parse_qs(parsed.query)
    sensitive_keys = {"token", "X-Amz-Signature", "sig", "key", "access_token"}
    for k in qs:
        if any(s.lower() in k.lower() for s in sensitive_keys):
            qs[k] = ["***"]
    new_query = urllib.parse.urlencode(qs, doseq=True)
    return urllib.parse.urlunparse(parsed._replace(query=new_query))


def _resolve_url(endpoint: str) -> str:
    """Resolve endpoint URL supporting sub-apps mounted under /api/."""
    api_url = _config.get("api_url", DEFAULT_API_URL)
    sub_apps = ("/master-data", "/ship-growth", "/soku-speed-observed", "/fleet", "/kc-period")
    if any(endpoint.startswith(p) for p in sub_apps):
        base_api = api_url.rsplit("/data-loader", 1)[0] if "/data-loader" in api_url else api_url
        return f"{base_api.rstrip('/')}/{endpoint.lstrip('/')}"
    return f"{api_url.rstrip('/')}/{endpoint.lstrip('/')}"


def _request(
    method: str,
    endpoint: str,
    json_data: Optional[dict] = None,
    timeout: int = REQUEST_TIMEOUT
) -> requests.Response:
    """Execute authenticated HTTP request with rate limit handling and retries."""
    api_key = _get_api_key()
    client_id = _get_client_id()
    url = _resolve_url(endpoint)
    
    max_retries = 3
    for attempt in range(max_retries + 1):
        try:
            resp = requests.request(
                method=method,
                url=url,
                headers={
                    "X-API-KEY": api_key,
                    "X-CLIENT-ID": client_id,
                    "Content-Type": "application/json",
                    "User-Agent": f"FusouDatasets/{CLIENT_VERSION}",
                },
                json=json_data,
                timeout=timeout,
            )
            
            # Rate Limit (RU limit) Retry Logic
            if resp.status_code == 429:
                retry_after_val = resp.headers.get("Retry-After")
                wait_time = 1
                if retry_after_val:
                    try:
                        wait_time = int(retry_after_val) + 1
                    except ValueError:
                        pass
                
                if attempt < max_retries:
                    print(f"Rate limit exceeded. Waiting {wait_time}s... (Attempt {attempt+1}/{max_retries})", file=sys.stderr)
                    time.sleep(wait_time)
                    continue
                else:
                    raise RateLimitError("Max retries exceeded for rate limit.", retry_after=wait_time)
            
            return resp

        except requests.exceptions.RequestException as e:
            if attempt < max_retries:
                print(f"Connection error: {e}. Retrying...", file=sys.stderr)
                time.sleep(2)
                continue
            safe_url = _mask_url_tokens(url)
            raise FusouDatasetsError(f"Request failed for {safe_url}: {e}")

    raise FusouDatasetsError("Request failed after retries")


def _verify_device_colab() -> bool:
    """Try to verify device using Google Colab credentials."""
    creds = _get_colab_credentials()
    if not creds or not creds.get("email"):
        return False
    
    print(f"[fusou_datasets] Attempting Colab verification with: {creds['email']}", file=sys.stderr)
    try:
        resp = _request("POST", "/verify-google", {
            "email": creds["email"],
            "google_token": creds.get("token"),
        })
        if resp.status_code == 200:
            print(f"? Device verified via Google account: {creds['email']}", file=sys.stderr)
            return True
    except Exception as e:
        print(f"[fusou_datasets] Colab verification failed: {e}", file=sys.stderr)
    return False


def _verify_device_code() -> bool:
    """Verify device using email code (interactive)."""
    # Non-interactive check (CI / background process / scripts without TTY)
    if not sys.stdin.isatty():
        raise VerificationError(
            "? Device verification required but running in a non-interactive environment (no TTY).\n"
            "Please verify this device first by running an interactive session (e.g. fusou_datasets.list_tables())."
        )

    print("\n" + "=" * 60, file=sys.stderr)
    print("?? DEVICE VERIFICATION REQUIRED", file=sys.stderr)
    print("=" * 60, file=sys.stderr)
    print("A 6-digit verification code has been sent to your email address.", file=sys.stderr)
    print("Check spam folder if not received. Code expires in 10 minutes.", file=sys.stderr)
    print("=" * 60, file=sys.stderr)
    
    for attempt in range(3):
        try:
            code = input(f"Code ({attempt+1}/3): ").strip()
        except (EOFError, KeyboardInterrupt):
            raise VerificationError("\nVerification cancelled.")
        
        if not code:
            continue
        
        resp = _request("POST", "/verify", {"code": code})
        if resp.status_code == 200:
            print("[OK] Device verified!", file=sys.stderr)
            return True
        print("[!] Invalid code", file=sys.stderr)
    
    raise VerificationError("Max verification attempts exceeded.")


def _verify_device() -> bool:
    """Verify device: tries Colab auth first, then falls back to interactive code input."""
    if _is_colab():
        if _verify_device_colab():
            return True
    return _verify_device_code()


def _handle_403(response: requests.Response, retry_func, *args, **kwargs):
    """Handle 403 Forbidden: check for device verification, split access, or invalid API key."""
    try:
        data = response.json()
        err_code = data.get("error")
        err_msg = data.get("message", "")
        
        if err_code == "DEVICE_UNVERIFIED":
            _verify_device()
            return retry_func(*args, **kwargs, _retry=False)
        elif err_code == "SPLIT_ACCESS_DENIED":
            raise FusouDatasetsError(
                f"[!] Split Access Denied (HTTP 403): {err_msg}\n"
                "The 'test' split is held out for blind evaluation. Use split='train' or split='validation'."
            )
        elif err_code == "INVALID_API_KEY":
            raise AuthenticationError(
                "[!] Invalid or inactive API key.\n"
                "Check your API key at: https://fusou.dev/dashboard/api-keys\n"
                "Update it: fusou_datasets.save_api_key('your_new_key')"
            )
        elif err_msg:
            raise AuthenticationError(f"[!] Access denied (HTTP 403): {err_msg}")
    except json.JSONDecodeError:
        pass
    raise AuthenticationError(
        "[!] Access denied (HTTP 403).\n"
        "Please check that your API key is valid and your account is active."
    )


def _parse_error_response(resp: requests.Response) -> str:
    """Parse error response and return a helpful error message."""
    try:
        data = resp.json()
        error_code = data.get("error", "UNKNOWN")
        message = data.get("message", "")
        if message:
            return f"{error_code}: {message}"
        return error_code
    except (json.JSONDecodeError, ValueError):
        return resp.text[:200] if resp.text else f"HTTP {resp.status_code}"


def _raise_api_error(resp: requests.Response, context: str = "") -> None:
    """Raise appropriate exception for non-200 API response."""
    msg = _parse_error_response(resp)
    prefix = f"{context}: " if context else ""
    if resp.status_code == 401:
        raise AuthenticationError(f"{prefix}{msg}")
    elif resp.status_code == 404:
        from ._exceptions import DatasetNotFoundError
        raise DatasetNotFoundError(f"{prefix}{msg}")
    elif resp.status_code == 429:
        raise RateLimitError(f"{prefix}{msg}")
    else:
        raise FusouDatasetsError(f"{prefix}{msg}")