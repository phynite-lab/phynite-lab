"""Verified HTTPS trust shared by the public native core's connectors."""
from __future__ import annotations

from pathlib import Path
import ssl


def verified_ssl_context() -> ssl.SSLContext:
    """Preserve OS/user roots and add the CA bundle shipped with the core.

    A frozen interpreter cannot rely on its build machine's OpenSSL CA path.
    Botocore's maintained bundle is already part of the reviewed core. Neither
    certificate-chain nor hostname verification is weakened.
    """
    import botocore
    bundle = Path(botocore.__file__).resolve().with_name("cacert.pem")
    if not bundle.is_file():
        raise RuntimeError("The installed application is missing its HTTPS trust bundle. Reinstall the verified Phynite Lab package.")
    context = ssl.create_default_context()
    context.load_verify_locations(cafile=str(bundle))
    return context
