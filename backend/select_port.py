"""Choose an available local TCP port for the AgroRadar API.

Called by START_AGRORADAR.bat before starting Uvicorn. The script prints
just one integer so it can be safely captured with Windows CMD `for /f`.
"""

from __future__ import annotations

import socket
import sys

CANDIDATES = (18080, 18765, 19080, 28080, 38080, 8765, 8010, 8001)


def is_available(port: int) -> bool:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            sock.bind(("127.0.0.1", port))
            sock.listen(1)
            return True
    except OSError:
        return False


def main() -> int:
    for port in CANDIDATES:
        if is_available(port):
            print(port)
            return 0
    print("No accessible local TCP port found for AgroRadar API", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
